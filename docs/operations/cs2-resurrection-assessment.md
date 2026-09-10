# CS2 resurrection: initial assessment

Inspected 10 September 2026. Phase 1 is discovery; server requirements and implementation are deferred until the owner supplies preferences.

Follow-up: the owner subsequently authorized restoring the server. See [the restored installation status](cs2-restored-installation-status.md) for the new VM and SSH findings. The initial read-only findings below describe the state before that restore.

## Outcome

The retired CS2 VM was deleted, but a complete machine image survives from just before deletion. The website integration is still deployed. Its start/stop target is currently the production website VM, which must be corrected before those controls are used.

Cloud and production inspection was read-only, using the existing Google Cloud CLI login and SSH key. No VM was started, stopped, restored, or created; no configuration, permissions, DNS, or secrets were changed. No game-control endpoint was invoked. This report is the only new repository file.

## Account and surviving resources

Account: `csbatagi@gmail.com`. Main project: `esoteric-dryad-256520` (display name `cs batagi`).

| Resource | Verified state |
|---|---|
| Production `backend-1` | Running in `us-east1-d`; `e2-micro`; 30 GB standard persistent disk. Hosts frontend, backend, PostgreSQL, Caddy and DDNS. |
| Retired `cs2-server` | No current VM or persistent disk remains in the main project. Audit logs record deletion on 3 March 2026 at approximately 06:51 UTC. |
| Machine image `cs2-server` | READY; created 3 March 2026 at 06:49:33 UTC, about two minutes before deletion. Source was `cs2-server` in `europe-west3-c`. This is the newest discovered recovery source. |
| Saved machine configuration | `n2d-standard-2`: 2 vCPUs, 8 GiB RAM; one 120 GB boot disk; default network in `europe-west3`; tags `cs2-server`, `http-server`, `https-server`. |
| Machine-image storage | 81,021,891,840 stored bytes; storage location `eu`. Disk contents have not been mounted or inspected. |
| Snapshot `cs2-stable` | READY; created 27 January 2025; source CS2 disk was 100 GB; stored in `europe-west3`. An older fallback, not the latest server state. |
| Bucket `csbatagi-demos` | Exists in `EUROPE-WEST3`; default storage class ARCHIVE; 192 current objects, all `.dem`, totalling approximately 67.51 GiB. |
| Reserved IPs | No reserved Compute Engine addresses were returned in the main project. |
| Game DNS | `cs2.csbatagi.com` resolves to `35.246.142.224`, which is not attached to a current VM in this project. Ownership of that address was not established; no RCON credentials were sent to it. |

Other accessible projects were `csbatagi-frontend`, `grand-incentive-351307`, and `western-emitter-351306`. Compute Engine listing reported the API disabled in each. No APIs were enabled.

The saved machine metadata includes keys for RCON/server passwords, Steam account, API key and tickrate. Values were not printed or copied into this report. Its startup script waits 30 seconds and runs `/gcp.sh`. The contents of `/gcp.sh` and the disk-resident server configuration remain uninspected. Booting a restored image could therefore run old automation immediately.

## How the website controls the server

The team-picker page exposes `Maç Yarat`, `Server Aç`, `Server Kapat`, and a small `PL` plugin button.

```text
Team-picker browser UI
  -> Next.js /api/start-vm or /api/stop-vm
     -> checks shared SERVERACPASS
     -> adds MATCHMAKING_TOKEN bearer token
     -> https://csbatagi.com/backend/start-vm or /stop-vm
        -> Caddy strips /backend; proxies to backend:3000
        -> Express checks AUTH_TOKEN
        -> GcpManager uses Google Compute Engine start/stop

Team-picker teams / Steam IDs / maps / starting sides
  -> Next.js /api/create-match
     -> bearer-authenticated backend /start-match
     -> schema validation; one in-memory matchData object
     -> RCON cs2.csbatagi.com:27015: exec load_match.cfg

PL button
  -> Next.js /api/load-plugins
     -> bearer-authenticated backend /load-plugins
     -> RCON cs2.csbatagi.com:27015: exec load_all.cfg

Backend /get-match
  -> returns matchData, then clears it
```

The expected next step is for server-side configuration/plugin code to fetch `/get-match`, but the contents of `load_match.cfg` were not available in this checkout or the bounded production file search. That last link is inferred, not verified. The commented-out MatchZy database service and match schema suggest a MatchZy-style setup; exact installed plugins and versions are unknown.

The browser payload contains team names and Steam IDs, up to three selected maps, starting sides, `clinch_series`, `players_per_team`, and cvars `tv_enable: 1` and `hostname`. It does not supply a match ID. The inspected flow creates/configures matches; it does not automatically join a player's CS2 client.

## Confirmed integration problems

### 1. Start/stop targets the website VM

Both the checkout and live backend container have:

```text
VM_NAME=backend-1
GCP_ZONE=us-east1-d
```

`backend/gcp.js` prefers these environment variables over `.gcp_parameters`, which still names the old CS2 VM. The live credential file identifies the `backend-ci` service account in the main project. Its project roles include `roles/compute.instanceAdmin.v1`, so the target error is operationally consequential: an authorized stop request can stop the website/database VM.

Git commit `a3a3f8e` (11 April 2026) changed the Compose values from `cs2-server` / `europe-west3-c` to the backend VM. The live frontend has its shared server password and proxy token configured; the backend has its API token and RCON password configured. Only presence was checked, never secret values.

**Do not use the existing Server Aç / Server Kapat buttons before correcting and validating their target.** No stop request was made to test this finding.

### 2. RCON success is not awaited

`executeCommand()` registers callbacks and calls `connect()`, then its async function resolves without awaiting authentication or command completion. Errors are logged in an event handler rather than propagated to the request. Consequently `/start-match` and `/load-plugins` can return success before the server accepts the command, including when the later connection fails. This is confirmed in deployed backend source.

### 3. Match delivery is fragile

There is one global in-memory match slot. Another match overwrites it, a backend restart loses it, and the first GET to `/get-match` clears it. GET requests bypass backend authentication. There is no durable match identifier, acknowledgement, or retry protocol in this handoff. The read-and-clear endpoint was deliberately not called during inspection.

### 4. Public proxy authorization gaps

The local `/api/create-match` and `/api/load-plugins` handlers do not verify a user session or admin role before adding the backend bearer token. Next.js middleware excludes `/api` paths from its page-login gate. Live compiled route artifacts contain the corresponding proxies and no session-check references. Thus hiding the UI behind login does not itself protect these actions. Start/stop additionally require the shared password, but lack per-user authorization in their handlers.

No unauthorized action was attempted to demonstrate these code-level findings.

### 5. No recording or readiness verification

The inspected website/backend flow has no acknowledgement that the game is ready, that a demo is recording, or that its upload completed. The stop path calls Compute Engine directly without a game-level demo finalization/upload check. These are reliability gaps, not proof of the historical recording failure's cause.

## Demo evidence and limits

Object metadata shows archived filenames from 21 January 2025 through 28 February 2026. There are no zero-byte current objects; 13 are smaller than 1 MiB. January 2026 contains several large match-sized files, including two on 20 January of approximately 713 MB and 345 MB. February contains four small files on 9 February and one 82,316-byte file uploaded on 28 February at 18:45 UTC.

This demonstrates that demo files reached Cloud Storage at various times. It does not establish that each file is complete or playable, whether small files were brief tests, or whether missing matches failed during recording or upload. No demo content was downloaded or parsed. Bucket metadata showed uniform bucket-level access and disabled soft-delete retention; this was an inventory of current objects, not a full deleted/versioned-object recovery search.

The February 28 audit entries include repeated starts/stops and metadata changes, followed by the final stop around 18:55 UTC. Those events alone do not diagnose a failure.

To establish the cause, the saved disk needs inspection of `/gcp.sh`, launch/service definitions, `load_match.cfg`, `load_all.cfg`, CS2/Metamod/CounterStrikeSharp/plugin versions, recorder settings, recording paths/permissions, free space, retained game logs, and demo upload scripts. Exact mod software, whether uploads were automatic, and any later local-only demos are still unknown.

## Network leftovers relevant to resurrection

Enabled legacy rules on the default network allow TCP/UDP game ports 27015–27020 and a file-server TCP port 8080 from all sources, without target-tag scoping in those rules. Other existing rules expose SSH/RDP and database ports. A future CS2 restore on this network must account for those existing rules rather than assume its instance tags isolate it. Firewall rules alone do not prove a service is listening. No firewall changes were made.

## Handoff for phase 2

The March 2026 machine image is the primary recovery source; the January 2025 snapshot is a fallback; the demo bucket is an existing archive to preserve. The backend remains a separate, memory-constrained production host.

After requirements are supplied, the next technical step is an isolated recovery/inspection of the machine image with its old startup automation controlled. That step creates cloud resources and has not been performed in this discovery pass. Before public use, the resurrection work must resolve the wrong VM target, stale game DNS, access checks, RCON completion handling, match delivery, and demonstrable recording/upload completion.

No hosting size, mod stack, gameplay rules, map rotation, or retention policy has been selected yet.

## Evidence locations

- `docker-compose.yml:51` — live-target values mirrored in deployment configuration.
- `.gcp_parameters` and `backend/gcp.js` — fallback target and environment precedence.
- `backend/rcon.js` — RCON destination, commands and callback handling.
- `backend/index.js:280` and `:752` — auth and game-control routes.
- `frontend-nextjs/src/app/team-picker/TeamPickerClient.tsx:526` — payload and handlers; UI controls near line 1040.
- `frontend-nextjs/src/app/api/{start-vm,stop-vm,create-match,load-plugins}/route.ts` — proxies and authorization.
- `frontend-nextjs/src/middleware.ts` — API exclusion from page-login checks.
- `Caddyfile` — backend routing, also verified in production.
- Cloud CLI: instance/disk/snapshot/machine-image inventory, machine-image metadata, machine-type description, bucket/object metadata, firewall/address inventory, IAM role listing and instance audit events.
- Production SSH: live backend target, deployed backend control source, frontend compiled proxy presence, secret-presence booleans and Caddy route. No secret values retained in this report.
