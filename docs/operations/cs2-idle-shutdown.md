# CS2 idle shutdown

The game VM (`cs2-server`) powers itself off when nothing has needed it for **15 minutes in a row**. It exists because a VM someone forgot to close keeps billing all night. A timer on the VM itself does the check, so it also covers a VM started from the Google Cloud console or by a workflow, and a VM whose website session ended.

- Script: [`ops/cs2/idle-shutdown.py`](../../ops/cs2/idle-shutdown.py), installed as `/usr/local/lib/csbatagi/idle-shutdown.py`.
- Units: [`csbatagi-idle-shutdown.timer`](../../ops/cs2/csbatagi-idle-shutdown.timer) runs [`csbatagi-idle-shutdown.service`](../../ops/cs2/csbatagi-idle-shutdown.service) (oneshot, root) one minute after boot and then every minute.
- Installer: [`ops/cs2/install-idle-shutdown.py`](../../ops/cs2/install-idle-shutdown.py). Tests: `python ops/cs2/test-idle-shutdown.py` (42 tests, no VM needed).

## What counts as activity

Any of these resets the idle clock to zero:

| Signal | How it is read |
|---|---|
| Human players (bots and CSTV do not count) | `humans` from the plugin's `csbatagi_status` over local RCON (`rcon-local.py`), as the backend reads it; the plugin's `csbatagi-state/status.json` when RCON fails and the file is under 2 minutes old |
| A newly loaded website match | `matchLoaded` with a match ID the previous check had not seen, so loading a match restarts the 15 minutes for players to join |
| CS2 starting or stopping: SteamCMD/plugin updates, startup verification, crash restarts | `cs2.service` `ActiveState` `activating`/`deactivating`; `update-stack.py prepare/verify/rollback`, `steamcmd` and `dotnet` processes; an in-progress stage (`checking`, `updating_game`, `updating_plugins`, `verifying`) of this boot in `/home/steam/csbatagi-updates/status.json` |
| Demo analysis | The CS Demo Manager CLI process (`cli.js analyze`, the same check as `analyzer-maintenance.sh` and `install-sdr.py`); a growing `.part` download in `csbatagi-state/analysis-downloads/`; a `gcloud storage cp` transfer |
| Package management | `apt`, `apt-get`, `dpkg`, `unattended-upgrade` processes; `apt-daily(-upgrade).service` running |
| Maintenance scripts | `install-*.py`/`install-*.sh` and `analyzer-maintenance.sh` processes |
| An admin's SSH terminal | An sshd session with a terminal (`sshd: user@pts/N`) whose keyboard input is under 60 minutes old (the terminal's access time, as `w` shows). Sessions without a terminal, such as the website's database tunnel or scripted `gcloud compute ssh --command`, do not count |

These **hold** the VM (the idle clock does not run) but only for up to **2 hours** in a row without any activity above, so a broken reader cannot keep it on forever:

- CS2 runs but neither RCON nor a fresh status file answers.
- A match is live, preparing, started or recording, or a demo failed, with nobody connected (players connected are activity, above).
- Demo uploads: `uploads.pending` is not 0, or the running uploader's `csbatagi-state/uploads.json` is over 2 minutes old (it is not rewritten while an upload is in flight). These are the website's "Server Kapat" guards.

Not activity: a stopped or failed `cs2.service` (for example after a failed update; nobody can play on it), a warmup server with only bots, a match loaded long ago with nobody on it, pending uploads while `csbatagi-demos` is stopped (the files stay on disk and upload on the next boot).

The idle state lives in `/run/csbatagi-idle/state.json`: `/run` is cleared on every boot and the file also records the boot ID, so a fresh boot always starts from zero. Idle time only adds up across checks at most 5 minutes apart; if the timer was stopped for longer, counting starts again.

## Powering off

After 15 idle minutes the service logs `POWERING OFF the game VM: ...` and runs `systemctl poweroff`. Checks run about every 65 seconds (one minute after the previous check started, plus timer accuracy), so the poweroff comes 15–16 minutes after the first idle check. logind then waits up to 30 seconds for the unattended-upgrades shutdown helper's delay lock before the units stop. A guest poweroff leaves the Compute Engine instance `TERMINATED` (no vCPU/RAM billing), the same state the website's "Server Kapat" (`instances.stop`) produces; the website's start button and "Analiz et" start it as usual. Cloud audit logs record it as `compute.instances.guestTerminate` rather than `stop`.

The shutdown runs the normal unit stop path, which is also what `instances.stop` triggers: `cs2.service` stops with RCON `quit` (45 s limit), then closes the connection gate and runs `update-stack.py rollback`, which only acts on an interrupted plugin install. The journal then shows `cs2.service: Control process exited ... status=1/FAILURE` and `Failed with result ...` for cs2. That happened on earlier website shutdowns too: `rcon-local.py quit` exits 1 when the server drops the connection, and CS2 either exits with SIGSEGV on `quit` or is killed at the 45 s limit. It does not affect the next boot. The demo uploader can be cut mid-upload; its queue is local-first and create-only, so the next boot uploads or verifies the file again, and it never deletes local demos.

## Relationship with the website's analysis idle close

The backend has its own, narrower idle close ([`backend/analysisServer.js`](../../backend/analysisServer.js), `DEMO_ANALYSIS_AUTOSTART`, `DEMO_ANALYSIS_IDLE_MINUTES: "15"`): when "Analiz et" started the VM, it stops it after 15 idle minutes, and it never closes a VM opened with "Server Aç". Both use the same notion of busy: analysis running, players, a match being prepared/played/recorded, uploads in flight, and "unverified" when the server cannot be read. They coexist: whichever reaches 15 minutes first closes the VM, and when the VM powers itself off the backend's next check sees it stopped and ends the analysis session (`stopped_elsewhere`). No backend change was needed.

One thing only the backend knows is a demo that is queued but not yet picked up. The worker picks jobs up within a minute, so this matters only if "Analiz et" is pressed in the last minute of an idle countdown on a running VM: the VM may then close with the job queued, and pressing "Sunucuyu aç" on the Demolar page runs it.

## Operations

```sh
journalctl -u csbatagi-idle-shutdown --since today      # one line per minute
journalctl -u csbatagi-idle-shutdown -b -1 -n 20         # how the previous boot ended
sudo python3 /usr/local/lib/csbatagi/idle-shutdown.py --check   # what the next check sees; changes nothing
systemctl list-timers csbatagi-idle-shutdown.timer
```

Typical lines: `active: 4 players on the server (idle clock reset); match live; ...`, `held 3/120 min, not counted as idle: 1 demo upload(s) pending`, `idle 7/15 min; cs2 active, 0 players, 0 bots`, `POWERING OFF the game VM: idle 15/15 min: ...`.

**Long maintenance with no terminal input:** keep typing in the SSH terminal, or switch the shutdown off.

**Switch off** (persists across reboots): `sudo touch /etc/csbatagi/idle-shutdown.disabled`. Every check then logs `disabled by ...` and clears the idle clock. Delete the file to switch it on again; counting starts from zero. Alternatively `sudo systemctl disable --now csbatagi-idle-shutdown.timer` (`enable --now` to restore). `sudo systemctl stop csbatagi-idle-shutdown.timer` pauses it until the next boot.

**Settings:** `/etc/csbatagi/idle-shutdown.env` (the installer writes it once with every line commented out and never overwrites it). The next check uses a new value.

| Variable | Default | Meaning |
|---|---|---|
| `IDLE_SHUTDOWN_MINUTES` | 15 | Idle minutes before poweroff |
| `IDLE_SHUTDOWN_HOLD_CAP_MINUTES` | 120 | Longest hold by an unreadable status, pending uploads or a match without players |
| `IDLE_SHUTDOWN_SSH_IDLE_MINUTES` | 60 | An SSH terminal without keyboard input stops counting after this |
| `IDLE_SHUTDOWN_DRY_RUN` | 0 | `1` logs "not powering off" instead of powering off |

Values outside 1–1440 minutes are ignored with a `config:` line in the journal.

## Installation and rollback

Export the files from the commit without Windows line endings (see the [SDR runbook](cs2-sdr.md) for the CRLF gotcha), copy them through IAP and run the installer as root. Installing touches neither CS2 nor the demo services, so it is safe on a busy server; it is idempotent and backs up any file it replaces under `/home/steam/csbatagi-backups/idle-shutdown-<UTC>/`.

```sh
git -c core.autocrlf=false archive -o idle-shutdown.tar <commit> ops/cs2/idle-shutdown.py ops/cs2/install-idle-shutdown.py \
  ops/cs2/csbatagi-idle-shutdown.service ops/cs2/csbatagi-idle-shutdown.timer ops/cs2/test-idle-shutdown.py
gcloud compute scp idle-shutdown.tar cs2-server:/tmp/ --zone europe-west3-c --tunnel-through-iap
gcloud compute ssh cs2-server --zone europe-west3-c --tunnel-through-iap --command \
  "rm -rf /tmp/idle-stage && mkdir /tmp/idle-stage && tar -xf /tmp/idle-shutdown.tar -C /tmp/idle-stage && \
   cd /tmp/idle-stage/ops/cs2 && python3 test-idle-shutdown.py && sudo python3 install-idle-shutdown.py"
```

The installer refuses files with `\r` bytes and machines without `/usr/local/lib/csbatagi/rcon-local.py`. It prints the first `--check` result. Rollback: `sudo python3 install-idle-shutdown.py --remove` (disables the timer and deletes the script and units; keeps the settings file and backups), or switch it off as above.

## Deployment record (24 October 2026)

The VM had run all night on 23–24 October (started 19:29 UTC, stopped 06:40 UTC). It was `TERMINATED` at 09:32 UTC and was started with `gcloud compute instances start`; the website's start route sends no member notifications either. All times below are UTC.

- **Install** at 09:34:00 from the staged tree of this change, exported with `core.autocrlf=false` (no `\r` bytes). The unit tests also passed on the VM (Ubuntu 22.04.5, Python 3.10.12, systemd 249). Backup: `/home/steam/csbatagi-backups/idle-shutdown-20261024T093400Z`. At 09:42:15 the script was updated so the log names the status source (backup `idle-shutdown-20261024T094215Z`); the idle clock kept running.
- **Startup is activity.** 09:34:01 `active: cs2 starting (start-post: updates/verification); game update stage verifying; maintenance script running (install-idle-shutdown.py); update-stack verify`. CS2 reached Ready with nobody on it: 09:35:03 `idle 0/15 min; cs2 active, 0 players, 0 bots`.
- **An SSH terminal is activity.** A `gcloud compute ssh --ssh-flag=-t` session on `pts/0` (09:35:33–09:38:09) gave `active: ssh session onur_@pts/0` at 09:36:08 and 09:37:13, and the clock restarted at 09:38:18 (`idle 0/15 min`). The scripted `--command` sessions used throughout (`onur_@notty`) and the website's database tunnel (`csbatagi@notty`) did not count.
- **Poweroff.** `idle 14/15 min` at 09:53:13, then at 09:54:18 `POWERING OFF the game VM: idle 15/15 min: no players or activity for 15 minutes; cs2 active, 0 players, 0 bots (rcon)`. logind powered down at 09:54:48 after the unattended-upgrades delay lock; cs2, the uploader, the analyzer and the status reporter had stopped by 09:54:50, and the journal closed at 09:54:54. Compute Engine logged `compute.instances.guestTerminate` (`system@google.com`) at 09:54:56.9; the instance was `STOPPING` at 09:55:06 and `TERMINATED` at 09:55:28. No `instances.stop` call was made.
- **Second cycle.** Started again with `gcloud compute instances start` at 09:56:00. The new boot had no `/run/csbatagi-idle`; its first check at 09:57:06, 62 s after boot, read `idle 0/15 min` with a fresh state. CS2 was Ready within that first minute because no update was needed. The countdown reached `idle 10/15 min` at 10:07:39, Compute Engine logged a second `guestTerminate` at 10:13:43.6, and the instance was left `TERMINATED` (last stop 10:13:53).

Not verified on the real VM: holds from a live match, a demo upload or an analysis, players joining late in a countdown, the 2-hour hold cap, and apt activity. The unit tests cover these.
