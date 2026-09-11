# Demo analysis and downloads

Two features built on the resurrected game server ([deployment record](cs2-resurrection-deployment.md)): finished match demos are analyzed into the club's CS Demo Manager database automatically, and members download any archived demo from the website's Demolar page.

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

`/demolar` lists every demo with date (Istanbul time), map, teams, score once analyzed, size, recording state, analysis state and a download button. "Sadece tamamlanan kayıtlar" hides interrupted recordings. Admins additionally see "Analiz et" / "Yeniden analiz et". The page polls every 30 seconds while any demo is queued or analyzing.

## Backend endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /demos` | bearer + member session | Listing with match details; `?refresh=1` forces a bucket re-list |
| `GET /demos/:name/download` | bearer + member session | Returns `{ url, expiresAt }` for a signed archive URL |
| `POST /demos/:name/analyze` | bearer + admin session | Queues analysis (re-analysis when the demo is already in the database) |
| `POST /demo-analysis/sync` | bearer (game VM token) | Worker inventory in, queued jobs out; also recovers jobs stuck for two hours |
| `POST /demo-analysis/result` | bearer (game VM token) | `analyzing` / `analyzed` / `failed` reports; `analyzed` is verified against `demos` |

The `demo_files` table is created by the backend's startup migrations. Analysis states: `none`, `queued`, `analyzing`, `analyzed`, `failed`.

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
- On the game VM: the Linux `.deb` CLI runs headless through the wrapper (after the extra Electron libraries), and the backend's Postgres port is reachable over the VPC. Real signed URLs for a historical and a new demo returned HTTP 200 with the attachment header.
- Not yet verified: an actual analysis into the production database (needs the role and the release), and the worker's job loop against the deployed backend.

## Operations

```sh
sudo systemctl status csbatagi-analyzer
sudo journalctl -u csbatagi-analyzer --since today
sudo -u steam -H csdm analyze /home/steam/cs2/game/csgo/demos/<file>.dem --source matchzy --force   # manual retry
```

The worker never deletes demos. Disk retention on the game VM remains a manual decision (see the [runbook](../../ops/cs2/README.md)). Demos that are neither on the game VM nor in the bucket cannot be analyzed and the admin button is disabled for them.
