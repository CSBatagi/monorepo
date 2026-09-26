# Demo analysis and downloads

Three features built on the resurrected game server ([deployment record](cs2-resurrection-deployment.md)): finished match demos are analyzed into the club's CS Demo Manager database automatically, members download any archived demo from the website's Demolar page, and members upload demos of matches played on other servers (xplay.gg, FACEIT, ...) so admins can analyze those too ([Uploads from other servers](#uploads-from-other-servers)).

## How it fits together

```
game VM                                  backend VM                              browser
─────────────────────────────            ──────────────────────────────          ─────────────────
CS2 + MatchZy writes demos/*.dem         demo_files table (archive + queue)      /demolar page
csbatagi-demos.service  ─upload──►  gs://csbatagi-demos  ◄─list/sign─  demoRoutes.js  ◄─/api/demos─  DemolarClient
csbatagi-analyzer.service ─sync/result─►  POST /demo-analysis/*                   admin: Analiz et
   └─ csdm analyze --source matchzy ──►  Postgres csdm (CS Demo Manager tables) ─► trigger ─► stats publish
```

- **Recording and archiving** are unchanged: the plugin writes a `.closed.json` marker per demo and the uploader verifies each object in the bucket.
- **Analysis worker** ([demo-analyzer.py](../../ops/cs2/demo-analyzer.py)) runs on the game VM as `steam`. Every minute it reports its demo inventory (size, recording state, match ID, archive state) to the backend and receives the jobs to run. It only runs jobs while the server has no match live, preparing or recording, and it runs the CS Demo Manager CLI with `nice`/`ionice` so a stray analysis cannot starve CS2.
- **Backend** ([demoRoutes.js](../../backend/demoRoutes.js)) owns the `demo_files` table. It queues a demo automatically only when the recording ended normally (`map-ended`), the archive upload is verified, and the match ID belongs to a match the website created (its JSON exists in `CS2_MATCH_DIR`). That excludes bot simulations and console tests. Admins can queue anything else, including re-analysis with `--force`. A worker's "analyzed" report is accepted only if the demo's stem appears in the CS Demo Manager `demos` table; the CLI exits 0 even on failure, so the database is the proof.
- **Stats publishing** needs no change: the CLI inserts into the same tables the desktop app uses, the existing triggers mark `stats_refresh_state` dirty, and the backend publishes after the quiet window ([stats-publishing.md](stats-publishing.md)).
- **Downloads** are V4 signed Cloud Storage URLs valid for 15 minutes, created by the backend with the `backend-ci` service account key it already has, and served through `/api/demos/<name>/download`, which requires a signed-in session. The bucket listing (including the 192 historical demos at the bucket root) is refreshed at most every five minutes.

## Website

`/demolar` lists every demo with date (Istanbul time), map, teams, score once analyzed, size, recording state, analysis state and a download button. "Sadece tamamlanan kayıtlar" hides interrupted recordings. Admins additionally see "Analiz et" / "Yeniden analiz et", and for uploaded demos an analysis type selector and "Sil". The page polls every 30 seconds while any demo is queued or analyzing. "Başka sunucudan demo yükle" opens the upload form for any signed-in member.

## Backend endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /demos` | bearer + member session | Listing with match details; `?refresh=1` forces a bucket re-list |
| `GET /demos/:name/download` | bearer + member session | Returns `{ url, expiresAt }` for a signed archive URL |
| `POST /demos/:name/analyze` | bearer + admin session | Queues analysis (re-analysis when the demo is already in the database); optional `{ source }` sets the `--source` for that demo |
| `DELETE /demos/:name` | bearer + admin session | Deletes an uploaded demo (object and row); server recordings are refused |
| `POST /analysis-server/start` · `/stop` | bearer + admin session | Opens the game VM for analysis / closes it when nothing is running and nobody is on it |
| `POST /demo-uploads` | bearer + member session | Starts an upload: `{ fileName, size, platform, source, recordedAt }` → `{ id, name, chunkSize }` |
| `PUT /demo-uploads/:id?offset=N` | bearer + member session (uploader only) | One chunk of exactly `chunkSize` bytes (the last may be shorter), validated and relayed to storage |
| `DELETE /demo-uploads/:id` | bearer + member session (uploader only) | Cancels an unfinished upload |
| `POST /demo-analysis/sync` | bearer (game VM token) | Worker inventory in, queued jobs out; also recovers jobs stuck for two hours |
| `POST /demo-analysis/result` | bearer (game VM token) | `analyzing` / `analyzed` / `failed` reports; `analyzed` is verified against `demos` |

The `demo_files`, `demo_uploads` and `analysis_server` tables are created by the backend's startup migrations. Analysis states: `none`, `queued`, `analyzing`, `analyzed`, `failed`. `demo_files.origin` is `server` or `upload`.

## Uploads from other servers

Members add CS2 demos of club matches played elsewhere. The demo is stored in the same bucket under `uploads/`, listed and downloadable like any other, and reaches statistics only when an admin presses "Analiz et".

```
browser ── 4 MiB chunks ──► /api/demos/uploads/<id> (Next.js) ──► PUT /demo-uploads/<id> (backend)
                                                                    ├─ demoFile.js: stamp, header, frame walk
                                                                    └─ relay ──► resumable upload session ──► gs://csbatagi-demos/uploads/<name>
admin "Analiz et" ──► worker gets { downloadUrl (signed, 2 h), recordedAt, source } ──► mtime = match time ──► csdm analyze [--source X]
```

**Why chunks.** Next.js buffers request bodies for its middleware and silently truncates them past 10 MB, and the containers have 256 MB each, so a 300 MB demo can never travel in one request. The browser sends 4 MiB pieces; the backend holds at most two at a time and forwards each to a Cloud Storage resumable session only the backend knows. An abandoned or rejected upload cancels its session, so its bytes never become an object.

**Guard rails** (the goal is that nothing but a CS2 demo can be stored):

- Browser pre-check before any transfer: `.dem` extension, size limits, the `PBDEMS2\0` stamp; archives (`.zip`, `.gz`, `.zst`, `.rar`, `.7z`, `.bz2`) and CS:GO demos get a message telling the member to extract the `.dem` first.
- Backend check of every byte ([demoFile.js](../../backend/demoFile.js)): the first frame must be an uncompressed `DEM_FileHeader` with the fields CS Demo Manager requires (so the analyzer can read it), the game directory must be `csgo` (Dota 2 and Deadlock share the format), and the rest of the file is walked frame by frame across chunk boundaries. Anything that is not a frame sequence (an archive or executable appended to a copied header, random bytes, a frame claiming more than 32 MiB) fails on the chunk where it starts, before that chunk is forwarded. A recording cut off mid-frame is accepted and shown as "Yarım kayıt". Checked against a real 60 MB match demo (about 20 ms for the whole file).
- Identity and quotas: a Steam session of a roster member, rechecked against `players.json` at start; 10 uploads per member per day (`DEMO_UPLOAD_DAILY_LIMIT`, failed attempts count at three times that), 3 uploads in progress site-wide (`DEMO_UPLOAD_MAX_ACTIVE`), 1 MB to 1 GB (`DEMO_UPLOAD_MAX_BYTES`). Starting a new upload cancels the member's unfinished one; uploads idle for two hours expire.
- Duplicates: the same file name and size, or the same content fingerprint (SHA-256 of the size and first 4 MiB), is refused. CS Demo Manager would otherwise skip the second copy and the website would report a failed analysis.
- Storage: object names are chosen by the server (`<platform>_<match time UTC>_<8 hex>.dem`), created with `ifGenerationMatch=0`, content type `application/octet-stream` and `Content-Disposition: attachment`; the member's file name is kept only as a label. The session URI is a write credential and never leaves the backend.
- Analysis stays an admin decision, and the worker re-checks what it downloads: signed links only on `storage.googleapis.com`, exact size, CS2 stamp, safe file name, and `--source` from a fixed list (so no value can become another CLI flag). Analysis still runs under `nice`/`ionice` and `MemoryMax=3G`.
- Kill switch: `DEMO_UPLOADS_ENABLED: "false"` in `docker-compose.yml` hides the form and refuses new uploads. Admins can delete an uploaded demo; statistics already written stay until removed in CS Demo Manager.

**Analysis type.** CS Demo Manager picks its parsing rules from the server name and file name. xplay.gg demos usually match nothing it knows, and they analyze correctly as MatchZy, so `matchzy` is the default for uploads. The member chooses a type when uploading; admins can change it next to "Analiz et" (it is stored per demo in `demo_files.analysis_source`). "Otomatik algıla" (`auto`) runs the CLI without `--source`. Server recordings keep `matchzy`.

**Match date.** CS Demo Manager dates a match by the demo file's modification time, and the statistics group nights by that date. The upload form asks for the match time (prefilled from the file's own timestamp), and the worker sets it as the downloaded file's mtime before analysis.

### Setup (automated)

The [Demo analysis setup](../../.github/workflows/demo-analysis-setup.yml) workflow ([`ci-demo-analysis-setup.sh`](../../ops/cs2/ci-demo-analysis-setup.sh)) does both steps with the `GOOGLE_CREDENTIALS` deploy account. It runs on `main` whenever the worker or these scripts change; on other branches it only reports what it would do. To run it again from a phone: GitHub app → Actions → Demo analysis setup → Run workflow (on `main`).

1. **Storage write access for the backend, limited to `uploads/`.** The workflow checks whether the account can open an upload session under `uploads/` (which writes nothing) and, if not, grants itself `roles/storage.objectUser` with a condition on that prefix. The bucket has uniform bucket-level access, so the conditional grant works. If the deploy account is not allowed to change bucket permissions, the run prints a warning with the exact `gcloud storage buckets add-iam-policy-binding` command to paste once into Cloud Shell (it works in a phone browser). Until access exists the form answers "Depolamaya yazma izni yok" and nothing is written. The game VM needs no new permission: it downloads uploads through the signed link in the job.
2. **Worker on the game VM.** The workflow copies [`analyzer-maintenance.sh`](../../ops/cs2/analyzer-maintenance.sh) and `demo-analyzer.py` over SSH through Identity-Aware Proxy (the game VM's firewall drops direct SSH; direct is tried only as a fallback), installs the worker if its sha256 differs, waiting for a running analysis first, and restarts `csbatagi-analyzer`. Every SSH call has a time limit, and a worker that could not be installed fails the run instead of ending green. The deploy account needs `roles/iap.tunnelResourceAccessor` for this; without it the run fails with `4033: 'not authorized'` and prints the grant command. A stopped VM is started for the install and stopped again once no analysis, match or player is on it; a busy VM is left running with a warning. The new worker also works with the previous backend.
3. **First upload.** Upload one xplay demo, confirm it appears as "Yüklendi" with the right map, queue it with MatchZy and check the night's statistics before announcing the feature.

## The game VM as the analysis machine

The CS Demo Manager CLI and the analyzer worker are installed on the game VM (`cs2-server`), so analysis only happens while it is on. [analysisServer.js](../../backend/analysisServer.js) handles that:

- **Start.** "Analiz et" queues the demo and, if the VM is off, starts it (without waiting for the boot) and marks the run as an *analysis session*. The worker picks the job up within a minute or two of boot. A request while the VM is shutting down restarts it once it is off. The Demolar page shows an "Analiz sunucusu" line to admins with the state and a "Sunucuyu kapat" button, plus "Sunucuyu aç" when demos are waiting on a stopped VM.
- **Idle close.** During an analysis session the backend checks once a minute and stops the VM after `DEMO_ANALYSIS_IDLE_MINUTES` (15) idle minutes in a row. Idle means: nothing queued or analyzing, no human on the server, no match being prepared, played or recorded, and no demo upload in flight. Any new request restarts the clock, so a few demos can be queued one after another. Players are read from the plugin's `csbatagi_status` over RCON, and otherwise from the worker's copy of `status.json` (a stale file means CS2 is not running). If neither answers, the server is not treated as empty and stays up. Queued jobs stop holding the VM when the worker has not checked in for 10 minutes after a 20-minute boot allowance, so a broken worker cannot keep it running forever.
- **Matches are left alone.** A VM opened with "Server Aç" is never closed by this; pressing "Server Aç" during an analysis session also ends the session. "Server Kapat" now also waits for a running analysis. Closing by hand from the Demolar page refuses while anything is queued or analyzing, or while players, a match or an upload are on the server.
- **State.** One row in `analysis_server` (session flag, idle start, last reason, who stopped it), so a backend restart does not reset the clock. `DEMO_ANALYSIS_AUTOSTART: "false"` turns the automatic start off.

## Deployment status (11 September 2026)

| Step | State |
|---|---|
| Bucket read for `backend-ci` (`roles/storage.objectViewer`, no condition) | Done. Listing of all 201 objects and real signed URLs verified from the workstation with the backend credentials. |
| Game VM install (`install-analyzer.sh`): CS Demo Manager 3.20.1 `.deb` (sha256 `1674713397388be11fdff348af14ebf2e5c886b312a3c247c8f2ee6851c6811f`), Electron runtime libraries, PostgreSQL 17 client, `/usr/local/bin/csdm` wrapper, `/home/steam/.config/csdm/settings.json` (600), `csbatagi-analyzer.service` enabled and started | Done. `csdm analyze` prints its usage headless; `pg_isready` reaches the backend's private IP `10.142.0.9:5432` across regions through `default-allow-internal`. |
| Postgres role `csdm_analyzer` on the backend database | Created by the deploy pipeline: [`backend/migrations/csdm_analyzer_role.sql`](../../backend/migrations/csdm_analyzer_role.sql) runs on the next release with the password from the `CSDM_ANALYZER_PASSWORD` GitHub secret (already set to the same value as the VM settings file). The CI log of that step also prints `csdm_schema_version`. |
| Upload storage access for `backend-ci` | Done. The first setup dry run (26 September 2026, morning) showed the deploy account could neither write `uploads/` nor change bucket IAM; access has since been granted, and the 10:40 UTC run reported "OK: the account can write gs://csbatagi-demos/uploads/". |
| Analyzer worker with upload support on the game VM | The first run on `main` (26 September 2026) started the VM, then spent the whole 45-minute job on direct SSH attempts that the firewall drops, and was cancelled. The VM kept the 11 September worker, which ignores the signed link and fetches every archived demo with `gcloud storage cp` as the VM's own account, so the first uploaded demo failed with `archive download failed ... 123719540575-compute@developer.gserviceaccount.com`. The setup script now uses IAP first with time limits. **Blocked on one owner grant:** the 10:40 UTC dry run reached IAP and got `4033: 'not authorized'`, so `backend-ci` also needs `roles/iap.tunnelResourceAccessor` (the run prints the exact `gcloud projects add-iam-policy-binding` command). After that, run the workflow on `main` again. That cancelled run also left the VM on outside any analysis session, so nothing closes it automatically: close it from the Demolar page once the install has run. |
| Backend and frontend release | Pending the normal CI deploy. Until then the worker logs one "Backend rejected request: 404" line per minute, which is expected. |

### Production safety

- **Nothing writes to the club database until you say so.** `DEMO_AUTO_ANALYZE` in `docker-compose.yml` is `"false"`: the backend never queues demos on its own, and the Demolar page says so. The only way a demo reaches the database is an admin pressing "Analiz et" on the page. Flip the value to `"true"` after the first manually queued demo has been verified end to end.
- The worker runs the CLI with `--force` only for demos already in the database and only on an explicit admin re-analysis request, which asks for confirmation. A normal analysis of a demo that is already there is skipped by the CLI itself.
- The analyzer role has data privileges only and does not own the tables, so the CLI can never migrate the schema. Because of that the CLI version (3.20.1) and the desktop version you push official stats with must stay equal, and production must already be at the 3.20.1 schema (version **14**, printed as `csdm_schema_version` in the migration step's CI log). If it is lower, connect your desktop CS Demo Manager 3.20.1 to production once, as you do when pushing stats, so it migrates before any analysis runs.
- The migration is idempotent and only reports the schema version when the secret is absent; it was exercised on the local dummy database (create, privilege check, skip path) before being committed.

Verify from the game VM after the release (the password is in `/home/steam/.config/csdm/settings.json`):

```sh
sudo -u steam -H psql -h 10.142.0.9 -U csdm_analyzer -d csdm -c "SELECT max(schema_version) FROM migrations"
```

### After the release

1. **Auto-analysis cutoff.** Once `DEMO_AUTO_ANALYZE` is `"true"`, only recordings dated on or after `DEMO_AUTO_ANALYZE_SINCE` (default `2026-09-11T00:00:00Z`) are queued automatically. The 10 September resurrection tests were bot matches created through the website and would otherwise be analyzed into club statistics. Admins can still queue anything by hand.
2. **First run.** Queue one archived real demo from the Demolar page as an admin and watch it move to "İstatistiklerde"; then confirm the stats pipeline published (`/stats/diagnostics`). Only then enable auto-analysis.
3. **Historical demos.** The 192 bucket-root demos are listed and downloadable immediately. Those already analyzed from a desktop are recognised by file stem and shown as "İstatistiklerde"; any other can be queued by an admin, in which case the worker downloads it from the bucket into `csbatagi-state/analysis-downloads/`. The game VM's service account can currently read only `resurrection/` objects; grant it `roles/storage.objectViewer` on the whole bucket if historical re-analysis is wanted.
4. **Version pinning.** The CLI and the club's desktop app must stay on the same CS Demo Manager version: the CLI migrates the shared schema on connect, and a newer CLI would force every desktop to upgrade.

## Verified so far

- `csdm analyze --source matchzy` from the CLI, headless, against an empty Postgres 17 database: 16 MB test demo analyzed in about three seconds; the CLI created the schema itself; a minimal `settings.json` containing only the `database` block is accepted; re-running without `--force` skips the demo; an invalid path exits 0 with an "Invalid path" message.
- Backend unit tests cover name parsing, path safety, V4 signature verification against the public key, the auto-queue rule, session/admin gating, the queue round trip and the "reported success but not in database" case.
- Uploads: validator tests with byte-accurate synthetic demos (archives, CS:GO demos, executables, polyglots, oversized frames, other Source 2 games, split frame headers at 1-byte chunks, truncation); route tests for auth, quotas, duplicates, rejection before storage, lost relay responses and admin delete; the storage client against a local server speaking the resumable protocol. `DEMO_SAMPLE=/path/to/real.dem npm test` also runs the validator on a real demo. The whole flow was run against PostgreSQL 16 and through the built website in Chromium (upload, refusals, admin source switch and delete) with an in-memory bucket, and the worker changes against a stub CLI. Not yet exercised against real Cloud Storage or the real CLI.
- Game VM lifecycle: controller tests with a simulated clock (start on request, restart after a shutdown, 15-minute idle close, players/match/upload/unverified states keeping it up, a silent worker, a failed start, manual close and "Server Aç"); route tests for the analyze hook, admin-only controls and the "Server Aç/Kapat" hooks; the session-state SQL against PostgreSQL 16. The setup script's branches were run with stubbed `gcloud`; its first real run is the dry run on the feature branch.
- On the game VM: the Linux `.deb` CLI runs headless through the wrapper (after the extra Electron libraries), and the backend's Postgres port is reachable over the VPC. Real signed URLs for a historical and a new demo returned HTTP 200 with the attachment header.
- Not yet verified: an actual analysis into the production database (needs the role and the release), and the worker's job loop against the deployed backend.

## Operations

```sh
sudo systemctl status csbatagi-analyzer
sudo journalctl -u csbatagi-analyzer --since today
sudo -u steam -H csdm analyze /home/steam/cs2/game/csgo/demos/<file>.dem --source matchzy --force   # manual retry
```

`archive download failed: ... uploads/<name>.dem' (or it may not exist) ... authenticated as <number>-compute@developer.gserviceaccount.com` on an uploaded demo means the game VM runs a worker without upload support (it ignores the signed link and asks the VM's own account, which cannot read `uploads/`). Run the Demo analysis setup workflow on `main` (Actions > Demo analysis setup > Run workflow), check that it ends green with "Installing worker" or "Worker already up to date", then press "Analiz et" again. The current worker reports a missing link as "the backend sent no signed download link" instead; that one points to the backend log line `[demos] worker link failed`.

The worker never deletes demos. Disk retention on the game VM remains a manual decision (see the [runbook](../../ops/cs2/README.md)). Demos that are neither on the game VM nor in the bucket cannot be analyzed and the admin button is disabled for them.
