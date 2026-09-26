#!/usr/bin/env bash
# Run by .github/workflows/demo-analysis-setup.yml, with gcloud signed in as the deploy account
# (backend-ci, the GOOGLE_CREDENTIALS secret, which is also the backend's credentials.json).
# Keeps the two parts of demo analysis that live outside the website images in step with the code:
#   1. write access for that account to gs://$BUCKET/uploads/ (member demo uploads), and
#   2. ops/cs2/demo-analyzer.py installed on the game VM, which is started for the install when it
#      is off and stopped again afterwards once nobody is on it.
# APPLY=true makes the changes; anything else only reports what it would do.
set -euo pipefail

BUCKET="${BUCKET:-csbatagi-demos}"
GAME_VM="${GAME_VM:-cs2-server}"
GAME_ZONE="${GAME_ZONE:-europe-west3-c}"
APPLY="${APPLY:-false}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORKER="$HERE/demo-analyzer.py"
HELPER="$HERE/analyzer-maintenance.sh"
ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
EXPRESSION="resource.name.startsWith(\"projects/_/buckets/${BUCKET}/objects/uploads/\")"
CONDITION="title=website-demo-uploads,description=Member demo uploads only,expression=${EXPRESSION}"
SSH_EXTRA=(--tunnel-through-iap)

warn() { echo "::warning::$*"; }

# ---------------------------------------------------------------- storage access for uploads

# Opening a resumable upload session needs exactly the permission uploads use, and writes nothing.
can_write_uploads() {
  local headers location
  headers="$(curl -sS -o /dev/null -D - -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" -H 'Content-Type: application/json; charset=UTF-8' \
    -H 'X-Upload-Content-Type: application/octet-stream' -H 'X-Upload-Content-Length: 1' --data '{}' \
    "https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=resumable&ifGenerationMatch=0&name=uploads%2F.ci-permission-check")" || return 1
  location="$(printf '%s' "$headers" | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')"
  [ -n "$location" ] || return 1
  curl -sS -o /dev/null -X DELETE "$location" || true
}

can_grant() {
  curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "https://storage.googleapis.com/storage/v1/b/${BUCKET}/iam/testPermissions?permissions=storage.buckets.getIamPolicy&permissions=storage.buckets.setIamPolicy" \
    | grep -q '"storage.buckets.setIamPolicy"'
}

storage_access() {
  echo "::group::Storage access for member uploads"
  echo "Deploy account: ${ACCOUNT}"
  if can_write_uploads; then
    echo "OK: the account can write gs://${BUCKET}/uploads/."
  elif ! can_grant; then
    warn "The deploy account cannot write gs://${BUCKET}/uploads/ and is not allowed to grant itself access, so member uploads stay unavailable. Run this once in Cloud Shell (shell.cloud.google.com also works in a phone browser):"
    echo "gcloud storage buckets add-iam-policy-binding gs://${BUCKET} --member=serviceAccount:${ACCOUNT} --role=roles/storage.objectUser --condition='${CONDITION}'"
  elif [ "$APPLY" != true ]; then
    echo "Dry run: would grant ${ACCOUNT} roles/storage.objectUser limited to gs://${BUCKET}/uploads/ (the account is allowed to)."
  else
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${ACCOUNT}" \
      --role=roles/storage.objectUser --condition="${CONDITION}" >/dev/null
    for _ in $(seq 1 12); do
      if can_write_uploads; then echo "OK: access granted, limited to uploads/."; echo "::endgroup::"; return 0; fi
      sleep 10
    done
    warn "Access granted, but writing does not work yet; IAM changes can take a few minutes to apply."
  fi
  echo "::endgroup::"
}

# ---------------------------------------------------------------- analyzer worker on the game VM

vm_status() { gcloud compute instances describe "$GAME_VM" --zone "$GAME_ZONE" --format='value(status)'; }
# The game VM's firewall allows SSH only through Identity-Aware Proxy, so that is the way in; direct
# SSH is only a fallback. Every call has a hard time limit: port 22 drops direct connections, and
# the first run on main (26 September 2026) spent its whole 45 minutes on hung direct attempts.
# ssh_vm SECONDS ARGS...
ssh_vm() {
  local limit="$1"; shift
  timeout "$limit" gcloud compute ssh "$GAME_VM" --zone "$GAME_ZONE" --quiet --strict-host-key-checking=no \
    --ssh-key-expire-after=30m --ssh-flag=-oConnectTimeout=20 --ssh-flag=-oServerAliveInterval=15 "${SSH_EXTRA[@]}" "$@"
}
scp_vm() {
  timeout 300 gcloud compute scp --zone "$GAME_ZONE" --quiet --strict-host-key-checking=no \
    --ssh-key-expire-after=30m --scp-flag=-oConnectTimeout=20 "${SSH_EXTRA[@]}" "$@"
}

# sshd needs a minute or two after a boot: IAP for up to about fifteen minutes, then direct SSH twice.
wait_for_ssh() {
  local error=''
  echo "Waiting for SSH through IAP..."
  SSH_EXTRA=(--tunnel-through-iap)
  for _ in $(seq 1 10); do
    error="$(ssh_vm 90 --command true 2>&1 >/dev/null)" && return 0
    [ -n "$error" ] || error="no answer within 90 seconds"
    case "$error" in *4033*) break ;; esac  # not authorized for IAP: waiting will not help
    sleep 10
  done
  SSH_EXTRA=()
  for _ in 1 2; do
    ssh_vm 60 --command true >/dev/null 2>&1 && return 0
    sleep 5
  done
  SSH_EXTRA=(--tunnel-through-iap)
  echo "Last IAP SSH error:"
  printf '%s\n' "$error" | tail -n 5
  case "$error" in
    *4033*) warn "The deploy account may not open IAP tunnels. Grant it once in Cloud Shell: gcloud projects add-iam-policy-binding $(gcloud config get-value project 2>/dev/null) --member=serviceAccount:${ACCOUNT} --role=roles/iap.tunnelResourceAccessor" ;;
  esac
  return 1
}

# Stop the VM again only if this run started it, once no analysis, match or player is on it.
stop_if_started() {
  [ "$1" = true ] || return 0
  local state=unknown
  for _ in $(seq 1 40); do
    state="$(ssh_vm 90 --command "bash /tmp/analyzer-maintenance.sh state" 2>/dev/null || echo unknown)"
    case "$state" in idle|no-status) break ;; esac
    echo "Game VM is ${state}; waiting before stopping it."
    sleep 30
  done
  case "$state" in
    idle|no-status)
      ssh_vm 60 --command "rm -f /tmp/analyzer-maintenance.sh /tmp/demo-analyzer.py" >/dev/null 2>&1 || true
      gcloud compute instances stop "$GAME_VM" --zone "$GAME_ZONE" --quiet
      echo "Game VM stopped again."
      ;;
    *) warn "Game VM left running (${state}); close it from the website when done." ;;
  esac
}

game_worker() {
  echo "::group::Analyzer worker on the game VM"
  local status started=false wanted installed
  wanted="$(sha256sum "$WORKER" | cut -d' ' -f1)"
  status="$(vm_status)"
  echo "Game VM ${GAME_VM}: ${status}. Worker in the repository: ${wanted}"

  if [ "$APPLY" != true ]; then
    if [ "$status" != RUNNING ]; then
      echo "Dry run: would start the VM, install the worker and stop the VM again."
    elif wait_for_ssh; then
      scp_vm "$HELPER" "${GAME_VM}:/tmp/analyzer-maintenance.sh" >/dev/null
      echo "Installed now: $(ssh_vm 90 --command 'bash /tmp/analyzer-maintenance.sh installed' | tr '\n' ' ')"
      ssh_vm 60 --command "rm -f /tmp/analyzer-maintenance.sh" >/dev/null 2>&1 || true
    else
      warn "SSH to the game VM failed; the real run could not install the worker."
    fi
    echo "::endgroup::"
    return 0
  fi

  for _ in $(seq 1 30); do
    case "$status" in RUNNING|TERMINATED) break ;; esac
    sleep 10
    status="$(vm_status)"
  done
  if [ "$status" = TERMINATED ]; then
    echo "Starting the game VM for the install; it is stopped again afterwards."
    gcloud compute instances start "$GAME_VM" --zone "$GAME_ZONE" --quiet
    started=true
  elif [ "$status" != RUNNING ]; then
    warn "Game VM stayed ${status}; worker not updated. Run this workflow again later."
    echo "::endgroup::"
    return 0
  fi

  # A worker that silently stays old breaks analysis (the old one cannot fetch uploaded demos), so
  # failing to install it fails the run instead of ending green with a warning.
  if ! wait_for_ssh; then
    warn "Could not reach the game VM over SSH (IAP or direct); worker not updated."
    [ "$started" = true ] && gcloud compute instances stop "$GAME_VM" --zone "$GAME_ZONE" --quiet
    echo "::endgroup::"
    return 1
  fi
  local ok=true
  if ! scp_vm "$HELPER" "$WORKER" "${GAME_VM}:/tmp/"; then
    warn "Copying the worker to the game VM failed; worker not updated."
    ok=false
  else
    # First line only, without a pipe: under pipefail an early-closing `head` can kill the command.
    installed="$(ssh_vm 90 --command 'bash /tmp/analyzer-maintenance.sh installed' || true)"
    installed="${installed%%$'\n'*}"
    if [ "$installed" = "$wanted" ]; then
      echo "Worker already up to date."
    else
      echo "Installing worker ${wanted} (was ${installed:-none})."
      # Waits up to 15 minutes for a running analysis before it restarts the service.
      if ! ssh_vm 1200 --command 'bash /tmp/analyzer-maintenance.sh install /tmp/demo-analyzer.py'; then
        warn "Installing the worker failed; see the output above."
        ok=false
      fi
    fi
  fi
  stop_if_started "$started"
  echo "::endgroup::"
  [ "$ok" = true ]
}

storage_access
game_worker
