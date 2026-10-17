# CS2 Steam Datagram Relay

The implementation uses CS2's community dedicated-server P2P listener documented by [5Stack](https://docs.5stack.gg/servers/steam-relay), within Valve's [SDR networking model](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay?l=english). Premium networking and ephemeral public addressing remain unchanged. RCON remains private. This integration is not Valve's certificate/ticket-based hosted-server API: that mode needs tickets signed by the game's own coordinator, which only Valve's official CS2 servers receive. Relay joins also require an anonymous game-server login; see [token-free relay login](#token-free-relay-login).

## Connection discovery

The game updater reads `/home/steam/csbatagi-updates/sdr-enabled`: `1` enables relay mode (listener on, anonymous Steam login); `0` disables the listener and logs in with the game-server token. An absent flag preserves Valve defaults and also uses the token. After every SteamCMD update, `sdr.py` edits only `ConVars.net_p2p_listen_dedicated` and `NetworkSystem.CreateListenSocketP2P` in `game/csgo/gameinfo_branchspecific.gi`, preserving the original app ID 730 and other Valve content. Unknown app IDs, malformed syntax or ambiguous duplicate sections stop startup.

The root startup gate verifies the enabled cvar and a game-server Steam identity from RCON `status`. After native game/plugin/inventory/demo verification, it restores the existing club password and writes a boot-bound readiness marker. The status reporter includes the verified `[A:1:account:instance]` address in its existing authenticated callback every ten seconds. Backend sanitizes the identity, accepts only that anonymous form and expires reports after 45 seconds. The website prefers `connect [A:...]` and offers the freshly discovered direct public `IP:27015` command as a fallback. It uses direct discovery when no fresh relay address is reported. Neither private addresses nor passwords are included in links.

## Token-free relay login

A relay connection is addressed to the server's exact Steam ID. With the game-server login token, CS2 gets `[G:1:12891149]` (SteamID64 `85568392932930573`, instance 0). CS2 clients turn any `[G:1:12891149…]` text into instance 1 (`85568397227897869`), including `[G:1:12891149:0]`, so the relay connect goes to an identity nobody listens on and times out after 20 seconds. `=[…]` selects Valve's ticket-based hosted mode and fails with "We don't have an authorization ticket!". `steamid:…` is parsed as a hostname. Without the token, the server logs in anonymously as `[A:1:account:instance]`, which clients dial correctly. The account part changes on every boot; the reporter reads it fresh.

`launch.py` therefore executes `csbatagi_steam_token.cfg` only when `sdr-enabled` is not `1`. `install-sdr.py` moves the single `sv_setsteamaccount` line out of `csbatagi_secrets.cfg` into that file (same owner and mode, written before the secrets file is rewritten, idempotent, values never printed). The secrets file keeps the club and RCON passwords, which `server.cfg`, the gate and `rcon-local.py` still read. If relay mode ever finds a `[G:…]` identity, validation fails with `sdr_token_login_unreachable` and the gate stays closed.

CS2 prints "Connections will be restricted to LAN only" without a token, but build 1.41.9.1 did not enforce it: direct UDP joins still worked. The password gate, RCON, plugins and the demo pipeline do not use the token. No installed plugin reads player IP addresses, so relay joins (which reach the server as `[U:1:…]` instead of an IP) lose nothing. Not having a token also removes the risk of Valve banning it over the skins plugin.

## Admission during startup and failure

Blocking public UDP 27015 alone cannot gate a relay connection arriving through an outbound Steam transport. `connection-gate.py close` therefore rotates a private random startup password, removes `/run/csbatagi/ready`, and locks a running instance through local RCON when available. The helper prefers loopback, then discovers the VM's private interface if CS2 refuses loopback. Systemd invokes close before preparation and after stopping/failing. The launcher executes that private gate config before its first map.

The installed `server.cfg` also executes `csbatagi_startup_gate.cfg` last, because CS2 reloads the server config on map changes. The gate file contains the random password while closed and the existing club password after verified opening. It is mode 600, owned by steam. The gate never writes the club secrets file. Gate opening requires current-boot native Ready state and a valid relay identity when SDR is enabled; an unavailable identity fails startup and keeps members locked out. Passwords and RCON responses are never printed by the gate. The non-secret readiness marker and its root-owned parent are explicitly mode 644 and 755, respectively, so the steam status reporter can read them despite systemd's 0027 umask.

## Installation on the existing VM

Stage these files together from the exact tested source revision:

```text
install-sdr.py sdr.py connection-gate.py gate.sh launch.py
rcon-local.py update-stack.py cs2.service
```

Stage them with Unix line endings (for example from `git archive`): systemd runs `launch.py` directly, and a Windows checkout's CRLF breaks its shebang. Run `sudo python3 /path/to/staged/install-sdr.py` on `cs2-server`. The installer requires the existing managed updater, refuses players/loaded matches/recording/unverified uploads, running SteamCMD, service transitions and active demo analysis. It saves a numbered backup manifest under `/home/steam/csbatagi-backups/sdr-<UTC>/`, closes connections, stops only CS2, installs these integration files, appends the gate hook to the installed server config, moves the token into `csbatagi_steam_token.cfg`, enables the flag and starts native verification. It preserves installed custom patches/DLLs, private credentials, demos and worker state. Do not use the full updater installer for this narrow deployment: unrelated local plugin changes must not replace the installed patches.

Inspect sanitized status and listener identity after startup:

```sh
sudo systemctl is-active cs2 csbatagi-update-status
sudo cat /home/steam/csbatagi-updates/status.json
sudo python3 /usr/local/lib/csbatagi/rcon-local.py net_p2p_listen_dedicated
sudo python3 /usr/local/lib/csbatagi/rcon-local.py status
```

Require Ready, a listener value of true/1, a current `[A:1:account:instance]` identity, matching member API connection address and a boot-bound readiness marker. Test the Steam launch link and console command with real remote clients using the existing password. Check relay versus direct latency from normal player locations. Check rejection during preparation and wrong-password rejection over both paths. A local config/RCON check cannot establish real-client SDR connectivity or latency.

Disable SDR only on an empty server: write `0` to `sdr-enabled`, then restart through the managed service. The updater writes both listener settings to zero, the launcher logs in with the token again and the website falls back to the current public IP. For full rollback, restore the manifest's backed-up files (remove newly introduced files only when marked originally absent), reload systemd and restart through verification. Keep the admission gate and source versions consistent; never restore only the launcher/service while leaving incompatible gate files.

## 9 October deployment record

Dynamic-IP discovery is live in production; see the [dynamic address runbook](cs2-dynamic-addresses.md). SDR integration source, frontend/backend support and the selective installer are implemented. Local validation passed 73 focused backend tests, 12 SDR/gate tests, seven existing updater tests, TypeScript checking and a Next production build.

Source was pushed in `239f34d`. The SDR-aware website/backend were deployed at 11:50 UTC, layering onto the previously verified production images. Active images are `csbatagi-connections-backend:20261009t115026z` and `csbatagi-connections-frontend-nextjs:20261009t115026z`, with rollback backup `/home/runner/cs2-connections-web-backup-20261009t115026z`. The existing equipment editor fix and 256 MiB limits are preserved. The actual join component passed relay launch/copy, current direct fallback and readiness render checks. The selective game-VM bundle is staged locally at `%TEMP%/csbatagi-sdr-release-239f34d` and can be reproduced from that commit.

Both registry builds succeeded ([backend](https://github.com/CSBatagi/monorepo/actions/runs/37926098124), [frontend](https://github.com/CSBatagi/monorepo/actions/runs/37926101179)). Registry images were not substituted for the layered frontend because the live equipment fix is still uncommitted. The first API checks ran before backend startup finished and failed; a repeat at 11:56 UTC passed both authenticated status paths (HTTP 503, no address, `no-store` for the stopped game VM), both member pages (HTTP 200 and all 18/17 assets), and stats diagnostics (HTTP 200 with expected dataset counts and no errors). Both containers were running, with zero restarts, no OOM flag and 268435456-byte memory limits.

On 9 October, game-VM installation was blocked: five attempts to start the existing `n2d-standard-2` VM returned `ZONE_RESOURCE_POOL_EXHAUSTED` for `europe-west3-c`, including a final retry after production verification passed. No alternate machine type was applied. The owner started the VM on 10 October, allowing the installation below.

## 10 October deployment record

The selective game-VM integration was installed on the empty running server at 09:50 UTC using source `239f34d`, with the two fixes described below applied from the workspace. Rollback backup: `/home/steam/csbatagi-backups/sdr-20261010T095020Z`. Native verification reached Ready at 09:57:47 UTC with no error or warning. CS2 and the status reporter remain running. Current game: 1.41.9.0, build 25815307; CounterStrikeSharp 1.0.376, MatchZy 1.4.35, Inventory Simulator 3.5.2, Metamod 1474.

Live installation exposed two environment-dependent failures, now fixed in source and on the VM:

- CS2 binds TCP RCON to the VM's private interface rather than loopback. `rcon-local.py` now discovers that local RFC1918 address after a loopback refusal without hardcoding an IP. It never uses a public fallback. The initial verification failure's rejection record was preserved in the rollback backup as `rejected-after-rcon-failure.json`; a normal rebuild and native verification then certified the corrected installation.
- The root gate inherited systemd's umask and created `/run/csbatagi` as 750, preventing the steam reporter from reading the marker. Gate opening now explicitly sets the directory to 755; reporting was verified as steam, and the test exercises a restrictive existing directory and 0027 umask on Linux.

RCON confirmed `net_p2p_listen_dedicated=true` and Steam identity `[G:1:12891149]`. The Valve game-info settings are app ID 730, listener 1 and `CreateListenSocketP2P=2`. The startup marker matches the current boot, the private gate config is mode 600, and both the live password and gate config match the unchanged club secret. The startup UDP drop was present during preparation and absent after Ready. During preparation, both authenticated status APIs returned `serverReady=false` and no connection address.

At 10:03 UTC, both authenticated backend `/game-status` and website `/api/game-status` checks passed with HTTP 200, `no-store`, Ready, transport `sdr` and address `[G:1:12891149]`. Their direct fallback matched cloud discovery (`34.179.194.166:27015` at this boot). Both member pages and all 18/17 referenced assets loaded; stats diagnostics had no errors. All 82 protected file hashes matched the baseline, including credentials, custom integration sources/DLLs and the five existing production demos. Integration remains `be479397d49999d955123aadad1d2e8b72a49b01c950dae7bbafa9a148a7d772`; no recording or pending upload remains.

Validation passed 60 focused backend tests, 12 SDR/gate tests, seven updater tests and four new local RCON address tests. The SDR/gate and RCON suites also passed on the Linux game VM. Real remote-client joining, wrong-password rejection and relay-versus-direct packet-loss/latency measurements remain player acceptance checks; server readiness and API checks alone do not establish those results.

## 17 October investigation and token-free test

A player reported freezes on the 16 October game night. All 684 player connections in the console log since September were direct UDP; no relay or P2P connection had ever reached the server, although the listener was on. The website's main join button sent `connect [G:1:12891149]`, which real clients dial as instance 1 (see [token-free relay login](#token-free-relay-login)), so it had never worked; members joined through the direct fallback or saved commands. The freezes were the player's own path: 12 of the night's 13 "can't find client frame" resyncs (client more than 128 ticks behind) were theirs, none lined up with a server long frame, and they appeared only after the player's address moved from a residential IP to Cloudflare (`104.28.x.x`, WARP). Advice: turn WARP off or exclude CS2 from it.

A throwaway second CS2 process ran on the VM as transient unit `cs2-relaytest` on port 27016. It used private bind mounts of copied `addons/` (Inventory Simulator only, no MatchZy) and `cfg/` (no token, no gate), so production files and state were never visible to it. It logged in anonymously as `[A:1:…:51945]` (the account part changed between its two boots), with VAC secure mode and a game coordinator connection. With a real client from the UK:

| Check | Result |
| --- | --- |
| Relay join | Connected through Valve's Frankfurt relay (`dfra`), 19 ms, 0 loss; the server saw `P2P SDR steamid:… connected` and `[U:1:…]` instead of the IP |
| Direct join, UDP 27016 | Connected (18 ms) despite the "LAN only" banner; `sv_lan` stayed false |
| Wrong password over the relay | Rejected (`password failed`, `NETWORK_DISCONNECT_REJECT_BADPASSWORD`) |
| Right password over the relay | Joined (`password "relaytest4821"`; an earlier hyphenated test password failed on the client side) |
| Uncached Workshop map | Jura (`3261289969`, 2.3 GB) downloaded and loaded in about 85 seconds |
| CSTV | 38-second demo, 832,341 bytes, steady growth, `PBDEMS2` header |
| Club skins | Applied |

Not covered: players' own Steam-owned skins, microphone audio in the demo, MatchZy and the integration (not loaded; no code path uses the token), and relay latency for players in Turkey. The test unit, its files and the temporary firewall rule (UDP 27016 from the tester only) were removed afterwards. Jura stayed in the shared Workshop cache because it is a catalog map.

Source changes (prepared, not yet deployed): `sdr.py` reports only `[A:1:account:instance]` and rejects token identities; `launch.py` uses the token only outside relay mode; `install-sdr.py` moves the token into `csbatagi_steam_token.cfg`; `backend/gameUpdateStatus.js` accepts only the anonymous form. Validation: 14 SDR/gate tests on Windows and on the game VM, 11 updater/RCON tests, and 51 backend tests (`gameUpdateStatus`, `gameServer`, `rcon`).
