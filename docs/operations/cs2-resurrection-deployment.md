# CS2 resurrection deployment — 10 September 2026

This supersedes the earlier inspection and target-plan status. The restored game VM is running an updated stack and is publicly reachable at `cs2.csbatagi.com:27015` (reserved static IP `34.159.222.148`). The join password was preserved. The expired game-server login token was renewed and Steam reported a secure server.

## Implemented

- CS2 patch 14181, Metamod 1411, CounterStrikeSharp 1.0.374 and MatchZy Enhanced 1.4.24 with the versioned [CS Batagi integration](../../ops/cs2/README.md).
- Up to ten players per roster, indefinite respawning warmup, `.guns`, population-based warmup bots, full-roster readiness, pauses and competitive live rules.
- Local demo files, growth checks, CSTV voice routing, persistent create-only archive uploads and checksum verification. Historical bucket objects were preserved.
- Systemd startup, private backend RCON, restricted host firewall, static game IP. Game UDP 27015 is public; RCON TCP is allowed only from the backend private IP; SSH is allowed through IAP. CSTV's spectator port is not public.
- Website admin authorization, persistent authenticated match retrieval, match-load acknowledgment, a live game/demo/archive status panel and guarded VM shutdown.

The game VM is 2 vCPU / 8 GiB, separate from the 1 GiB backend VM. Backend/frontend image replacements preserved the production database and runtime-data volume, and kept the existing Docker memory limits.

## Evidence

| Check | Result |
|---|---|
| SteamCMD update | App 730 reported fully installed; running game patch 14181 |
| Plugin startup | Metamod / CSS / custom MatchZy loaded; actual game simulations ran |
| Dust II 10v10 bot match | Local demo 16,508,262 bytes; parsed 3 completed rounds, 43 deaths, 625 shots and a match-end event |
| Inferno 10v10 bot match | Local demo 16,505,142 bytes; parsed 4 rounds, 25 deaths, 391 shots and a match-end event |
| Archives | Both objects uploaded under `resurrection/`; remote MD5 matched local content |
| Match cleanup | Additional short 10v10 simulation completed and automatically returned to empty warmup, with CSTV restored |
| Website status | Authenticated frontend → backend → game status request returned HTTP 200 with live recording state |
| Website match loading | Authenticated frontend → backend → HTTPS match fetch → game acknowledgment returned HTTP 200 with the correct match ID |
| Stalled recorder | Deliberate `tv_stoprecord` was detected after approximately 90 seconds; status reported `demoFailed=true` and `paused=true` |
| Recorder recovery | `csbatagi_retry_demo` created a different growing file and cleared the failure flag; `css_forceunpause` resumed the match |
| Website stop protection | Authenticated stop request during the recording returned HTTP 409; VM remained running |
| Warmup → live rules | Fresh start verified `sv_infinite_ammo=0`, `sv_cheats=0`, respawns disabled and normal default weapons |
| Source checks | Four focused backend tests passed; Next production build completed; pinned custom plugin compiled |

The first diagnostic recording was interrupted and is retained as evidence, not presented as a successful match. The two named downloads are completed later matches. Bot-only demos contain no human microphone packets. The dedicated human voice test and authenticated website match-load test are tracked separately below.

During the Inferno test, the server's reported average frame time was approximately 7.3 ms and P99 11.0 ms. This is evidence for that bot workload only; it does not establish performance with 20 remote human clients on every map.

## Remaining validation

- Human microphone capture, audible playback in CS Demo Manager, and opposite-team isolation need actual client evidence.
- Full 20-human readiness, pause/resume and spawn validation across all desired maps have not been completed.
- Stalled-demo detection and replacement-file recovery passed an induced failure test on an empty server. Disk-full and real network-outage recovery remain untested.
- Local demo retention remains manual. Files are never deleted by the uploader; available disk must be monitored.
- Source changes are present in this workspace and manually deployed, but are not yet committed/published through CI.

## Downloaded artifacts

On the owner's Windows machine, `C:\Users\onur_\Downloads\CSBatagi-Demos` contains `CSBatagi-10v10-dummy-dust2.dem` and `CSBatagi-10v10-dummy-inferno.dem`. Import those into CS Demo Manager for playback. They contain bots and synthetic test rosters, so do not import their stats into the production club database.

## Operational recovery

Use the [runbook](../../ops/cs2/README.md). The original machine image and `/home/steam/resurrection_backup_20260910` remain available. Website file backups are under `/home/runner/cs2-resurrection-web-backup` on the backend VM. Do not blindly restore the old launch scripts: they contain the old direct-to-FUSE recording and uncontrolled update behavior.

## Credential cleanup

An early diagnostic exposed the legacy launcher's Steam Web API key in task output. The expired game-server login token was separately renewed. The legacy Web API key still needs revocation by its owning Steam account. The currently signed-in CS Batagi account (`76561199061915792`) has no game-server accounts and cannot access API-key management; it is not the account owning the existing server. SteamCMD configuration/history only shows anonymous installation. Steam's public server-account response did not identify its owner. The website uses a different API key, verified by comparing fingerprints without printing either credential. No key values are in this repository.
