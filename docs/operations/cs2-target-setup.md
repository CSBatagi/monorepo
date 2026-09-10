# CS2 target setup — 10 September 2026

Historical planning document. The authorized implementation has since been deployed; see [deployment results and remaining validation](cs2-resurrection-deployment.md). The proposal below records the original design and release gates.

## Decision

Reuse the restored game VM and existing website, but replace the old launch/update/recording arrangement with a controlled installation. Use **MatchZy Enhanced v1.4.24**, upstream CounterStrikeSharp and Metamod, a small CS Batagi warmup component, and a separate durable demo uploader. Keep the source machine image as rollback. Do not restore the entire collection of old plugins.

This is the preferred candidate for implementation, not a claim that the combination already passes current CS2 compatibility or 20-player performance tests. Those are release gates below.

## Confirmed requirements and proposed defaults

| Area | Target behavior |
|---|---|
| Match sizes | Competitive matches up to 10 vs 10; use the actual selected roster size for each match, including smaller games. |
| Warmup | Indefinite, instant respawns, selectable guns, bots when few humans are online. Useful with one human. |
| Starting | Both teams must be ready. Proposed default: everyone in the selected rosters connects and readies; no automatic countdown, auto-ready or forfeit timer. |
| Pauses | Players can request a pause at the next freeze time. Both teams must agree to resume; admins can override. Proposed default: no automatic expiry or fixed pause count. |
| Demos | Automatically record each live map, verify recording, preserve completed files and upload them to the existing bucket. Failures must be visible. |
| Rules | Proposed defaults inherited from the old server: MR12, six-round overtime, friendly fire, no knife round. These are adjustable defaults, not additional user requirements. |

Target 24 server slots to leave room around 20 playing humans for CSTV and limited spectators. Validate the actual slot accounting and each supported map's spawn capacity. Merely setting a slot limit does not prove 10 vs 10 works.

## Why this mod

The existing MatchZy installation is 0.8.15; the original project's latest release is still that October 2025 version. Reinstalling the same release would not address the operational weaknesses found on the old server. [Original release](https://github.com/shobhit-pathak/MatchZy/releases/tag/0.8.15).

MatchZy Enhanced v1.4.24 was released on 29 August 2026 and includes a recent readiness fix. Its match loader accepts configurable `players_per_team`, and the readiness implementation requires full rosters; a zero `min_players_to_ready` means everyone on each team must ready. This is a close fit for the existing website's MatchZy match payload. [Release](https://github.com/sivert-io/MatchZy-Enhanced/releases/tag/v1.4.24), [match loader](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/src/MatchManagement.cs), [readiness implementation](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/src/ReadySystem.cs).

Other candidates considered:

| Candidate | Assessment for this server |
|---|---|
| Original MatchZy 0.8.15 | Familiar and already integrated, but the old configuration and recording arrangements still require repair. No newer original release found. |
| MatchZy Enhanced 1.4.24 | Preferred: maintained MatchZy continuation, suitable roster/readiness/pause controls, familiar integration. Requires explicit warmup and demo hardening. |
| Miksen MatchZy 0.8.80 | Strong alternative, with useful demo growth checks and restart logic. Also brings a broader practice feature set and a different build dependency setup. Worth borrowing design lessons from, but not a demonstrated complete solution for our combined warmup/recording requirements. |
| PugSharp 0.1.19-beta | Credible match-management alternative, but the latest release is marked beta and adopting it adds integration work without an established advantage for this deployment. |

Miksen's release notes specifically discuss buffered demo writes, stalled recordings and CSTV interactions with bot management. These are maintainer reports, not proof of the cause of our historical failures. Its inspected warmup bot implementation still contains broad bot-removal commands, so the full lifecycle would need testing there too. [Miksen releases](https://git.miksen.me/mikkel/matchzy/releases), [PugSharp release](https://github.com/Lan2Play/PugSharp/releases/tag/v0.1.19-beta).

CounterStrikeSharp v1.0.374, released 7 September 2026, is the current upstream candidate. Select a compatible Metamod build and current CS2 build together during installation; record versions and hashes after validation. Do not download arbitrary latest plugin versions on every boot. [CounterStrikeSharp release](https://github.com/roflmuffin/CounterStrikeSharp/releases/tag/v1.0.374).

## Warmup and readiness implementation

Keep the server in the competitive game mode and apply a warmup-only ruleset. This avoids an unnecessary game-mode or map change when everyone readies.

- Respawn immediately; provide armor and unlimited reserve ammunition while retaining reloads.
- Provide a `.guns` menu with remembered primary/secondary selections and grant the selection on respawn. This is custom work; it is not a verified built-in MatchZy Enhanced feature.
- Start with a small population of bots, targeting approximately six total warmup combatants when quiet. Reduce bots as humans join, and remove all gameplay bots before live play.
- Allow warmup both before a website match is selected and while its selected rosters are assembling.
- Keep the warmup timer paused indefinitely. Disable auto-ready, simulated players and timed forfeits.
- Exclude bots and CSTV from readiness counts. Bot removal must explicitly exclude CSTV; reserve headroom before adding bots.
- End warmup only after the selected rosters are ready and demo preflight succeeds. Restore live respawn, ammunition, armor, economy and damage rules explicitly.

Enhanced's shipped warmup config disables respawning, and `humans.cfg` removes bots. Its separate warmup settings do not cover every loaded-match state. Consequently, configuration overrides plus a lifecycle-aware companion are required; installing an unrelated deathmatch plugin beside MatchZy would introduce competing ownership of the same settings. [Warmup config](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/cfg/MatchZy/warmup.cfg), [human-player config](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/cfg/MatchZy/humans.cfg), [warmup settings](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/src/WarmupSettings.cs).

Per-match JSON should include a unique match identifier, actual `players_per_team` between 1 and 10, balanced validated rosters, and `min_players_to_ready: 0`. Do not hardcode every match to ten players per team or smaller matches will wait forever for absent players. Preserve the website's selected maps and starting sides.

Use the plugin's normal pause path with unlimited count/duration and both-team resumption. Keep automatic readiness and forfeit features off. [Configuration reference](https://me.sivert.io/configuration/).

## Demo reliability is a separate requirement

The old setup wrote directly into a GCS FUSE mount. Its fallback could leave files on the local directory underneath that mount, with no durable upload queue. This is a confirmed design weakness; it does not establish that storage was the sole cause of the tiny demos.

Enhanced still marks recording as started immediately after issuing `tv_record`. A logged start event therefore does not establish that a usable demo is being written. Its existing upload retries are useful but do not replace a queue that survives process/VM restarts. [Recording implementation](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/src/DemoManagement.cs), [upload implementation](https://github.com/sivert-io/MatchZy-Enhanced/blob/v1.4.24/src/Utility.cs).

Required design:

1. Enable CSTV from server startup and keep it enabled across the match lifecycle. Remove website control of recording-related convars. Audit generic bot kicks and map/reset transitions so they cannot silently invalidate recording.
2. Write demos to the VM's persistent local filesystem, outside the bucket mount. Use unique names containing match ID, map number and attempt number; never overwrite a previous attempt.
3. Integrate a recording preflight with the match controller. Account for engine buffering and restarts when deciding whether a file is healthy; verify that the live demo covers the pistol round. A header-only file is not success.
4. Monitor growth during live play with a delay-aware grace period. On a confirmed failure, make it visible to players/admins and pause at a safe boundary. Preserve partial files and identify any missing interval; restarting recording cannot recover lost ticks.
5. After recording is closed, persist an upload job locally. Upload directly from the game VM to GCS with retries, checksum verification and restart-safe job state. Do not proxy large demos through the 1 GB website VM.
6. Distinguish `recording`, `saved locally`, `uploaded and verified`, and `failed`. Only the verified upload state means archived successfully. File growth alone does not prove playback quality.
7. Retain local files until remote verification succeeds. On low disk space, refuse new matches before exhausting space; never delete the only unuploaded copy to make room. Set retention after measuring actual demo sizes.
8. Coordinate server shutdown with recording closure and upload state. If uploads cannot finish, preserve queued files and report the pending state; do not claim the demos are archived.

Google documents filesystem-semantic differences, latency and transient errors for Cloud Storage FUSE. Local recording followed by object upload avoids making the live recording writer depend on that interface. [Google Cloud Storage FUSE overview](https://docs.cloud.google.com/storage/docs/cloud-storage-fuse/overview?hl=en).

Voice recording must be checked using the current game and demo playback. Do not reinstall the old FixDemoVoiceChat plugin solely because a historical copy exists.

## VM and website work

Reuse the current 2-vCPU/8-GB VM initially. Its suitability for 20 active players plus recording is unmeasured. Benchmark server frame time, CPU, memory and disk writes before deciding on a resize. There are only about 26 GiB free on the restored filesystem, so check update and recording headroom before downloading game updates.

Replace the broken SteamCMD path and fail-open update pipeline with a controlled update procedure. Run the game under systemd with orderly shutdown and logs. Keep plugin versions pinned separately from game updates, and run a short compatibility check after a game update before accepting a match.

Before reconnecting website controls:

- Correct the game VM name/zone: deployed controls currently target `backend-1`, the website VM.
- Add session/admin authorization to game-control routes; restrict arbitrary match cvars and validate roster sizes/Steam IDs/maps.
- Make RCON await authentication and a command result, then obtain game-state acknowledgement before reporting a match as loaded.
- Replace the destructive, global `/get-match` handoff with an authenticated, persistent match-ID lookup that can be retried safely.
- Replace the missing `load_all.cfg` action with explicit supported lifecycle operations. Keep one match manager loaded.
- Establish a verified game endpoint and update stale DNS only after network and game checks. Keep RCON restricted to the backend/admin path.
- Add recording/archive status to match results and provide an authenticated demo download path as appropriate.

## Release gates

These are required tests, not completed checks:

- One human can warm up with bots, respawn and change guns; leaving the server idle does not start a match.
- A loaded match stays in warmup beyond any default timeout until both rosters are ready. Bots never satisfy readiness.
- 6 vs 6 and 10 vs 10 pass roster assignment, simultaneous spawning, team switching, halftime and overtime on supported maps. Verify spectator/CSTV headroom.
- Live play has no warmup respawns, free equipment or gameplay bots. Pause/resume works with both teams and with an admin override.
- Consecutive matches and map changes each produce distinct demos covering pistol through the final round, with expected voice and successful playback on a current client.
- Simulated recording failure is detected and reported. Buffered writes and normal pauses do not trigger false failures.
- An upload outage leaves a durable queue; restarting the service/VM resumes upload, verifies the remote object and preserves the local copy until success.
- Low disk space and shutdown during/after a match follow the preservation rules above.
- Twenty active players with recording meet an agreed server-performance threshold; bot-only testing does not substitute for the final human playtest.

## Inspection provenance

Source inspection used MatchZy Enhanced commit `7641c7a005318d7580ec8bf69de1b8f957c4cef7` (v1.4.24) and Miksen commit `4c465673f6eb17144538214da370ec79675d2b2a` (0.8.80). Public sources were cloned only into a local temporary research directory. No third-party code was executed, and no server software, website configuration, DNS or firewall changes were made during this selection step.
