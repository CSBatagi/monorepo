# Demo videos to YouTube: execution plan

Status 26 September 2026: phase 0 is done. Scripted recordings on the workstation match the manual CSDM workflow (start, camera switches, ending, X-ray off), and the tool updater has installed an HLAE update and proved it with a smoke test. Hearing the voice track in the sample videos is still to be confirmed by a person. Nothing in the cloud has been created yet.

## Goal

1. A demo is analyzed from the Demolar page (existing flow, [demo-analysis-and-downloads.md](demo-analysis-and-downloads.md)).
2. An admin presses **Video yarat**. A Windows GPU server starts in the background.
3. The server records the whole match with CS Demo Manager (CSDM) exactly as it is done by hand today, then shuts down.
4. Several demos can render at the same time, one server each.
5. The finished video is uploaded to the club's YouTube channel and added to the playlist that the Maç Videoları page embeds (`PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT`), so it appears there with no website change.

## The recording, as a script

The manual steps in CSDM's Video tab map to CLI options that already exist in CSDM 3.20.1. The desktop app and the CLI share the same code, so the output is the same.

| Manual step today | Scripted equivalent |
|---|---|
| Create sequence; start tick left at its default | Round 1's freeze-time end, the app's default (`add-sequence-dialog.tsx`) |
| End tick: last kill, +1 second (xplay stops recording right after the match) | `max(last kill, last round end) + 1 s`, capped so the game's `quit` 64 ticks later is still inside the demo. Same as the manual rule when the match ends on a kill; it also keeps the explosion when the last round ends on the bomb |
| Voices on, X-ray off | `playerVoicesEnabled: true`, every player `isVoiceEnabled`, `showXRay: false` |
| Generate cameras: killer, 2 seconds before each kill | Same rule as `generate-cameras-dialog.tsx`: one `playerCameras` entry per kill at `tick - 2 × tickrate`, world kills skipped |

Files:

- [`ops/video/build-video-config.js`](../../ops/video/build-video-config.js) turns a `csdm json` match export into a `csdm video --config-file` JSON. It has no dependencies and runs on CSDM's bundled runtime (`ELECTRON_RUN_AS_NODE=1 cs-demo-manager.exe ...`), so a worker needs no Node install. Tests: `node --test ops/video/build-video-config.test.js`.
- [`ops/video/record-demo.ps1`](../../ops/video/record-demo.ps1) runs `csdm json` (it analyzes into the local CSDM database if needed) → builder → `csdm video --config-file`, and treats the run as successful only if a new `.mp4` exists. It accepts the folder that unpacking a `.dem.gz` often creates. `-DryRun` stops after writing the config; `-Rounds 2`, `-Rounds 20-24` or `-Rounds 16-` record part of a match; `-MaxSeconds` caps the length.
- Guard rails in `record-demo.ps1`: the demo is hard-linked into a short folder (`%LOCALAPPDATA%\csbatagi-render`) because CS2 cannot open paths over 260 characters and then silently plays the demo without CSDM's actions (seen with a 279-character xplay path: the demo just kept playing). If HLAE has not started writing within 8 minutes, or the run takes more than three times the footage length plus 15 minutes, CS2 is closed and the run fails instead of hanging.
- The builder replaces `"` with `'` in player names: CSDM writes each name into `mirv_replace_name ... "<name>"`, and CS2 cannot escape quotes there (the club has a player called `here comes the "D"`).

```powershell
.\ops\video\record-demo.ps1 -DemoPath C:\demos\match.dem -OutputFolder C:\videos             # club desktop settings (x264)
.\ops\video\record-demo.ps1 -DemoPath C:\demos\match.dem -OutputFolder C:\videos -Encoder nvenc
```

A single sequence produces `<output>\sequence-1-tick-<start>-to-<end>.mp4`.

### Encoder settings

The builder writes the FFmpeg settings into every config, so a render machine does not depend on its own CSDM settings. With HLAE the video is encoded once, inside HLAE's FFmpeg pipe (`-c:v <codec> -pix_fmt yuv420p <output parameters>`); CSDM then only copies that stream and adds the game audio (AAC 256 kbit/s). No raw frames touch the disk. That is why CSDM's own `CS` recording system is not an option: it writes uncompressed TGA frames, about 900 GB for a 40-minute match at 1080p60.

| Profile | Video | Used for | Measured on the RTX 4070 |
|---|---|---|---|
| `x264` | `libx264`, the club desktop's output parameters (`-profile:v high -level 4.0 -preset medium ...`, default CRF 23) | Desktop, same result as today | 174 s of footage in 271 s including CS2 start; about 13 Mbit/s |
| `nvenc` | `h264_nvenc -preset p5 -tune hq -rc vbr -cq 24 -maxrate 16M -bufsize 32M` | Render servers (L4 and T4 have NVENC), so the CPU stays free for CS2 | 204 s of footage in 185 s including CS2 start (faster than real time) |

At CQ 23 without a cap NVENC produced about 24 Mbit/s (605 MB for 3.4 minutes). The cap brings it near YouTube's recommended 12 Mbit/s for 1080p60, about 35% smaller in a like-for-like comparison, with no speed cost. `-level 4.0` in the desktop settings is formally too low for 1080p60 (4.2 is right); players and YouTube ignore it, so the `x264` profile keeps the desktop value.

### CSDM facts this relies on

- `csdm video --config-file <json>` takes `demoPath`, video settings and a full `sequences` array (`startTick`, `endTick`, `playerCameras[{tick, playerSteamId, playerName}]`, `playersOptions[{steamId, playerName, showKill, highlightKill, isVoiceEnabled}]`, `cameras`, `showXRay`, `showAssists`, `recordAudio`, `playerVoicesEnabled`, `deathNoticesDuration`, `cfg`). Settings not in the file come from `%USERPROFILE%\.csdm\settings.json`.
- The demo must be in the CSDM database the CLI is connected to (it reads player slots from it). A local database on the worker is enough.
- The HLAE location comes only from `settings.json` (`video.hlae.customExecutableLocation`), not from a flag.
- CSDM writes an actions file next to the demo: it jumps to `startTick - tickrate`, runs `spec_player` at each camera tick, starts recording at `startTick`, stops at `endTick` and runs `quit` at `endTick + 64`. If that tick is past the end of the demo, CS2 never exits and the CLI waits forever; the builder caps the end tick for that reason.
- HLAE is required. CSDM's other recording system (`CS`, native `startmovie`) writes raw TGA frames: about 900 GB for a 40-minute match at 1080p60. HLAE pipes frames straight into FFmpeg.
- CSDM's bundled FFmpeg (7.1.1) has `h264_nvenc`. It encoded 1080p60 at 259 fps on the RTX 4070, so encoding will not slow a render down if NVENC is used.
- On Linux CSDM can only use `CS` recording and has no HLAE, which is why the headless CSDM on the game VM cannot make videos and the render server has to be Windows.

### Verified on the workstation (26 September 2026, CS2 1.41.8.5)

| Test | Result |
|---|---|
| Test demo (`2026-09-11_..._de_vertigo_...dem`, one round, one kill) | 1920×1080, 60 fps, 686 frames = 11.43 s (expected 11.44 s), H.264 High + AAC stereo. Starts at "MATCH START"; kill feed shows Malawhur → ekl1ps (USP-S headshot) and "TEAM A WINS THE ROUND"; ends 1 s later; no X-ray outlines |
| xplay match of 25 September (`match_519c7e...dem`, de_biome, 12 players, 13–4), rounds 1–2, `x264` | 174.1 s as planned. Eight of the 21 camera switches checked frame by frame: each time the HUD shows the expected killer shortly after the switch. Audio continuous; the voice indicator is active throughout. Whether player voices are audible needs someone to listen |
| Same match, round 16 to the end, `nvenc` | Starts at 3–12, wormik defusing, bomb explodes at tick 110708 killing two players, "NERULL WINS THE ROUND" 4–13, video ends 1 s later at 110772 (demo ends at 110901) |
| Real xplay data from the local database | Last kill = last round end = 251563, demo ends at 251756: the end tick and the `quit` fall inside the demo |
| Updater | Found HLAE 2.192.6 (released 26 September, fixes broken sniper scopes), downloaded and verified it, switched CSDM to it, passed the 8-second smoke test in 40 s; a second run changed nothing and took 1 s |

Problems found and handled:

- **HLAE falls behind CS2.** The first attempt failed with `Problem in ...\AfxHookSource2\MirvColors.cpp:301`: HLAE 2.191.1 against this week's CS2 build. Four HLAE releases came out between 23 and 26 September. Hence the [update system](#keeping-cs2-hlae-and-cs-demo-manager-current).
- **Old demos stop playing.** CS2 1.41.8.5 refused a January 2026 demo (network protocol 14129; the server records 14181 today) with "Demo file is incompatible with this game version". Videos therefore have to be rendered soon after the match; the archive's older demos can no longer be rendered.
- **Workshop maps.** That January server ran de_dust2 from the Workshop, and the xplay match is on de_biome, so CS2 downloads the map on first playback (256 MB for dust2). Render servers need Steam online and keep the Workshop cache on their disk; the 8-minute start timeout covers the first download.
- **Long paths**, see the guard rails above.

## Architecture

```
admin browser             backend VM (1 GB)                        render VM (Windows, L4 GPU)                  YouTube
────────────────          ─────────────────────────────            ─────────────────────────────                ───────────
Video yarat ──► POST /demos/:name/video
                          video_jobs: queued
                          videoRenderers.js: start a stopped ────► boot, auto-logon, Steam, CS2 up to date?
                          pool VM (one per queued job)
                                              ◄──── POST /video-render/claim (GCE identity token)
                          job: signed demo URL (2 h), metadata,
                          upload-only YouTube token (1 h) ────►    download + verify demo
                                                                    record-demo.ps1 (HLAE + NVENC)
                                              ◄──── heartbeat       resumable upload ────────────────────────► videos.insert
                                              ◄──── POST /video-render/result {videoId}
                          videos.list (proof) + playlistItems.insert ─────────────────────────────────────────► playlist
                          watchdog: stale/idle/overtime → stop VM   no job for 10 min → shuts itself down
```

### Design decisions

1. **A pool of stopped Windows VMs instead of a new VM per job.** Each worker (`csbatagi-render-1..N`) keeps its own disk with Windows, the GPU driver, a signed-in Steam and the 60 GB CS2 install. "Video yarat" starts a free pool member, which looks the same to admins as spinning up a new server. Creating VMs from an image per job would re-download or copy about 100 GB each time, and a cloned Steam install normally asks for a new sign-in and Steam Guard code, which cannot be automated safely. A stopped VM costs only its disk. Parallelism = pool size.
2. **One Steam account per worker.** Steam runs a game on only one PC per account at a time, so two workers on one account would kick each other out. CS2 is free and demo playback needs no Prime; free accounts should do (confirmed with the first one in phase 1).
3. **Analysis is repeated locally on the worker** (PostgreSQL 17 on the VM, `csdm json`). The render VM needs no production database password and no route to the backend's database. The website's analysis stays the gate (the button is shown only for analyzed demos) and provides the title data. The worker's CSDM version is then also free to move ahead of the desktop version if a CS2 patch ever requires it (normally it stays equal, see [below](#keeping-cs2-hlae-and-cs-demo-manager-current)).
4. **No long-lived keys on the render VMs.** Workers prove who they are with the VM's Google identity token (a signed JWT from the metadata server naming the project and instance; the backend checks the signature and the instance name against the pool list). Demos arrive by 2-hour signed URLs, as for the analyzer. For YouTube, the backend holds the refresh token and gives the worker an access token limited to `youtube.upload` that expires in an hour (narrowed with the `scope` parameter when refreshing; if Google does not accept that for these scopes, a second, upload-only authorization is kept for the workers' tokens). The VMs run as a service account with no roles, only so they can get identity tokens.
5. **HLAE + NVENC**, 1920×1080, 60 fps (the current manual setting), the `nvenc` profile from [Encoder settings](#encoder-settings). On the RTX 4070 that renders faster than real time; 30 fps halves the work if the L4 turns out slower.
6. **Three layers against runaway cost:** the worker shuts Windows down after 10 idle minutes (a guest shutdown stops GPU and CPU billing on GCE); the backend stops any pool VM that is idle, has no heartbeat for 10 minutes after a 25-minute boot allowance, or runs past `3 × match duration + 30 min`; and a daily job cap.

### Render VM

| Item | Plan (phase 1 confirms or changes it) |
|---|---|
| Zone | `europe-west3-b`: L4 and T4 with the Virtual Workstation licence (`-vws`) are offered there, and the demo bucket is in `europe-west3`, so downloads are free and fast |
| Machine | `g2-standard-8` (8 vCPU, 32 GB) + 1× `nvidia-l4-vws`; try `g2-standard-4` once render speed is measured. Fallback `n1-standard-8` + `nvidia-tesla-t4-vws` |
| OS / disk | Windows Server 2022 Datacenter, 150 GB balanced PD (Windows ~35 GB, CS2 ~60 GB, Workshop maps, output: at most about 5 GB for a 40-minute match with the capped NVENC profile) |
| Driver | NVIDIA RTX Virtual Workstation (GRID) driver from Google's Windows GPU driver script; the vWS licence comes with the `-vws` GPU type |
| Session | Auto-logon of a local `render` user; a logon-triggered scheduled task runs the worker in that interactive session (CS2 cannot render from a service). The group policy "Use hardware graphics adapters for all Remote Desktop Services sessions" stays on so setup over RDP also sees the GPU |
| Network | Ephemeral external IP for Steam and YouTube bandwidth. The project's `default-allow-rdp` rule opens 3389 to the internet on every VM, so the image's Windows Firewall allows RDP only from IAP (`35.235.240.0/20`); setup goes through `gcloud compute start-iap-tunnel` |
| Software | Steam (signed in once by you over RDP, "remember me", automatic updates without a time window), CS2, CSDM and HLAE managed by `update-tools.ps1`, PostgreSQL 17 (local, loopback only), the worker scripts |

Rough cost, to be replaced with measured billing after phase 1: on the order of $1.5–2 per running hour on demand (L4, vWS and Windows licences, 8 vCPUs), and about $15–20 a month per stopped worker for its disk. A 40-minute match should take about an hour including boot and upload, so roughly $2 a video. Spot VMs cost much less but can be preempted mid-recording; they can be tried after the pipeline is stable, with one automatic retry.

## Backend and website

- **Tables** (startup migrations, like `demo_files`): `video_jobs` (id, demo name, checksum, state, worker, requested by, attempt, failure reason, YouTube video ID, timestamps, heartbeat) and `video_workers` (name, phase, current job, last seen, last start/stop reason).
- **Job states:** `queued` → `starting` → `rendering` → `uploading` → `published`, or `failed` (reason) / `cancelled`. One automatic retry for infrastructure failures (preemption, stale heartbeat), none for `demo-incompatible`. Jobs stay `queued` while workers report `tools-incompatible`.
- **Tool watch** (hourly, in `videoRenderers.js`): see [Keeping CS2, HLAE and CS Demo Manager current](#keeping-cs2-hlae-and-cs-demo-manager-current).
- **`videoRenderers.js`**, modeled on [analysisServer.js](../../backend/analysisServer.js): starts as many stopped pool VMs as there are queued jobs, runs the watchdog once a minute, and refuses to touch any VM that is not in `VIDEO_WORKERS` (the same guard as `assertGameServer`). A zone without free GPUs makes the start fail; the job stays queued with "GPU bulunamadı" and is retried on the next tick or on another pool member.
- **Routes:** `POST /demos/:name/video` and `DELETE /video-jobs/:id` (admin session); `/demos` listing gains the video state and link. Worker routes `POST /video-render/claim`, `/heartbeat`, `/result`, `/youtube-token`, authenticated by identity token.
- **YouTube** (`youtube.js`): refresh token → access token; `videos.insert` metadata created by the backend (title like `27.09.2026 · Mirage · Team A 13–11 Team B`, description with the roster and a link to the match page, category Gaming, not made for kids, `YOUTUBE_PRIVACY` default `unlisted` until the first videos are checked, `notifySubscribers: false`). After the worker reports, the backend confirms the video exists on the channel with `videos.list` before `playlistItems.insert` at position 0 (newest first). The worker's report is not trusted on its own, the same principle as the analyzer's database check.
- **Demolar page:** for admins, "Video yarat" next to "Analiz et" on analyzed demos, with the job state (Sırada, Sunucu açılıyor, Kaydediliyor, YouTube'a yükleniyor, Hata: reason) and "İptal". Everyone sees a YouTube link once published. The page already polls while analysis runs; the same polling covers videos.
- **Memory budget:** the backend never handles video bytes (worker → YouTube directly), so the 256 MB container limit is unaffected.

## Worker

`ops/video/render-worker.ps1`, started at logon:

1. Wait until Steam is signed in (`steam-signed-out` otherwise).
2. Pull the repo's `ops/video` at the deployed commit, then `update-tools.ps1 -SmokeDemo <newest server recording> -AllowCsdmInstall` (a second or so when nothing changed). Report its JSON summary; on `cs2-update-timeout` or `tools-incompatible`, report and shut down.
3. Claim a job. None for 10 minutes → `Stop-Computer`.
4. Download the demo from the signed URL; check size, the `PBDEMS2` stamp and a safe name (the analyzer's checks).
5. `record-demo.ps1 -Encoder nvenc` with the job's `--source`. "Recording did not start" for a demo with an older network protocol than the smoke demo → `demo-incompatible`; CSDM's "HLAE error" → `tools-incompatible` (and the next boot re-runs the smoke test); no video → `game-error`.
6. Resumable upload to YouTube with the job token (asks for a fresh token if an upload outlives it); keep the video ID in a local state file so a crash after upload never uploads twice.
7. Report the result, delete the demo and video, go back to 3.

`ops/video/prepare-render-vm.ps1` installs everything above on a fresh VM (idempotent, logs versions) except the Steam sign-in, which you do by hand. It also sets CS2's `-condebug` launch option in the worker's CSDM settings, so the game's console log is available when a recording fails.

## Keeping CS2, HLAE and CS Demo Manager current

[`ops/video/update-tools.ps1`](../../ops/video/update-tools.ps1) with [`ops/video/tools.json`](../../ops/video/tools.json):

| Component | How often it changes | How it stays current |
|---|---|---|
| CS2 | Valve patches, sometimes several a week | Steam on each worker, automatic updates with no time window. The script asks Steam's public `UpToDateCheck` API for the live patch (asked with version 0 it answers `required_version` 14185 = 1.41.8.5) and waits until the install matches (`appmanifest_730.acf` StateFlags 4, `steam.inf` PatchVersion) |
| HLAE | Usually within 1–2 days of a CS2 patch that breaks it; four releases between 23 and 26 September | `"track": "latest"`: newest stable GitHub release, checked against the SHA-256 digest GitHub publishes for the asset, unpacked beside the previous version, CSDM pointed at it. A bad release is frozen out by replacing the block with `{version, url, sha256}` |
| CS Demo Manager (CLI, its CS2 plugin, the FFmpeg it installs) | A few releases a year | Pinned to the club's version (3.20.1, the same as the desktop and the game VM analyzer, so analysis matches everywhere). Bumped by pull request; workers install it silently (`-AllowCsdmInstall`). The script never installs it on a desktop unless asked |
| NVIDIA driver, Windows | Rarely matters | Windows Update during maintenance boots; the driver only when a smoke test or phase 1 shows a need |

**The gate is a real recording.** Whenever the combination (CS2 patch, HLAE, CSDM, encoder) differs from the last one that recorded, the script records 8 seconds of a smoke demo and checks the file (duration, resolution). If that fails right after an HLAE change, the previous HLAE is restored and tested again. If it still fails, CS2 changed in a way no HLAE release handles yet: status `tools-incompatible`. The smoke demo must be recent, because CS2 refuses demos from before its last format change, so the backend hands each worker its newest archived server recording.

**When it runs:**

1. At every worker boot, before a job is claimed.
2. An hourly check in the backend: Steam's live CS2 patch (one public HTTP call) and HLAE's latest release tag (GitHub API), against the last working combination the workers reported. If something changed and no job is running, the backend starts each worker once in maintenance mode between 04:00 and 06:00 Istanbul time. It updates, smoke-tests and shuts down, so the next real job does not wait for a multi-GB CS2 download. A worker that misses this is updated at its next boot anyway.
3. While a worker reports `tools-incompatible`, new jobs stay queued with "CS2 güncellendi, HLAE güncellemesi bekleniyor" instead of burning GPU time. The hourly check retries when a new HLAE release appears.

**Why automatic rather than pin-and-PR** (the first draft of this plan): waiting a day for someone to merge a version bump is exactly the gap that broke recording this week. The risk stays bounded. A render VM holds no long-lived keys (design decision 4), so the worst a bad HLAE release could reach is a throwaway Steam session and a one-hour upload-only token. Every download is checked against GitHub's published digest, and the smoke test with rollback catches a release that runs but records wrongly. CS Demo Manager stays pinned because it changes rarely and should match the club's analyzer.

**Render soon after the match.** CS2 stops playing demos recorded before a format change, so a match that was never rendered may become impossible to render. `VIDEO_AUTO_RENDER` queues a video as soon as a club match's analysis succeeds; it stays off until the pipeline has been trusted for a while. A demo CS2 refuses fails as `demo-incompatible` and is not retried.

Tested on the workstation on 26 September 2026: `-CheckOnly` reported HLAE 2.192.5 → 2.192.6; the real run installed and verified 2.192.6, switched CSDM to it, passed the smoke test (40 s) and saved the combination; a second run changed nothing (1 s).

## Phases

| Phase | Work | Done when |
|---|---|---|
| 0. Workstation | Done 26 September: scripts, encoder profiles, guard rails, updater, recordings checked frame by frame (see [Verified](#verified-on-the-workstation-26-september-2026-cs2-14185)). Left: someone listens to the voice track, and optionally one full match side by side with a manual video | Done, apart from the listening check |
| 1. One cloud VM by hand | GPU quota; `video-render` service account (no roles); `csbatagi-render-1`; driver, Steam sign-in, CS2, CSDM, HLAE, PostgreSQL; run `record-demo.ps1` without an RDP session attached | A full match rendered on the VM; render speed, boot time and cost per hour measured; machine size chosen |
| 2. Jobs without YouTube | Tables, routes, `videoRenderers.js`, worker loop, identity-token auth, Demolar button and states. Output goes temporarily to `gs://csbatagi-demos/videos/` (14-day lifecycle) with an admin download link | Click → VM starts → video appears → VM stops by itself; a killed worker is detected and stopped |
| 3. YouTube | Enable the YouTube Data API; OAuth client and consent screen; your one-time authorization; secrets; worker upload and backend playlist insert; switch privacy to public after review | A click ends with the video in the Maç Videoları playlist |
| 4. Parallel pool and hardening | Second and third workers (one Steam account each), quotas, daily cap, failure reasons on the page, runbook section here, setup workflow like [demo-analysis-setup.yml](../../.github/workflows/demo-analysis-setup.yml) | Two demos render at the same time; one CS2/HLAE update cycle has gone through the maintenance boot, including a rollback test |

## Access needed

### For testing from this workstation

The `csbatagi@gmail.com` gcloud login on this PC is a project owner, which covers creating VMs and service accounts. What it cannot do by itself:

| Need | Why | Who |
|---|---|---|
| GPU quota: `GPUS_ALL_REGIONS` is **0** today. Ask for 1 now (then the pool size), plus `NVIDIA_L4_GPUS` in `europe-west3` above 1 for the pool | No GPU VM can be created at all until then. Google reviews these requests, sometimes within minutes, sometimes a day or two | You in Console → IAM & Admin → Quotas, or me with your OK |
| `CPUS_ALL_REGIONS` 32 (3 in use) | Enough for three `g2-standard-8` workers; a fourth needs an increase | Later, same place |
| Steam accounts, one per worker | Steam runs a game on one PC per account | You create them (I cannot create accounts or enter passwords) |
| Steam sign-in on each worker once, over RDP through IAP | Steam Guard needs you | You, about 5 minutes per worker |
| OK to spend | Phase 1 runs a GPU VM for a few hours | You |

### For YouTube (phase 3)

| Need | Detail |
|---|---|
| Enable the YouTube Data API v3 in `esoteric-dryad-256520` | Owner, one command |
| OAuth consent screen (External) set to **In production** | In "Testing" mode refresh tokens expire after 7 days. Only you authorize it, so the "unverified app" warning just has to be accepted once |
| OAuth client (Desktop type) | Created in the same project |
| One-time authorization by the Google account that owns the channel and the playlist | A small script in `ops/video/` opens the consent page locally and pipes the refresh token straight into `gh secret set`, so it is never printed or saved to disk |
| Upload visibility | YouTube locks API uploads to private for unverified projects created after 28 July 2020. This project was created on 20 October 2019, so uploads should be allowed as unlisted or public; the first upload confirms it |
| Quota | Default 10,000 units a day; an upload costs about 1,600, so roughly six videos a day. A club night fits; ask Google for more if needed |

### GitHub secrets for production

New, written only to the backend's secrets file by [deploy.yml](../../.github/workflows/deploy.yml):

| Secret | Purpose |
|---|---|
| `YOUTUBE_CLIENT_ID` | OAuth client of the upload app |
| `YOUTUBE_CLIENT_SECRET` | Same |
| `YOUTUBE_REFRESH_TOKEN` | The channel owner's authorization; the backend makes 1-hour, upload-only tokens from it |

Nothing else. Not secret and set in `docker-compose.yml`: `VIDEO_RENDER_ENABLED`, `VIDEO_WORKERS`, `VIDEO_WORKER_ZONE`, `VIDEO_DAILY_LIMIT`, `YOUTUBE_PLAYLIST_ID`, `YOUTUBE_PRIVACY`. The existing `GOOGLE_CREDENTIALS` (`backend-ci`) already has `roles/compute.instanceAdmin.v1` on the project, so the backend can start and stop pool VMs with no new IAM grant. If phase 2's temporary bucket copies are kept, `backend-ci` needs write access to `videos/`; that can be added to the still-pending `uploads/` grant (same command, both prefixes in the condition).

Deliberately absent from GitHub and the VMs: Steam passwords (only a remembered sign-in on each worker's disk, entered by you), database passwords on workers (local database), a worker token (identity tokens), and the Windows password (random per VM, resettable with `gcloud compute reset-windows-password`).

**"No keys anywhere else, right?"** Today the source of truth is GitHub secrets, but deploys write them as files onto the VMs (`credentials.json` and the secrets files on the backend, the analyzer's password and web token on the game VM), and this workstation has local copies (`credentials.json`, `*_secrets.local`), all git-ignored. This plan adds three secrets that go only to the backend and gives the render VMs nothing from GitHub.

## Security issue found while planning (separate from this feature)

The `default` network's `sql` rule (`tcp:3306,5432` from `0.0.0.0/0`) applies to every VM, and `backend-1` publishes PostgreSQL on its public IP: a TCP connection to `34.24.100.156:5432` from the internet succeeded on 26 September 2026. It is password-protected, but open to guessing. `default-allow-rdp` and `default-allow-ssh` are also open to the internet on every VM. The game VM reaches the database over the private network, so the public rule is only needed for desktop CSDM connections from home; limiting it to known IPs or an IAP/SSH tunnel would close it. Changing it affects how stats are pushed from the desktop, so it needs the owners' decision.

## Alternatives considered

- **This workstation (RTX 4070) as the only worker:** no cloud cost, and the same worker script runs here. It depends on the gaming PC being on and idle, so it stays a fallback.
- **New VM from an image per job:** rejected, see design decision 1.
- **Backend uploads to YouTube:** would move multi-GB files through the 1 GB backend VM; the worker uploads directly with a short-lived token instead.
