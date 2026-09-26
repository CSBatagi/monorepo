# CS Batagi game server

Deployed on 10 September 2026. See the [deployment and validation record](../../docs/operations/cs2-resurrection-deployment.md). This directory contains the source for the custom integration; credentials and binary packages are deliberately excluded.

## Pinned stack

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

## Player flow

Members can configure weapon skins, knives, gloves, agents, stickers, charms and music at `/ekipman`. See the [equipment feature and deployment runbook](../../docs/features/server-cosmetics.md). The pinned Inventory Simulator plugin runs alongside MatchZy; `!ws` refreshes saved equipment for the next spawn.

1. Join `cs2.csbatagi.com:27015` with the existing server password.
2. Warm up indefinitely. `.guns` opens a primary-weapon menu; selections are remembered for the process lifetime. Default loadout is AK, Deagle and knife, with armor and unlimited reserve ammo. Respawns are enabled. Bots fill toward six total combatants when at least one human is connected.
3. An authenticated website admin loads balanced rosters of 1–10 players per team from the team picker. Connected players and reconnects are automatically moved onto the roster's configured CT/T sides during warmup. Every rostered player uses `.ready`. There is no automatic ready countdown or knife round. A new website match can replace a loaded warmup after its payload is fetched and validated; an active match or recording cannot be replaced.
4. Gameplay bots are removed. Live rules are restored. The pistol freeze is held until the demo file exceeds 256 KiB and grows. Defaults are MR12, MR3 overtime, friendly fire, normal economy and no respawns.
5. `.pause` requests a freeze-time pause. Both teams `.unpause` to resume; existing game admins can override. The pause count and duration are unlimited. Completing demo preflight releases only the recorder's hold and preserves any player/admin pause. Unpause commands cannot release a preflight or failed-demo hold.

Warmup uses all-talk. Live play isolates team voice. Only CSTV gets `All | ListenAll` voice flags, with `tv_relayvoice=1`; this must be tested using real client microphone packets. A bot-only demo cannot demonstrate microphone recording.

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

## Automatic analysis

`csbatagi-analyzer.service` runs [`demo-analyzer.py`](demo-analyzer.py) as `steam`. It reports the local demo inventory to the backend every minute, and when the backend hands back jobs and no match is live, it runs `csdm analyze <file> --source matchzy` (the CS Demo Manager CLI, pinned to the desktop app's version) under `nice`/`ionice`. Demos members uploaded from other servers arrive with a signed download link, the match time (set as the file's mtime, which CS Demo Manager uses as the match date) and their own `--source` (MatchZy by default; `auto` omits the flag). The backend queues finished website matches automatically and verifies every result against the CS Demo Manager tables. Install with [`install-analyzer.sh`](install-analyzer.sh); the database credentials live only in `/home/steam/.config/csdm/settings.json` (mode 600). Details: [demo analysis and downloads](../../docs/operations/demo-analysis-and-downloads.md).

```sh
sudo systemctl status csbatagi-analyzer
sudo journalctl -u csbatagi-analyzer --since today
```

## Website control and deployment

The team picker and equipment page share an explicit CS2 launch link (`steam://run/730/` with an encoded `+connect` argument) to the reserved public game IP. They also show a copyable console command for clients where the browser/Steam launch handoff fails. The existing join password is still required; it is not embedded in public links.

The frontend verifies the signed login session and forwards it with the server bearer token. The backend checks the `admins` table, validates rosters, persists the match JSON, asks MatchZy to fetch it through an authenticated URL, and waits for its match ID acknowledgment. RCON connects to private IP `10.156.0.11`. VM actions are restricted in code to `cs2-server` / `europe-west3-c`.

Match map entries accept `de_...` stock names and positive numeric Workshop PublishedFileIds as strings, matching the team picker's `frontend-nextjs/public/data/maps.json` catalog and MatchZy's `host_workshop_map` support. Do not convert Workshop IDs to `de_...` names: for example, Tuscan is `3267671493`. The backend regression tests cover every catalog entry and the mixed Overpass/Tuscan/Vertigo series; the old stock-only validator rejected that series with HTTP 400 before contacting the game server.

On 11 September 2026 this validation fix was deployed as a local backend image layer containing only `gameServer.js`, with the backend recreated using `--no-deps --pull never`. Its 256 MiB memory limit was preserved; the game server was not restarted. The prior image is tagged `csbatagi-backend:before-workshop-map-fix-20260911` on the backend VM. Publish the source fix through CI before the next registry-image pull, which would replace this local image. Validation covered 21 focused tests and the deployed validator; this does not establish that every catalog Workshop item can still be downloaded or played.

The initial deployment uses local derived Docker images on the backend VM. Commit/review/publish these source changes through the normal deployment process before replacing those images with a routine release. Never build the frontend on the 1 GiB backend VM; the tested build was produced locally, and Docker memory limits were preserved.

The website stop action refuses while a match/recording is active or uploads are pending/stale. Google Cloud console actions can bypass that protection; wait for verified archives before an operator shutdown.

### 11 September follow-up fixes (source only)

The roster assignment, warmup replacement, demo/pause ownership and connection-link changes require rebuilding/deploying MatchZy, backend and frontend. They have not been applied to the running server in this task. Restart the game service during an agreed idle window; do not hot-reload MatchZy into an active game. The earlier Workshop-map deployment paragraph refers only to that earlier backend fix.

Local validation: 29 focused backend tests passed (`gameServer.test.js` and `rcon.test.js`); standalone TypeScript checking and the Next production build passed; the plugin compiled from a fresh archive of the pinned revision, including a second patch application to check idempotence. These checks do not simulate the native CS2 engine or a browser-to-Steam handoff.

After rollout, verify with real clients: load a roster while players are already connected and at team selection; reconnect a rostered player; replace the warmup with another map and reversed CT/T sides; pause during demo preflight and confirm it remains held until both teams unpause; repeat a pause during ordinary live play; open the CS2 link and try the console fallback. The existing bot-only deployment evidence does not cover these human flows.
