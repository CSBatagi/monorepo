# Restored CS2 installation status — 10 September 2026

Historical inspection snapshot, before the upgrade. See [current deployment and tests](cs2-resurrection-deployment.md) for the subsequently installed server. The values below describe the original restored disk.

## Restore and current state

Restored the `cs2-server` machine image dated 3 March 2026 into a new instance named `cs2-server` in project `esoteric-dryad-256520`, zone `europe-west3-c`.

| Item | Verified value |
|---|---|
| VM status | RUNNING; SSH successful as `csbatagi`, with sudo available |
| Instance ID | `3061525340981476066` |
| Machine | `n2d-standard-2`, 2 vCPUs, 8 GiB RAM |
| Disk | Restored 120 GB boot disk; filesystem reports 117 GiB total, 91 GiB used, 26 GiB available (79% used) |
| OS | Ubuntu 22.04.5 LTS; kernel shown at boot: `6.8.0-1048-gcp` |
| Networking | Private IP `10.156.0.11`; no external IP. SSH through IAP. |
| Game process | Not running; no listeners on the checked game ports 27015–27020 |
| Docker | No containers listed, running or stopped |
| Automatic launch | Instance metadata startup script replaced with a documented no-op for inspection; original `/gcp.sh` remains on disk unchanged |

The VM is left running and incurs normal Compute Engine charges. It is an inspection instance, not a publicly playable game server. No game/plugin updates, game launches, website changes, firewall changes, or DNS changes were performed. The source machine image and demo bucket were preserved.

Cloud-init generated new host keys on restore. The new ED25519 key was verified through Compute Engine guest attributes and serial boot output, then recorded under the new instance ID in the local Google Compute known-hosts file. The old entry was retained.

SSH for a future session:

```powershell
gcloud compute ssh csbatagi@cs2-server --project=esoteric-dryad-256520 --zone=europe-west3-c --tunnel-through-iap
```

## Installed game and mod stack

Main installation: `/home/steam/cs2`. The saved server was simplified on 28 February 2026 into a minimal competitive/MatchZy installation.

| Component | Installed version/evidence |
|---|---|
| CS2 | `1.41.3.7`, server/client version `2000738`; Steam build ID `22099296` |
| CS2 build date | `steam.inf`: 25 February 2026, 13:52:57; app manifest last updated 28 February 2026, 16:32:04 UTC |
| Metamod:Source | `2.0.0-dev+1387`, verified in binary strings and historical game logs |
| CounterStrikeSharp | `v1.0.363` in the installed version manifest; bundled runtime present; historical logs show successful API startup |
| MatchZy | `0.8.15`, verified in the version manifest and historical successful plugin-load log |
| Steam Linux Runtime | Runtime 3.0 (sniper), build `21588693`; `/home/steam/steamrt/run` exists |
| Cloud Storage FUSE | `3.7.1` |

These are the versions found on the restored disk, not a comparison against September upstream releases. No updates were downloaded. Shell syntax checks passed for the startup/updater scripts, and `ldd` reported no missing direct dependencies for the CS2 executable. That is not a live game/mod compatibility test.

The active CounterStrikeSharp plugin directory contains **only MatchZy**. Metamod is referenced in `gameinfo.gi`, and its CounterStrikeSharp loader file is present. CounterStrikeSharp previously loaded six admins; MatchZy initialized a local SQLite database successfully.

Older files survive outside the active installation:

- Deathmatch under `cs2/custom_files.old` and the pre-clean backup.
- FixDemoVoiceChat under `/home/steam/custom_files` and the February 9 remediation backup; disabled copies also exist in older trees.
- K4ryuuDamageInfo under the example tree's disabled plugins directory.
- GameModeManager configuration remnants in custom/backup trees; this does not establish an active GameModeManager plugin.

Relevant backup directories are `/home/steam/backup_before_clean_20260228_165610` and `/home/steam/remediation_backup_20260209_204726`. They were not restored over the active configuration.

## Intended startup and gameplay settings

`/gcp.sh` waits for network, attempts to mount the demo bucket, and invokes `/home/steam/start_cs2.sh` as `steam`.

The launcher attempts a SteamCMD game update/validation, runs `update_plugins.sh`, retries the bucket mount, then starts CS2 directly as a background process. There is no dedicated CS2 systemd service in the inspected service inventory. Steam/root crontabs are absent.

Saved launch settings include competitive game mode, Dust II, port 27015, and a 24-player limit. MatchZy uses autostart mode 1, knife rounds disabled, and a minimum-ready setting of 1. The live override has MR12, overtime enabled, and friendly fire enabled. Warmup config adds ten bots and all-talk.

Although script comments call warmup “DM-style,” both respawn-on-death cvars are 0 in the actual warmup file. The comments should not be treated as proof of deathmatch behavior.

## Concrete issues found

### Broken SteamCMD path

`start_cs2.sh` points to `/home/steam/steamcmd/steamcmd.sh`, which does not exist. SteamCMD is present at `/usr/games/steamcmd`.

The February 28 startup log contains the matching “No such file or directory” error at lines 8 and 883. The launcher lacks fail-fast/pipefail handling and continues into plugin updates and launch. Thus an apparent successful start does not prove that CS2 updated.

### Automatic, unpinned plugin replacement

`update_plugins.sh` downloads the newest available Metamod, CounterStrikeSharp and MatchZy on each launch. It restores selected configuration files afterward. Its saved version file is dated 28 February 2026, 18:49:10 UTC.

Running the old launcher now would attempt to change the inspected software before starting it. That automation was not invoked.

### Website plugin button targets a missing file

Active `cfg/load_match.cfg` exists and runs:

```text
matchzy_loadmatch_url "https://csbatagi.com/backend/get-match"
```

Historical logs confirm that this request fetched a website match and loaded it successfully. The previously inferred server-to-website link is now verified.

Active `cfg/load_all.cfg` is missing. The website's PL button still sends `exec load_all.cfg`; an older copy exists only in the custom/backup tree inspected. The current clean installation therefore does not implement that button's expected configuration file.

The previously identified website VM target bug remains unchanged: start/stop still targets the production `backend-1` VM. Do not use those website controls for this restored instance yet.

## Demo recording findings

Active MatchZy settings:

```text
matchzy_demo_recording_enabled true
matchzy_demo_path mounted_bucket/
matchzy_demo_name_format "{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}"
matchzy_demo_upload_url ""
```

`server.cfg` contains `tv_enable 1`, `tv_delay 0`, and `tv_autorecord 0`; the design relies on MatchZy to initiate recording. Demo output points directly at a Cloud Storage FUSE filesystem rather than a configured MatchZy upload endpoint.

`/etc/fstab` mounts `csbatagi-demos` at `/home/steam/cs2/game/csgo/mounted_bucket` with `_netdev`, `allow_other`, UID 114 and GID 1006. The current mount failed with network timeouts during the private inspection boot. The subnet has no Private Google Access and this VM has no external IP, so this present-day mount failure is expected under the chosen isolation and is **not evidence of the historical failure**. It delayed boot approximately 90 seconds.

The unmounted local directory contains two 90,373-byte demos dated 18 November 2025. A separate local `remediation_test_20260209.dem` is 142,140 bytes. These files were present on the saved disk and are not new recordings. Their presence under the mountpoint shows that local files can be hidden beneath a successful bucket mount; no recovery/upload was attempted.

The launcher claims it will save demos locally if mounting fails, but does not change the MatchZy output path or implement an upload queue. In that case recording still targets the underlying local mountpoint directory. No steam/root cron upload job was found. This can leave local recordings absent from the bucket, though it does not establish the cause of every missing or tiny demo.

## Historical log interpretation

The first captured February 28 start failed to load CounterStrikeSharp and Metamod reported zero loaded plugins. Later starts succeeded. The final captured start at 18:49 shows CounterStrikeSharp loading, MatchZy 0.8.15 loading, and SQLite initialization succeeding. Therefore the earlier plugin-load failure must not be presented as the final saved installation's permanent state.

The apparent `steamclient.so` error is followed by successful loading from `/home/steam/.steam/sdk64/steamclient.so`; it is a resolved fallback in these logs.

At roughly 18:52 the server received a website match for Inferno, applied the payload's `tv_enable` cvar and hostname, changed map, and entered warmup. Later readiness output shows one side had no ready player. Those final lines do not demonstrate a completed live match or successful recording.

The definitive demo failure cause is still unproven. A controlled recording/playback test and a test of reliable local-to-archive delivery remain necessary before claiming the server is ready for matches.

## Validation boundaries

Verified cloud RUNNING state, successful SSH/sudo, OS/disk/memory, game manifests, mod files/version records, loader configuration, active and backup plugin directories, launcher syntax, direct executable dependencies, historical startup/plugin logs, recording configuration, and this boot's mount failure.

The game process remains stopped because the metadata startup action was intentionally suppressed. No claim is made that clients can join, that these February versions work with current clients, or that demos are now fixed. Public connectivity and website integration remain for the next implementation stage.
