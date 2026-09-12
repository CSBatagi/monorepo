# Production live attendance investigation — 2026-09-08

## Loading recovery changes — deployed 2026-09-13

First navigation after inactivity is the priority. Equipment previously fetched
the account once: a temporary failure required manual reload, and a stalled
request could wait for the proxy's 60-second deadline. Attendance already retried,
but a suspended in-flight read could delay recovery when the browser resumed.

- Equipment account, catalog and attachment reads now use `useRecoveringRead`:
  15-second browser deadline, automatic retries after 1/2/4/8/16 seconds and then
  every 30 seconds during transient failures. Authorization and other permanent
  4xx errors do not run a timed retry loop. No POST is automatically replayed.
- Successful equipment reads are revalidated on visibility/pageshow/focus/online
  return; they do not create a new periodic account/reward poll. Hidden/offline
  tabs cancel pending requests and retry timers. Existing equipment remains
  visible during background refresh. Account refresh pauses during edits or
  mutations and ignores superseded responses, preserving unsaved sets.
- Attendance retries a failed first read after one second, backs off during
  outages, and resumes its normal three-second polling after success. An initial
  304 without a browser snapshot is treated as a failure. Hidden/offline requests
  are cancelled; resume replaces suspended requests whose deadline has elapsed.
- Cosmetics GET proxies and the local attendance GET proxy have a 12-second
  upstream deadline and forward browser cancellation. Production attendance GET
  continues to bypass Next.js through Caddy. Cancellation bounds the HTTP wait;
  it does not cancel PostgreSQL work that the backend has already started.

Validation: 23 controlled hook tests passed, including failed/hanging first reads,
one-day suspension, offline recovery, search races and pausing during equipment
editing. The combined Steam login and session-renewal release passed all 118
backend tests, 19 frontend auth checks, pull-to-refresh checks, the production
build and a separate TypeScript check. All pending recovery changes were included
in frontend image `csbatagi-cosmetics-frontend-nextjs:20260912t232155z`; all 433
packaged backend/frontend artifact files were verified inside the running containers.
The combined release passed 35 live API checks, including equipment/balance reads
and attendance 200/304 behavior. See [Steam rollout](../features/steam-login.md#remembered-sessions-and-combined-refresh-rollout--2026-09-13)
for images and rollback. No VM sizes, database memory limits, persistence or stats
publishing changed.

Recovery from a real day-long production idle period remains unmeasured. The
controlled failure/resume tests are not evidence that the VM's underlying
memory/disk stalls have been eliminated.

## Outcome

Inspected the signed-in production landing page, connected to `backend-1` over
SSH using the existing local key, read container/host diagnostics, and queried
24 hours of Google Cloud Monitoring metrics. Applied two reversible production
mitigations without restarting the application containers:

1. Caddy now sends **GET `/api/live/attendance`** straight to backend
   `/live/attendance`, retaining the version query string. This removes the
   Next.js process from live attendance reads. POST and all other routes still
   follow their existing handlers. The Next.js GET proxy remains available in
   local development. Public read access is unchanged: the same data was
   already available through both the Next.js proxy and `/backend/live/attendance`.
2. Changed host `vm.swappiness` from **60 to 10**, persisted in
   `/etc/sysctl.d/99-csbatagi-memory.conf`. Swap remains enabled; Docker memory
   limits, database pool size, VM type, and disk size were not increased.

These address avoidable frontend contention and application page eviction.
They are mitigations, not proof that every intermittent stall is eliminated.

## Production evidence

| Observation | Result |
|---|---|
| Machine / disk | `e2-micro`, 955 MiB usable RAM, 30 GB `pd-standard` |
| Initial host memory | 331 MiB available; 336 MiB of 1 GiB swap used |
| Initial frontend / backend swap | About 74 MiB / 109 MiB |
| Memory pressure | Observed full-stall `avg10=4.53` (percentage of wall time) during inspection |
| Kernel OOM log, preceding 7 days | No matching OOM-kill entries |
| Current app container restarts | Backend 0, frontend 0; neither marked OOM-killed |
| Attendance backend error | `2026-09-07T17:09:40Z`: connection terminated due to connection timeout |
| Other connection timeout | Admin check at `2026-09-08T00:00:54Z` |
| Latest stats generation | Started 22:06:39 UTC, published version 52 at 22:08:09 UTC: about 90 s |
| Cloud disk reads | Peak 32,373 operations in the minute ending 22:08 UTC, coinciding with generation |
| Warm version / attendance query execution | 0.149 ms / 0.201 ms; shared-buffer hits |
| Active DB workload during inspection | Two idle client connections; no blocked application queries in that snapshot |

The timeout is confirmed; its precise cause at the time of the incident is not
recorded. Swapped application memory, measured memory stalls, and expensive
stats work on the shared HDD-backed VM are credible contributors. The tiny
attendance query itself is not expensive when resident in memory.

The existing optimizations are deployed: frontend image revision
`71017c25810bf255a1cbe4545089e0283916f9da`, backend revision
`bfa2f17eea40c58a922c788d489438f6c819569f`. Production returns a numeric live
version and an empty 304 for an exact version match. Thus the previous live
polling/version changes were not merely sitting undeployed in the checkout.

## Validation and limits

Twelve sequential HTTPS `v=0` requests before and twelve after the change,
from the same workstation, with a one-second pause between requests:

| Warm API sample | Median total | Maximum | Successful |
|---|---:|---:|---:|
| Before | 317 ms | 401 ms | 12/12 |
| After | 343 ms | 380 ms | 12/12 |

These samples include connection/TLS setup and ordinary network variation.
They show healthy warm responses, **not a demonstrated latency improvement**.
They are too small and too warm to estimate incident p95/p99 or prove an
improvement after hours of inactivity or during generation.

Three signed-in Chrome reloads after the change reached the correct visible
live count in **929, 959, and 720 ms**. These are automation wall-clock timings
with warm browser assets, not Lighthouse navigation measurements.

Verified on production:

- Caddy configuration validation and graceful reload succeeded.
- Full attendance payload equals the direct backend payload (25 player entries).
- Exact version returns 304; an older version returns 200.
- `Cache-Control: no-store` is present once, including on 304 responses.
- OPTIONS still comes from Next.js and advertises the existing POST handler.
- The landing page displays the correct live count.
- No attendance records were edited or reset as part of verification.

No app-code build was needed: the deployed change is Caddy configuration and
a host sysctl setting. Lowering swappiness does not immediately pull existing
swapped pages into RAM; swap usage was still approximately 380 MiB afterward.
Do not run `swapoff` or drop OS caches on this 1 GB production VM to manufacture
a cold-load benchmark.

## Persistence and rollback

The repository `Caddyfile` contains the production route change and must be
retained in future deployments. This configuration-only release is deployed
directly with Caddy validation and graceful reload; its commit skips CI because
the existing Caddy-change workflow pulls every service. The host sysctl file
persists independently of application deployments and reboots.

Original production Caddyfile backup:
`/home/runner/Caddyfile.before-live-loading-20260908`.

Run on the VM to roll back Caddy, preserving the bind-mounted file's inode:

```sh
sudo cat /home/runner/Caddyfile.before-live-loading-20260908 | sudo tee /home/runner/Caddyfile >/dev/null
sudo docker exec caddy-reverse-proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

To restore the old swap preference, both immediately and after reboot:

```sh
printf 'vm.swappiness = 60\n' | sudo tee /etc/sysctl.d/99-csbatagi-memory.conf
sudo sysctl -p /etc/sysctl.d/99-csbatagi-memory.conf
```

## If long stalls recur

Capture the UTC timestamp, attendance response time/status, `vmstat 1 10`,
`iostat -xz 1 10`, `/proc/pressure/memory`, container memory/swap, and backend
logs together. Compare the public route with `/backend/live/attendance` and
the tiny SQL queries. Check `pg_stat_activity` for waiting connections while
the problem is happening, rather than raising pool parallelism speculatively.

If VM memory/disk stalls remain, evaluate more RAM and SSD-backed storage with
the owner before making paid infrastructure changes. A separate frontend log
warning also needs follow-up: the full stats response (~3.28 MB) exceeds the
Next.js data cache's 2 MB item limit. That was not changed in this investigation.

References: [Linux swappiness semantics](https://docs.kernel.org/admin-guide/sysctl/vm.html#swappiness),
[Google Persistent Disk performance](https://cloud.google.com/compute/docs/disks/performance),
[Caddy proxy rewrites](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#rewrites),
[deferred response headers](https://caddyserver.com/docs/caddyfile/directives/header).
