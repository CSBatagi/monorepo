# CS2 Steam Datagram Relay

The implementation uses CS2's community dedicated-server P2P listener documented by [5Stack](https://docs.5stack.gg/servers/steam-relay), within Valve's [SDR networking model](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay?l=english). Premium networking and ephemeral public addressing remain unchanged. RCON remains private. This integration is not Valve's certificate/ticket-based hosted-server API.

## Connection discovery

The game updater reads `/home/steam/csbatagi-updates/sdr-enabled`: `1` enables the listener; `0` disables it. An absent flag preserves Valve defaults. After every SteamCMD update, `sdr.py` edits only `ConVars.net_p2p_listen_dedicated` and `NetworkSystem.CreateListenSocketP2P` in `game/csgo/gameinfo_branchspecific.gi`, preserving the original app ID 730 and other Valve content. Unknown app IDs, malformed syntax or ambiguous duplicate sections stop startup.

The root startup gate verifies the enabled cvar and a game-server Steam identity from RCON `status`. After native game/plugin/inventory/demo verification, it restores the existing club password and writes a boot-bound readiness marker. The status reporter includes the verified `[G:1:account:instance]` address in its existing authenticated callback every ten seconds. Backend sanitizes the identity and expires reports after 45 seconds. The website prefers `connect [G:...]` and offers the freshly discovered direct public `IP:27015` command as a fallback. It uses direct discovery when no fresh relay address is reported. Neither private addresses nor passwords are included in links.

## Admission during startup and failure

Blocking public UDP 27015 alone cannot gate a relay connection arriving through an outbound Steam transport. `connection-gate.py close` therefore rotates a private random startup password, removes `/run/csbatagi/ready`, and locks a running instance through loopback RCON when available. Systemd invokes close before preparation and after stopping/failing. The launcher executes that private gate config before its first map.

The installed `server.cfg` also executes `csbatagi_startup_gate.cfg` last, because CS2 reloads the server config on map changes. The gate file contains the random password while closed and the existing club password after verified opening. It is mode 600, owned by steam. The club secrets file stays untouched. Gate opening requires current-boot native Ready state and a valid relay identity when SDR is enabled; an unavailable identity fails startup and keeps members locked out. Passwords and RCON responses are never printed by the gate.

## Installation on the existing VM

Stage these files together from the exact tested source revision:

```text
install-sdr.py sdr.py connection-gate.py gate.sh launch.py
rcon-local.py update-stack.py cs2.service
```

Run `sudo python3 /path/to/staged/install-sdr.py` on `cs2-server`. The installer requires the existing managed updater, refuses players/loaded matches/recording/unverified uploads, running SteamCMD, service transitions and active demo analysis. It saves a numbered backup manifest under `/home/steam/csbatagi-backups/sdr-<UTC>/`, closes connections, stops only CS2, installs these integration files, appends the gate hook to the installed server config, enables the flag and starts native verification. It preserves installed custom patches/DLLs, private credentials, demos and worker state. Do not use the full updater installer for this narrow deployment: unrelated local plugin changes must not replace the installed patches.

Inspect sanitized status and listener identity after startup:

```sh
sudo systemctl is-active cs2 csbatagi-update-status
sudo cat /home/steam/csbatagi-updates/status.json
sudo python3 /usr/local/lib/csbatagi/rcon-local.py net_p2p_listen_dedicated
sudo python3 /usr/local/lib/csbatagi/rcon-local.py status
```

Require Ready, a listener value of true/1, current `[G:...]` identity, matching member API connection address and a boot-bound readiness marker. Test the Steam launch link and console command with real remote clients using the existing password. Check relay versus direct latency from normal player locations. Check rejection during preparation and wrong-password rejection over both paths. A local config/RCON check cannot establish real-client SDR connectivity or latency.

Disable SDR only on an empty server: write `0` to `sdr-enabled`, then restart through the managed service. The updater writes both listener settings to zero; the website falls back to the current public IP. For full rollback, restore the manifest's backed-up files (remove newly introduced files only when marked originally absent), reload systemd and restart through verification. Keep the admission gate and source versions consistent; never restore only the launcher/service while leaving incompatible gate files.

## 9 October deployment record

Dynamic-IP discovery is live in production; see the [dynamic address runbook](cs2-dynamic-addresses.md). SDR integration source, frontend/backend support and the selective installer are implemented. Local validation passed 73 focused backend tests, 12 SDR/gate tests, seven existing updater tests, TypeScript checking and a Next production build.

Source was pushed in `239f34d`. The SDR-aware website/backend were deployed at 11:50 UTC, layering onto the previously verified production images. Active images are `csbatagi-connections-backend:20261009t115026z` and `csbatagi-connections-frontend-nextjs:20261009t115026z`, with rollback backup `/home/runner/cs2-connections-web-backup-20261009t115026z`. The existing equipment editor fix and 256 MiB limits are preserved. The actual join component passed relay launch/copy, current direct fallback and readiness render checks. The selective game-VM bundle is staged locally at `%TEMP%/csbatagi-sdr-release-239f34d` and can be reproduced from that commit.

Game-VM installation and live SDR validation are blocked: four attempts to start the existing `n2d-standard-2` VM returned `ZONE_RESOURCE_POOL_EXHAUSTED` for `europe-west3-c`. The VM remains stopped with its original machine type and Premium access config. A temporary `n2-standard-2` alternative has been offered to the owner because its hourly price may differ; it has not been applied. No successful relay listener or real-client connection is claimed until the VM can start and the integration can be installed and verified.
