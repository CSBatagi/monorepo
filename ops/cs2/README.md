# CS Batagi game server

Deployed on 10 September 2026. See the [deployment and validation record](../../docs/operations/cs2-resurrection-deployment.md). This directory contains the source for the custom integration; credentials and binary packages are deliberately excluded.

## Current managed stack

As of 1 October 2026: CS2 1.41.8.8, Metamod 1473, CounterStrikeSharp 1.0.376, patched MatchZy Enhanced 1.4.35 and patched Inventory Simulator source 3.3.0. `update-stack.py` checks game and plugin updates before cold-boot startup, preserving our integrations. See the [automatic-update runbook](../../docs/operations/cs2-automatic-updates.md).

## Original September installation

- CS2 updated with `/usr/games/steamcmd`, app 730; running patch 14181.
- Metamod build 1411. Build 1466 failed CounterStrikeSharp's SourceHook API requirement in this environment; do not substitute it blindly.
- CounterStrikeSharp v1.0.374, Linux package including its runtime.
- [MatchZy Enhanced v1.4.24](https://github.com/sivert-io/MatchZy-Enhanced/releases/tag/v1.4.24), commit `7641c7a005318d7580ec8bf69de1b8f957c4cef7`, plus `CSBatagi.cs` and `patch-matchzy.py`.

`build.ps1` requires a checkout at that exact commit, Python, and .NET SDK 8. It applies checked integration edits and publishes the plugin and its dependencies. Preserve upstream licensing when distributing the resulting build. Rebuild after changing either C# or the patch; do not hot-reload the assembly in a running match.

```powershell
./ops/cs2/build.ps1 -Source C:/path/to/MatchZy-Enhanced -Dotnet dotnet -Output C:/path/to/publish
```

## Runtime

The Ubuntu VM runs `cs2.service` as `steam`, with `csbatagi-demos.service` maintaining a durable upload queue. Enable/start these through systemd. The old SteamCMD-on-every-boot launcher is not the active entry point. The game's working directory is `/home/steam/cs2/game/csgo`.

- `cfg/csbatagi_secrets.cfg`: existing join password, RCON password, renewed Steam game-server login token; mode 0640, owner steam.
- `cfg/csbatagi-web-token`: shared backend bearer credential, mode 0640; supplied privately during deployment. The plugin only attaches it to the exact `https://csbatagi.com/backend/get-match/` endpoint.
- `demos/`: actual local disk, not a Cloud Storage FUSE mount.
- `csbatagi-state/`: recording status, upload queue database, upload status.
- `/home/steam/resurrection-packages/installed-sha256.json`: installed package and plugin hashes.
- `/home/steam/resurrection_backup_20260910/`: pre-upgrade files. Contains secrets; keep private.

`install.py` is an installation tool for this existing VM layout, not a generic cloud provisioner. First stage the tested packages in `/home/steam/resurrection-packages`, the complete published plugin as `/tmp/csbatagi-matchzy.tgz`, and the pinned upstream `cfg/MatchZy` tree as `/tmp/csbatagi-matchzy-cfg.tgz`. Complete SteamCMD successfully and stop CS2 before invoking it. Preserve/provision the private website token separately. It backs up the previous plugin and preserves existing admins and server credentials.

Automatic updates on opening are installed through `install-updater.py`. The [runbook](../../docs/operations/cs2-automatic-updates.md) describes checked game updates, custom plugin builds, the public connection gate, readiness reporting and failure recovery. Use this managed installation for current deployments; `install.py` and the original pinned build commands above describe the September installation.

## Idle shutdown

`csbatagi-idle-shutdown.timer` checks the VM every minute and runs `systemctl poweroff` after 15 minutes in a row with no human players and no activity: CS2 startup/updates, a match, demo uploads or analysis, apt/dpkg, or an admin's SSH terminal. Bots do not count. The instance then shows `TERMINATED` and the website starts it as usual. Logs: `journalctl -u csbatagi-idle-shutdown`. Switch it off with `sudo touch /etc/csbatagi/idle-shutdown.disabled`. The [idle shutdown runbook](../../docs/operations/cs2-idle-shutdown.md) covers every signal, the settings, installation with `install-idle-shutdown.py`, and rollback.

## Player flow

Members can configure weapon skins, knives, gloves, agents, stickers, charms and music at `/ekipman`. See the [equipment feature and deployment runbook](../../docs/features/server-cosmetics.md). The pinned Inventory Simulator plugin runs alongside MatchZy; `!ws` refreshes saved equipment for the next spawn.

1. Use the website's current CS2 launch link or copyable `connect` command with the existing server password. The Premium-tier public IP is ephemeral; see [dynamic address discovery](../../docs/operations/cs2-dynamic-addresses.md).
2. Warm up indefinitely. `.guns` opens a primary-weapon menu; selections are remembered for the process lifetime. Default loadout is AK, Deagle and knife, with armor and unlimited reserve ammo. Respawns are enabled. Bots fill toward six total combatants when at least one human is connected.
3. An authenticated website admin loads balanced rosters of 1–10 players per team from the team picker. Connected players and reconnects are automatically moved onto the roster's configured CT/T sides during warmup. Every rostered player uses `.ready`; the final ready automatically starts the normal match/demo preparation once both complete rosters are connected on the correct sides. There is no automatic ready countdown or knife round. A new website match can replace a loaded warmup after its payload is fetched and validated; an active match or recording cannot be replaced.
4. Gameplay bots are removed. Live rules are restored. The pistol freeze is held until the demo file exceeds 256 KiB and grows. Defaults are MR12, MR3 overtime, friendly fire, normal economy and no respawns.
5. `.pause` requests a freeze-time pause. Both teams `.unpause` to resume; existing game admins can override. The pause count and duration are unlimited. Completing demo preflight releases only the recorder's hold and preserves any player/admin pause. Unpause commands cannot release a preflight or failed-demo hold.

Warmup and live play isolate team voice, including disabling CS2's automatic warmup/halftime all-talk. Only CSTV gets `All | ListenAll` voice flags, with `tv_relayvoice=1`; this must be tested using real client microphone packets. A bot-only demo cannot demonstrate microphone recording.

On 6 October 2026, the installed warmup config still enabled `sv_alltalk` and `sv_full_alltalk`. Both were disabled in the running server and persisted in `cfg/MatchZy/warmup.cfg`; enemy voice and automatic warmup/halftime all-talk were explicitly disabled there and in the base config. RCON readback confirmed all five settings were false. No map change or game restart was needed. Configuration backup: `/home/steam/csbatagi-backups/voice-20261006T215122Z/`. Teammate microphone and CSTV recording acceptance still require real clients.

### Ready checks and Premier round timing

The 7 October investigation found repeated `ArgumentException` failures in `IsTeamReady` during the previous night's `.ready` commands: CounterStrikeSharp's `CsTeam` enum is backed by `byte`, but upstream passed a boxed `int` to `Enum.IsDefined`. The checked integration patch now passes a `CsTeam` value, allowing normal all-ready processing to reach match preparation. It preserves the full-roster and unready-player gates; auto-ready remains disabled. Server-console-only `csbatagi_ready_check` reports the actual team/spectator ready checks without starting a match.

`live_override.cfg` explicitly restores Valve's current timing after MatchZy's live config:

| Timing | Cvar | Value |
| --- | --- | --- |
| Premier freeze time | `mp_freezetime` | 20 seconds |
| Post-round weapon pickup window | `mp_round_restart_delay` | 7 seconds |
| Buy time | `mp_buytime` | 20 seconds |
| Round time (defuse/hostage/general) | `mp_roundtime*` | 1.92 minutes (HUD 1:55) |
| Halftime | `mp_halftime_duration` | 15 seconds |
| Planted bomb | `mp_c4timer` | 40 seconds |

Sources checked against the installed Valve files and game help on 7 October: [Premier matchmaking override](https://github.com/SteamTracking/GameTracking-CS2/blob/master/game/csgo/cfg/gamemode_competitive_tmm.cfg), [base competitive config](https://github.com/SteamTracking/GameTracking-CS2/blob/master/game/csgo/cfg/gamemode_competitive.cfg), and [engine convar defaults](https://github.com/SteamTracking/GameTracking-CS2/blob/master/DumpSource2/convars.txt). Base competitive freeze time is 15 seconds; the Premier matchmaking override raises it to 20. MatchZy previously used 18 seconds freeze and 5 seconds after a round. Pauses and initial demo preflight are separate from these normal round timers.

Local validation: patch applied twice, .NET 10 plugin compilation passed, all 18 upstream ready-rule tests passed, and a regression harness confirmed the original enum expression throws against the real CounterStrikeSharp API while the compiled patched `IsTeamReady` passes. Full ready rosters pass and absent/unready players block at 1, 5, 7 and 10 players per side. Deployment backup: `/home/steam/csbatagi-backups/ready-timing-20261006T232632Z/`.

Managed startup accepted integration `be479397d49999d955123aadad1d2e8b72a49b01c950dae7bbafa9a148a7d772` with no warning/error. The native `csbatagi_ready_check` succeeded, including the spectator gate. On the empty server, executing the complete installed `MatchZy/live.cfg` and reading all eight timing cvars confirmed the table above; warmup was restored in `finally`. Final guards confirmed healthy CSTV, no humans, no match/recording and no pending uploads. The game service was stopped and the VM returned to its original off state. A complete human all-ready match remains an acceptance check for the next game night; no synthetic match or production demo was generated by the readiness/timing checks.

## Demos and recovery

The integration verifies file growth instead of treating `tv_record` as proof. A stalled file requests a pause after at least 90 seconds (longer if TV delay requires it). Start is blocked below 4 GiB free disk or without CSTV. This detects missing/stalled output, not every possible corrupt packet or missing audio stream.

The uploader waits for the writer to close and the file to settle. It preserves interrupted leftovers, retries after restarts, uploads create-only objects under `gs://csbatagi-demos/resurrection/`, and verifies the remote MD5. It never deletes local files. Interrupted status lives in adjacent `.closed.json` files; an archived object is not automatically proof of a complete match. Plan explicit retention after checking backups, because this disk is finite.

```sh
sudo systemctl status cs2 csbatagi-demos
sudo python3 /usr/local/lib/csbatagi/rcon-local.py csbatagi_status
sudo journalctl -u csbatagi-demos --since today
df -h /home/steam/cs2
```

If recording stalls, keep players paused, diagnose disk/CSTV, and use `csbatagi_retry_demo` through the local RCON helper. Verify a new file grows before issuing `css_forceunpause`. Preserve both files. A controlled `tv_stoprecord` fault test passed on the empty server; disk-full and network-outage scenarios remain untested.

Normal single-map completion resets to warmup. The bot simulation can remove CSTV at match end; the integration reloads the map after closing the demo if CSTV is missing. Do not interrupt an active recording with a plugin reload or map change. `css_endmatch` is a destructive match reset intended for admins.

### Disk retention

A map records about 0.3–0.6 GB, so check `df -h /` before a game night: recording needs 4 GiB free plus room for every planned map. Nothing deletes files automatically. Clean up only while `csbatagi_status` shows no match loaded, live, preparing or recording, no humans, and `uploads.pending` 0.

**Local demos: delete as soon as they are analyzed.** A `demos/*.dem` file may be removed when all of these hold:

- its `.closed.json` state is `map-ended`;
- `uploads.sqlite` says `verified`, and the bucket object `resurrection/<name>`, re-read at deletion time, has the same size and MD5 as the local file;
- CS Demo Manager's `matches` table has a row whose `demo_path` ends in the file name. The CLI settings in `/home/steam/.config/csdm/settings.json` reach the database.

Keep the small `.closed.json` markers. The website row stays (`on_game_server` turns false), downloads keep working from the bucket, and re-analysis restores the file from the archive. Auto-queueing only considers demos that are still on the VM, which is why analysis must come first. Keep anything that fails a check (interrupted/reset recordings, unanalyzed non-website matches) until an admin decides. The 13 September 2026 test recordings (about 67 MB) are listed as verified in `uploads.sqlite`, but on 17 October 2026 they were no longer in the bucket (no soft delete or versioning), so the local files are the only copies.

`csbatagi-state/analysis-downloads/` holds demos the worker restored or fetched for analysis, and the worker never clears it. Delete a file there once it is analyzed and its bucket copy matches. `uploads/` objects are only readable from a workstation, not by this VM's account.

**Workshop maps.** `host_workshop_map` caches every map it ever loaded in `game/bin/linuxsteamrt64/steamapps/workshop/content/730/<id>/`, and records it in `appworkshop_730.acf` (both `WorkshopItemsInstalled` and `WorkshopItemDetails`). To drop an item that is not in `frontend-nextjs/public/data/maps.json`:

1. Stop `cs2` while it is idle. The running server keeps the manifest in memory and writes the removed entries back.
2. Back up the `.acf`.
3. Remove both blocks for the ID, and set `SizeOnDisk` to the sum of the remaining `size` values.
4. Delete the folder.
5. Start `cs2`.

Do not touch `game/csgo_community_addons/`, which is Valve's official map content.

On 17 October 2026 this removed 20 non-catalog Workshop items (10.7 GiB; manifest backup `/home/steam/csbatagi-backups/appworkshop_730.acf.before-cleanup-20261017`), ten analyzed match demos from 6–16 October (3.8 GiB) and four analyzed xplay demos from the analysis cache (1.1 GiB). Free space went from 5.2 GB to 21 GB. The unanalyzed 13 October Train demo and the September test recordings stayed. The systemd journal has no size cap (4.1 GB that day) and was left alone.

## Automatic analysis

`csbatagi-analyzer.service` runs [`demo-analyzer.py`](demo-analyzer.py) as `steam`. It reports the local demo inventory to the backend every minute, and when the backend hands back jobs and no match is live, it runs `csdm analyze <file> --source matchzy` (the CS Demo Manager CLI, pinned to the desktop app's version) under `nice`/`ionice`. Demos members uploaded from other servers arrive with a signed download link, the match time (set as the file's mtime, which CS Demo Manager uses as the match date) and their own `--source` (MatchZy by default; `auto` omits the flag). The backend queues finished website matches automatically and verifies every result against the CS Demo Manager tables. "Analiz et" on the website starts this VM when it is off and the backend stops it again after 15 idle minutes with nobody on it; a VM opened with "Server Aç" is never closed that way (the VM's own [idle shutdown](#idle-shutdown) still applies to every VM). Worker updates are installed by the [Demo analysis setup](../../.github/workflows/demo-analysis-setup.yml) workflow ([`analyzer-maintenance.sh`](analyzer-maintenance.sh) does the on-VM part). First install with [`install-analyzer.sh`](install-analyzer.sh); the database credentials live only in `/home/steam/.config/csdm/settings.json` (mode 600). Details: [demo analysis and downloads](../../docs/operations/demo-analysis-and-downloads.md).

```sh
sudo systemctl status csbatagi-analyzer
sudo journalctl -u csbatagi-analyzer --since today
```

## Website control and deployment

The team picker and equipment page share an explicit CS2 launch link (`steam://run/730/` with an encoded `+connect` argument) to the current public game IP discovered through Compute Engine, or the freshly reported Steam relay identity when SDR is enabled. They also show a copyable console command for clients where the browser/Steam launch handoff fails, with a current direct-IP fallback for relay connections. Joining waits for startup readiness and a discovered address; failed discovery never falls back to an old IP. The existing join password is still required; it is not embedded in public links. See the [SDR runbook](../../docs/operations/cs2-sdr.md) for the selective installer, update persistence, password admission gate and pending live verification.

The frontend verifies the signed login session and forwards it with the server bearer token. The backend checks the `admins` table, validates rosters, persists the match JSON, asks MatchZy to fetch it through an authenticated URL, and waits for its match ID acknowledgment. RCON connects to the VM's discovered private IP. VM actions and address discovery are restricted in code to `cs2-server` / `europe-west3-c`. See the [dynamic address runbook](../../docs/operations/cs2-dynamic-addresses.md) for cache behavior, rollout and DNS limitations.

Match map entries accept `de_...` stock names and positive numeric Workshop PublishedFileIds as strings, matching the team picker's `frontend-nextjs/public/data/maps.json` catalog and MatchZy's `host_workshop_map` support. Do not convert Workshop IDs to `de_...` names: for example, Tuscan is `3267671493`. The backend regression tests cover every catalog entry and the mixed Overpass/Tuscan/Vertigo series; the old stock-only validator rejected that series with HTTP 400 before contacting the game server.

On 11 September 2026 this validation fix was deployed as a local backend image layer containing only `gameServer.js`, with the backend recreated using `--no-deps --pull never`. Its 256 MiB memory limit was preserved; the game server was not restarted. The prior image is tagged `csbatagi-backend:before-workshop-map-fix-20260911` on the backend VM. Publish the source fix through CI before the next registry-image pull, which would replace this local image. Validation covered 21 focused tests and the deployed validator; this does not establish that every catalog Workshop item can still be downloaded or played.

The initial deployment uses local derived Docker images on the backend VM. Commit/review/publish these source changes through the normal deployment process before replacing those images with a routine release. Never build the frontend on the 1 GiB backend VM; the tested build was produced locally, and Docker memory limits were preserved.

The website stop action refuses while a match/recording is active or uploads are pending/stale. Google Cloud console actions can bypass that protection; wait for verified archives before an operator shutdown.

### 11 September follow-up fixes (source only)

The roster assignment, warmup replacement, demo/pause ownership and connection-link changes require rebuilding/deploying MatchZy, backend and frontend. They have not been applied to the running server in this task. Restart the game service during an agreed idle window; do not hot-reload MatchZy into an active game. The earlier Workshop-map deployment paragraph refers only to that earlier backend fix.

Local validation: 29 focused backend tests passed (`gameServer.test.js` and `rcon.test.js`); standalone TypeScript checking and the Next production build passed; the plugin compiled from a fresh archive of the pinned revision, including a second patch application to check idempotence. These checks do not simulate the native CS2 engine or a browser-to-Steam handoff.

After rollout, verify with real clients: load a roster while players are already connected and at team selection; reconnect a rostered player; replace the warmup with another map and reversed CT/T sides; pause during demo preflight and confirm it remains held until both teams unpause; repeat a pause during ordinary live play; open the CS2 link and try the console fallback. The existing bot-only deployment evidence does not cover these human flows.
