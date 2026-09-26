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
| `POST /demo-uploads` | bearer + member session | Starts an upload: `{ fileName, size, platform, source, recordedAt }` → `{ id, name, chunkSize }` |
| `PUT /demo-uploads/:id?offset=N` | bearer + member session (uploader only) | One chunk of exactly `chunkSize` bytes (the last may be shorter), validated and relayed to storage |
| `DELETE /demo-uploads/:id` | bearer + member session (uploader only) | Cancels an unfinished upload |
| `POST /demo-analysis/sync` | bearer (game VM token) | Worker inventory in, queued jobs out; also recovers jobs stuck for two hours |
| `POST /demo-analysis/result` | bearer (game VM token) | `analyzing` / `analyzed` / `failed` reports; `analyzed` is verified against `demos` |

The `demo_files` and `demo_uploads` tables are created by the backend's startup migrations. Analysis states: `none`, `queued`, `analyzing`, `analyzed`, `failed`. `demo_files.origin` is `server` or `upload`.

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

### One-time setup

1. **Storage write access for the backend, limited to `uploads/`.** The bucket has uniform bucket-level access, so a conditional grant works. Use the `client_email` from the backend's `credentials.json`:

   ```sh
   gcloud storage buckets add-iam-policy-binding gs://csbatagi-demos \
     --member="serviceAccount:<backend client_email>" \
     --role=roles/storage.objectUser \
     --condition='title=website-demo-uploads,description=Member demo uploads only,expression=resource.name.startsWith("projects/_/buckets/csbatagi-demos/objects/uploads/")'
   ```

   Without it the form answers "Depolamaya yazma izni yok" and nothing is written. The game VM needs no new permission: it downloads uploads through the signed link in the job.
2. **Worker update on the game VM.** Uploaded demos need the new `demo-analyzer.py` (signed download, match time, `--source` per job). Copy it and restart: `sudo install -m 755 ops/cs2/demo-analyzer.py /usr/local/lib/csbatagi/demo-analyzer.py && sudo systemctl restart csbatagi-analyzer`. Until then an admin request for an uploaded demo fails with an archive download error; server demos are unaffected.
3. **First upload.** Upload one xplay demo, confirm it appears as "Yüklendi" with the right map, queue it with MatchZy and check the night's statistics before announcing the feature.

## Deployment status (11 September 2026)

| Step | State |
|---|---|
| Bucket read for `backend-ci` (`roles/storage.objectViewer`, no condition) | Done. Listing of all 201 objects and real signed URLs verified from the workstation with the backend credentials. |
| Game VM install (`install-analyzer.sh`): CS Demo Manager 3.20.1 `.deb` (sha256 `1674713397388be11fdff348af14ebf2e5c886b312a3c247c8f2ee6851c6811f`), Electron runtime libraries, PostgreSQL 17 client, `/usr/local/bin/csdm` wrapper, `/home/steam/.config/csdm/settings.json` (600), `csbatagi-analyzer.service` enabled and started | Done. `csdm analyze` prints its usage headless; `pg_isready` reaches the backend's private IP `10.142.0.9:5432` across regions through `default-allow-internal`. |
| Postgres role `csdm_analyzer` on the backend database | Created by the deploy pipeline: [`backend/migrations/csdm_analyzer_role.sql`](../../backend/migrations/csdm_analyzer_role.sql) runs on the next release with the password from the `CSDM_ANALYZER_PASSWORD` GitHub secret (already set to the same value as the VM settings file). The CI log of that step also prints `csdm_schema_version`. |
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
- On the game VM: the Linux `.deb` CLI runs headless through the wrapper (after the extra Electron libraries), and the backend's Postgres port is reachable over the VPC. Real signed URLs for a historical and a new demo returned HTTP 200 with the attachment header.
- Not yet verified: an actual analysis into the production database (needs the role and the release), and the worker's job loop against the deployed backend.

## Operations

```sh
sudo systemctl status csbatagi-analyzer
sudo journalctl -u csbatagi-analyzer --since today
sudo -u steam -H csdm analyze /home/steam/cs2/game/csgo/demos/<file>.dem --source matchzy --force   # manual retry
```

The worker never deletes demos. Disk retention on the game VM remains a manual decision (see the [runbook](../../ops/cs2/README.md)). Demos that are neither on the game VM nor in the bucket cannot be analyzed and the admin button is disabled for them.
