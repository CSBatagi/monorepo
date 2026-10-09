# CS2 dynamic connection addresses

The game VM uses an ephemeral external IPv4 address with the **Premium** network tier. A stop/start can change its public IP; while stopped it normally has no public IP. Do not reserve an address or switch tiers to make the website connection work. See Google's [IP address lifecycle](https://docs.cloud.google.com/compute/docs/ip-addresses).

## Runtime discovery

- `backend/gcp.js` reads the configured `cs2-server` VM in `europe-west3-c` using the existing Compute Engine client and credentials. The service account needs `compute.instances.get`, already used for VM status.
- The first network interface supplies its private `networkIP` for RCON and the external `ONE_TO_ONE_NAT` access config's `natIP` for player connections. Only a RUNNING VM advertises addresses.
- Concurrent lookups share one request. Successful results are cached for ten seconds, with a four-second lookup timeout and no retries. Start/stop actions invalidate discovery before and after the operation. An expired address is never reused after a lookup failure.
- The member-authenticated `/game-status` route returns `connection.address` (`IP:27015`, or a freshly reported Steam relay address when enabled) to the browser, with `Cache-Control: no-store`. Private IPs and RCON credentials stay in the backend. Startup verification must still pass before joining.
- The team picker passes its existing status poll to the join component; equipment polls the same API independently. Polling refreshes every fifteen seconds, every five seconds during a power transition, and on visibility/pageshow/online resume. Older overlapping responses cannot replace the newest address.
- Steam launch links and copyable console commands use that discovered address. Missing addresses, failed status requests and startup preparation disable joining; there is no fallback to a former public IP or DNS record.

RCON discovers the private address for each command through the shared cache. Production Compose must not set `CS2_RCON_HOST` to a fixed IP. This variable remains an explicit local/private-network override. On the game VM itself, `rcon-local.py` uses loopback.

The owner reports an existing `ddclient` service on the game VM that updates Cloudflare for its dynamic address. Preserve it: it provides the stable game hostname separately from this website discovery flow. The VM was stopped during this task, so its installed ddclient configuration and successful update after a new boot have not been inspected. Public DNS for `cs2.csbatagi.com` still returned the former IP with a 300-second TTL on 9 October; that does not establish whether ddclient is misconfigured, since it cannot update while the VM is stopped. Confirm its target hostname and DNS-only Cloudflare record during the next normal opening.

The existing backend DDNS service updates only `csbatagi.com` and `db2.csbatagi.com`, which belong to the website VM. Do not add the game hostname to that updater: it would point players to the wrong VM. Website links use the VM's directly discovered current address, so joining does not wait for ddclient or DNS-cache propagation. Members can also use `connect cs2.csbatagi.com:27015` once the game VM's ddclient update has propagated.

## Steam Datagram Relay assessment

SDR is separate from Premium networking and dynamic DNS. Valve's [SDR documentation](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay?l=english) describes relayed P2P connections, including a dedicated server acting as a peer. It cautions that relay routing can worsen latency for some players. Its ticket-based hosted-server integration has separate certificate and game-coordinator requirements.

The [5Stack CS2 integration](https://docs.5stack.gg/servers/steam-relay) documents a community dedicated-server P2P path: preserve `game/csgo/gameinfo_branchspecific.gi`, set `net_p2p_listen_dedicated` to `1` in its existing ConVars block, and add a NetworkSystem block with `CreateListenSocketP2P` set to `2`. The provider warns that CS2 updates can overwrite these edits. This establishes a candidate integration, not successful SDR operation on our VM or guaranteed Valve support for this configuration.

The subsequent SDR implementation adds updater-managed persistence, fresh Steam identity reporting, relay join links and a password admission gate covering relay and direct connections. See [SDR installation and validation](cs2-sdr.md) for the installation procedure and the current cloud-capacity blocker. Game-VM enablement and real-client relay/latency acceptance remain pending.

## Rollout and validation

Deploy backend and frontend together, and remove `CS2_RCON_HOST` from the production Compose environment and any backend secret env file. Keep Docker memory limits and VM networking unchanged. Build Next.js on a workstation or CI, never on the 1 GiB backend VM. Copy the updated local RCON helper during the next game-VM maintenance window.

Read the actual VM network state without starting it:

```sh
gcloud compute instances describe cs2-server --zone=europe-west3-c \
  --format='json(status,networkInterfaces)'
```

On the next normal opening, confirm the website's link and `connect` command match `networkInterfaces[0].accessConfigs[].natIP`, and test with a real CS2 client after startup reports Ready. A cold stop/start should pick up the new address automatically; do not interrupt players or recordings just to test address rotation.

On 9 October 2026, a read-only cloud check found the game VM TERMINATED, no assigned external address, and its access config set to PREMIUM. The old `cs2-server-ip` address reservation remained separately in RESERVED state. This implementation does not release that reservation; review unused reservations separately if the goal is to eliminate their billing. Source tests simulate address rotation, missing NAT, stopped VMs, discovery outages and cache invalidation without starting the game VM.

Dynamic discovery was pushed in commit `c2f7378` and deployed to production on 9 October at 11:30 UTC. `deploy-connections-web.py` layered the changed backend files and workstation-built Next output onto the installed images, preserving the previously deployed equipment editor fix and both 256 MiB container limits. Images: `csbatagi-connections-backend:20261009t113020z` and `csbatagi-connections-frontend-nextjs:20261009t113020z`. Backup: `/home/runner/cs2-connections-web-backup-20261009t113020z`; active override: `/home/runner/docker-compose.cs2-connections.yml`.

Initial validation: 71 focused backend tests, standalone TypeScript checking, Next production build and actual join-component rendering passed. The deployed backend successfully queried the stopped VM and returned null addresses. Both authenticated backend and website status APIs returned HTTP 503 with `no-store` and no connection address. The member team-picker/equipment pages returned HTTP 200, with all 18/17 referenced static assets loading. `/stats/diagnostics` returned HTTP 200 and no errors. No reservation was released or network tier changed. Game starts were rejected by Google Cloud due to unavailable `n2d-standard-2` capacity in `europe-west3-c`.

Rollback restores the backed-up Compose and secret env file, then starts only backend/frontend with the backup's `rollback.yml`. Never print the secret env file. A normal registry deployment does not use the manual override and can replace these layered images; coordinate it with any previously deployed fixes that are still uncommitted locally.

Google's [external-IP pricing](https://cloud.google.com/vpc/network-pricing#ipaddress) charges for unused static reservations as well as in-use external IPv4 addresses. Switching the VM to ephemeral addressing does not by itself delete its former reservation.
