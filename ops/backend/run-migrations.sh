#!/usr/bin/env bash
# Runs on the backend VM, copied there by the deploy workflow ("Run database migrations"): applies
# every ~/migrations/*.sql to the csdm database as a Postgres superuser, over the container's local
# socket. The postgres service gets no POSTGRES_USER (.pg_secrets holds only passwords), so the
# image's default superuser, postgres, is the usual one; the backend's DB_USER is the fallback.
# Until 26 September 2026 the step passed an empty user to psql and every migration failed unseen;
# a failing migration now fails the step.
set -uo pipefail

DIR="${1:-$HOME/migrations}"
dc() { sudo docker compose -f "$HOME/docker-compose.yml" "$@"; }
secret() { grep "^$1=" "$2" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r'; }

superuser=''
for user in "$(dc exec -T postgres printenv POSTGRES_USER 2>/dev/null | tr -d '\r')" postgres "$(secret DB_USER "$HOME/.backend_secrets")"; do
  [ -n "$user" ] || continue
  is_super="$(dc exec -T postgres psql -X -U "$user" -d csdm -Atc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user' 2>/dev/null | tr -d '\r')"
  if [ "$is_super" = t ]; then superuser="$user"; break; fi
done
if [ -z "$superuser" ]; then
  echo "::error::No Postgres superuser could connect to the csdm database (tried POSTGRES_USER, postgres, DB_USER); migrations not run."
  exit 1
fi
echo "Running migrations as ${superuser}."

analyzer_password="$(secret CSDM_ANALYZER_PASSWORD "$HOME/.pg_secrets")"
status=0
for file in "$DIR"/*.sql; do
  [ -e "$file" ] || continue
  echo "Running migration: $(basename "$file")"
  if ! dc exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$superuser" -d csdm -v csdm_analyzer_password="$analyzer_password" -f - < "$file"; then
    echo "::error::Migration $(basename "$file") failed; see the output above."
    status=1
  fi
done
exit "$status"
