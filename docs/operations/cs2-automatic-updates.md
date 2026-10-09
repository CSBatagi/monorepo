# CS2 automatic updates

Implemented and deployed on 1 October 2026. The game VM uses `ops/cs2/update-stack.py` before launching CS2, `verify-start.sh` before opening public UDP, and a separate status reporter while the game is unavailable.

## Member behaviour

Every cold VM opening runs an incremental SteamCMD update of app 730. The game is never pinned to an obsolete version. Startup compares the installed depot build ID with Steam's public branch metadata; the `UpToDateCheck` API was found to accept the obsolete September build and is not used as proof.

Startup then checks the newest stable CounterStrikeSharp, MatchZy Enhanced and Inventory Simulator releases, the newest Linux Metamod 2.x build, and the latest core CounterStrikeSharp gamedata revision. Unchanged packages are reused. Automatic crash restarts in the same boot reuse the verified installation and still check readiness, avoiding repeated updates during crash recovery. Opening an already-running VM leaves its current game session untouched.

The website shows checking, updating CS2, updating plugins, verifying or failed. A running VM is not readiness. Match loading is blocked until our game plugin reports that startup verification passed. UDP 27015 is blocked at the host during preparation, including for direct Steam connections; private TCP RCON remains available for verification.

## Custom plugin preservation

The updater downloads immutable upstream source commits and reapplies `patch-matchzy.py` / `CSBatagi.cs` and `patch-inventory.py` / `CSBatagiInventory.cs`. A failed source patch never falls back to an unmodified upstream DLL.

Changed packages compile on the separate 8 GiB game VM using a cached, SHA-512-verified Microsoft .NET 10 SDK. Builds use two logical processors and one MSBuild worker, with compiler servers disabled. The 1 GiB backend VM never builds Next.js or plugins and its container memory limits remain unchanged. This implements an on-demand build instead of the earlier proposed CI release pipeline, so automatic updates do not depend on publishing a new CI artifact first.

Both custom plugins compile against the selected CounterStrikeSharp API and .NET 10 runtime. The adapter handles the reviewed connection-state enum rename in API 1.0.375+. Other source/API incompatibilities fail compilation and require an integration fix.

Only managed files under `addons/` are installed. Configs, admins, credentials, demos and runtime state are excluded. Metamod's `gameinfo.gi` entry is restored after SteamCMD. Core gamedata is fetched from its immutable upstream revision. CounterStrikeSharp's runtime gamedata updater and plugin hot reload are disabled so there is one update owner. MatchZy's restart-based updater stays disabled.

## Verification and failure policy

Native verification requires CSTV, clean warmup, both custom plugins listed as LOADED, a fresh successful authenticated skins API diagnostic, three consecutive health checks and a second public Steam build comparison. Native game/plugin failures have a 150-second recovery window; the inventory API can take up to fifteen minutes to recover while the website hydrates stats after deployment. Changed game/package combinations also record a short CSTV demo and check its header and file growth. The test file lives outside both production demo worker inventories; it is never imported into club stats. This is a recording smoke check, not proof of a full human match, voice capture or rendered skins.

Plugin files are backed up before installation, with an atomic transaction journal. An interrupted partial install is restored before launch. A native verification failure stops the game and restores the previous plugin package. The failed package/game combination is quarantined; the previous package must pass verification against the current game before it can open. An inventory API timeout also restores the previous package, but does not quarantine the candidate because an external API outage does not establish plugin incompatibility. Systemd allows at most two starts in an hour to avoid repeated failure loops.

If downloading/building a plugin candidate fails, the existing custom stack can open only if it passes the same native checks against the updated game; a warning remains in local state. If neither stack works, public UDP stays blocked and the website reports failure. There is no game-version rollback that would strand updated Steam clients again.

## Files and commands

All private state lives under `/home/steam/csbatagi-updates/`:

- `status.json`: atomic preparation status, operation and boot IDs, game/package versions, sanitized error/warning.
- `installed.json`: accepted package versions, immutable source commits and payload hashes.
- `transaction.json`, `pending.json`, `rollback/`: recoverable plugin installation.
- `rejected.json`: last failed candidate/game combination.
- `verified.json`, `diagnostics/startup-check.dem`: local smoke-test evidence.
- `steamcmd.log`, `app-info.log`, `build.log`: private operational logs; no server secrets are passed to SteamCMD/build commands.
- `dotnet/`: cached SDK, installed only when the first plugin build needs it.

```sh
sudo systemctl status cs2 csbatagi-update-status csbatagi-demos csbatagi-analyzer
sudo cat /home/steam/csbatagi-updates/status.json
sudo journalctl -u cs2 -b --no-pager
sudo python3 /usr/local/lib/csbatagi/rcon-local.py csbatagi_status
df -h /home/steam/cs2
```

The status reporter posts a sanitized payload every ten seconds to authenticated backend `POST /game-update-status`. Backend stores it beside persistent match-control files, rejects stale reports and expires them after 45 seconds. Member `GET /game-status` can report progress before RCON exists. Raw console logs and credentials are never returned by the callback.

The 9 October SDR extension adds a root-managed password gate to cover Steam relay admission as well as direct UDP, preserves its hook across map config reloads, reapplies the listener settings after SteamCMD, and includes a verified Steam identity in the existing callback. Its selective installer preserves the deployed custom patches. The game-VM rollout is currently blocked by cloud capacity; see [SDR installation and validation](cs2-sdr.md) before deploying these sources.

Do not bypass startup by launching the binary directly or opening the gate manually. For an explicitly safe maintenance retry, first confirm no humans, loaded/live match, recording or unverified uploads, then stop CS2, reset the systemd start limit and start it again. Never delete the updater transaction/rollback files to force installation.

## Deployment and rollback

Stage the updater sources, custom patches and service files and run `install-updater.py` as root on the existing VM. It guards occupied servers, saves service/source backups and installs the connection gate. Start `cs2` through systemd. Original installer backup: `/home/steam/csbatagi-backups/updater-20261001T213857Z`.

The initial website deployment used `deploy-updates-web.py`, layering only `gameServer.js`, `gameUpdateStatus.js` and workstation-built Next output onto the installed images. The changes were then published in commit `b5edecf` and deployed through the normal backend/frontend registry builds. Production database/runtime volumes and 256 MiB backend/frontend limits are preserved. Initial rollback metadata remains at `/home/runner/cs2-updates-web-backup-20261001t214413z/rollback.yml` and the manual override at `/home/runner/docker-compose.cs2-updates.yml`; normal CI deployment does not use that override and image pruning can remove its images. Check image availability before using those initial rollback files.

Operator rollback must happen on an empty server. Restore backed-up service/source files and reload systemd; keep demos, private credentials and stats untouched. Restoring an old service disables automatic updates, so it is an emergency recovery step, not a return to reliable client compatibility. The current game remains updated.

## Verification record

The final cold boot accepted CS2 patch 1.41.8.8 / server version 2000922 / Steam build 25640462, Metamod 1473, CounterStrikeSharp 1.0.376, patched MatchZy Enhanced 1.4.35 and patched Inventory Simulator source 3.3.0. Both plugins loaded and the skins API check passed. The accepted core gamedata revision is `6d22cb54dc27f7cad1c5137474e5e9cdde73efbe`.

The cold reboot reached Ready without warnings at 22:02 UTC on 1 October. Its isolated recording was 161,547 bytes, with the CS2 demo header and observed growth. An external A2S query subsequently returned Dust II, version 1.41.8.8 and VAC enabled. During verification the same public UDP endpoint was blocked. Frontend and backend member API checks both returned the verification stage with `serverReady=false`. No diagnostic recording entered the production demo inventory.

Normal website deployment subsequently spent 641 seconds hydrating the unchanged published stats snapshot. The final updater adds the longer inventory API recovery window and avoids quarantining plugins for that external outage. Its live startup reached Ready at 22:30 UTC, recorded against the exact depot build, and both member API paths returned HTTP 200 with `serverReady=true`. Repeated maintenance starts exhausted GitHub's anonymous API quota (HTTP 403, remaining zero); the final startup retained and verified the already updated plugin stack with a local warning. The next cold opening checks upstream versions again. No players or production matches were used for these checks.

Local checks: 44 focused backend tests, seven updater filesystem/version/recovery tests, standalone TypeScript checking, Next production build and custom plugin compilation passed. Recovery tests cover archive traversal, credential/config preservation, restoring old/new plugin files, an inventory API outage and delayed recovery, and the shorter native failure deadline. Live member API checks verified both backend and frontend report preparation rather than Ready during native testing; public UDP remained blocked then. Human client acceptance remains necessary for joining, voice capture and visible skins.
