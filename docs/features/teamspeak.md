# TeamSpeak: Steam identity verification and key-free joining

The website offers **Sesliye gel · TeamSpeak** on the home page (all interfaces), in Takım Seçme’s **Sunucu & bağlantı** panel and at `/teamspeak`. The download link selects TeamSpeak 3 on the official downloads page. Voice uses `voice.csbatagi.com:9987` independently of the CS2 VM.

## Member flow

Install TeamSpeak 3, sign into the website with Steam, and click **TeamSpeak’i aç**. The browser may request permission to launch the app. A first-time client enters a restricted, silent **Steam Doğrulama** lobby. The website sends a private message to that connected TeamSpeak identity; enter its ten-character code on the website once. The server binds the verified SteamID to the native TeamSpeak identity, assigns only the club member group and moves that client to **Kulüp**. Later website joins and the saved member bookmark are key-free.

A new TeamSpeak identity requires verification again. **Yeni TeamSpeak kimliği mi?** restarts that flow. No address, server password, privilege-key paste, SteamID entry, special plugin or exported private identity file is required. The website cannot install software, dismiss OS prompts or silently configure audio devices.

Once the application has been opened or a code has been sent, the main launch
control is disabled to avoid opening duplicate native connections. **Aynı
bağlantıda yeni kod iste** reissues proof against the existing lobby nickname
while invalidating the previous request; it does not require another application
connection. If an old attempt expired or backend restarted, close existing CS
Batağı tabs/connections in TeamSpeak, refresh the website and open it once. Guest
clone limits remain unchanged.

## Authentication and security review

[TeamSpeak authenticates native clients with their own cryptographic identities](https://support.teamspeak.com/hc/en-us/articles/360002711518-How-does-the-TeamSpeak-3-user-Authentication-work). Steam OpenID authenticates the website account. This implementation bridges them by proof of control of the connected client, rather than an invitation key.

- No TeamSpeak privilege/invitation key is generated or delivered to the browser. Launch URLs contain only the public host, port, nickname, channel ID and optional bookmark label. ServerQuery credentials and the admin credential remain on the deployment host/backend.
- Backend join/status/verify routes require the internal bearer credential, a valid signed Steam session, current roster membership and the persisted SteamID/UID pair. Browser-provided SteamIDs, names, admin flags or client IDs never establish authority.
- The nickname’s random marker locates a candidate client; it does not authorize one. A private, random 40-bit code goes only to that client inside TeamSpeak. API responses never contain it. The user intentionally types this one-time proof into their own authenticated HTTPS page; it is not a TeamSpeak invitation key or server credential.
- Verification is bound to the SteamID, browser device marker, request UUID and connected native client UID/database ID. It expires three minutes after preparation and permits at most five incorrect guesses. A correct-code storage failure does not consume that budget. Disconnection, ID reuse, an identity already owned by another SteamID, a roster removal or a signature failure prevents assignment. A nickname alone cannot grant membership.
- Only a keyed digest of the code is kept in bounded, transient backend memory. At most three requests per account and 256 total are kept. Restarting backend invalidates pending proofs; verified identity properties and groups survive in TeamSpeak’s database.
- Next.js additionally allowlists response fields and launch parameters. Password/key parameters, accidental credential/debug fields and raw backend errors cannot pass through to the browser. Responses use `no-store` and `no-referrer`. Codes never appear in page URLs or browser storage.
- Default guests have negated, skipped negative join/talk/subscribe/private-message/file powers and cannot create channels. Only the verification lobby has negative needed join/subscribe power; normal rooms require at least 50 join power. Stronger pre-existing room restrictions are preserved. The dedicated member group has no administrative, query-login, permission-editing or group-management rights.
- The backend uses a separate global Query account with an explicit permission list, group member add/remove powers capped at 50, and no server-edit, permission-edit or privilege-key access. `b_client_modify_dbproperties` is required by native `customset` to persist identity bindings; description-edit permission alone does not permit it. Existing manually granted native administrative/other groups remain under operator control; website role/admin status does not grant TeamSpeak administration.
- Query TCP 10011 is bound to localhost and privately available on the existing `db2` Docker network. Its flood-exception allowlist contains localhost, the backend’s current private IP and the host’s exact Docker gateway address; it never includes an entire subnet or public client IPs. Query authentication remains mandatory. UDP voice and the existing native file-transfer port remain public; guest file-transfer permissions are denied.
- Backend maintenance removes this integration’s member group and kicks linked identities when their SteamID leaves the roster (normally within a minute). It also removes unverified guests after approximately three to four minutes. Query/roster outages delay revocation; failures log no credential or code. Independently assigned native groups are outside this group’s revocation scope.
- Authenticated API traffic is limited to 30 calls per member per minute, and query work is serialized with a bounded queue. Polling occurs only during a visible, user-started verification. There is no new dependency, connection pool, schema migration or increased runtime query parallelism.

## Operator setup and production deployment

Use the manually dispatched **TeamSpeak production operations** workflow:

- `audit`: read-only inventory using the existing GitHub/Tailscale SSH secrets. Docker environments, raw logs, passwords and database contents are not printed.
- `deploy`: builds immutable native ARM backend/frontend images on CI, verifies their architecture/revision, preserves the current TeamSpeak image, privately backs up existing images/configuration and stopped TeamSpeak data, restricts Query networking, provisions permissions/account, then checks production.
- `verify`: runs the sanitized live permission/authentication/response checks without deploying.
- `update`: builds immutable website images and updates only backend/frontend, retaining TeamSpeak/PostgreSQL containers, existing native connections and credentials. It refreshes the exact private Query IPs and runs repair/write/readback plus live authentication checks.
- `repair`: updates only the missing native identity-write permission, refreshes the Query flood exception for exact current private IPs, verifies administrative denials, and writes/reads/deletes a unique non-authorizing test field on an existing native identity. No member group or Steam/device ownership is assigned by the probe. Identifiers, codes and credentials remain private.

The current host was audited on 14 October 2026: ARM64 with approximately 8 GiB RAM, rather than the previous 1 GiB GCP web VM. Compose requests the repository’s 256 MiB backend/frontend limits, but this host reports Docker `MemoryLimit=false` and `SwapLimit=false`: its kernel cannot enforce them. Enabling memory cgroups requires a separately planned boot configuration change/reboot. The feature introduces no dependency or pool and bounds its work; the deployment reports this limitation and refuses the same exception on hosts below 4 GiB. PostgreSQL and the runtime-data volume are retained; database containers are not restarted or built.

Private host files:

- `.teamspeak_server_secrets`: the privately generated/recovered bootstrap admin credential, used only by TeamSpeak and operator provisioning.
- `.teamspeak_secrets`: the limited website Query credential and the member/lobby/voice IDs; loaded by backend only.
- `teamspeak-web-backup-<UTC timestamp>/`: previous image pins, Compose, any prior private configuration and a copy of TeamSpeak data taken while stopped.

Credential files use mode 0600; backup/operation directories use 0700. None are uploaded as CI artifacts or committed. Normal deployment preserves the separate TeamSpeak files instead of rewriting them with `.backend_secrets`. Backend Docker build context excludes environment/private files.

`setupTeamSpeak.js` is read-only by default. Applying requires `--apply`, bootstrap configuration supplied privately and an absolute `--output-private=...` file. Credentials are written with mode 0600, never stdout. The production wrapper passes its bootstrap configuration through stdin and copies the result privately; do not paste credentials into shell commands or public logs.

Do not repeatedly run setup against an already configured server: it rotates the website Query login. Prefer `update` for website fixes and `repair` for the narrow native correction. Preserve the private backups. If backend changes Docker IP, refresh the Query allowlist; TeamSpeak automatically reloads it within five minutes. The repair helper backs off during query-flood/disconnect errors instead of restarting TeamSpeak or widening the exemption to a whole network.

## Validation and rollback

### Code-delivered verification failure, 14 October 2026

The initial live checks proved API authentication and administrative denials but
did not exercise native identity writes. A member received the private code,
then verification failed because Query lacked `b_client_modify_dbproperties`.
Native `help customset` identified that exact requirement. It is now mandatory
during setup. [Production repair and validation](https://github.com/CSBatagi/monorepo/actions/runs/38643567529)
confirmed a real identity-field write/readback and removal of the temporary probe,
plus all 21 API/permission checks. The probe never assigned a member group or
Steam/device ownership.

The website update changed backend's private Docker IP, exposing stale Query
flood-exception configuration. Both TeamSpeak operation updates and normal CI
now refresh exact private IP entries. Routine CI's `--allowlist-only` mode does
not read bootstrap credentials or change roles. Identity storage failures no
longer count as incorrect-code guesses; two regressions cover recovery after
repeated storage failures and code reissue on the same native connection.
Frontend TypeScript/proxy checks and the native ARM image builds passed. Browser
QA used a synthetic local code to confirm reset clears input, retains the disabled
launch control, and completes verification without another application launch.

Production test rollout on 14 October 2026:

- Initial backend/frontend images: immutable revision `f00e490b729370ca94c321b19831d2c84f2b7e4d`. The identity-write/retry fix updated website images to `64926c9` without restarting TeamSpeak/PostgreSQL or rotating Query credentials.
- Native member group 9, verification lobby 8, voice room 9. These IDs are public metadata, not credentials.
- [Live validation run](https://github.com/CSBatagi/monorepo/actions/runs/38630723501) passed **21 checks**, plus localhost Query binding and 0600 credential-file checks. External signed-out probes of all three public APIs returned 401.
- Local validation passed 138 automated checks, TypeScript and a production build. Browser verification exercised the actual form/proxy using synthetic local fixtures; no real member desktop identity was impersonated.
- The final deployment guard initially stopped because Docker ignored requested memory limits. The website/native provisioning had already completed; the subsequent independent verification confirmed the live feature. The host capability limitation is documented above.
- Preserve the private snapshot `teamspeak-web-backup-20261014t200600z` and earlier snapshots until the account-owner desktop flow passes.

This review covers the new identity bridge and its credential boundary. Existing repository dependency alerts were reported by GitHub (including four critical alerts); they have not been remediated by this change. The host audit also found PostgreSQL TCP 5432 published on the host; its external firewall reachability was not assessed here. These pre-existing findings require a separate infrastructure/dependency review.

Local checks:

- Backend: `npm test -- --runTestsByPath test/teamSpeak.test.js test/teamSpeakQuery.test.js test/setupTeamSpeak.test.js test/steamAuth.test.js test/gameServer.test.js`.
- Frontend: `node scripts/check-teamspeak.cjs`, `node scripts/check-steam-auth.cjs`, TypeScript and production build checks from local setup.
- Operations: `python ops/teamspeak/test-deploy-production.py`.
- Routine refresh security checks: `python ops/teamspeak/test-repair-production.py` (no bootstrap file or role-command access is needed).

Live checks cover guest/channel isolation, denied website Query administrative/privilege-key actions, current member access, invalid/non-Steam cookies, same-origin protection, key-free response shape, proof-required membership assignment, private port/file permissions and populated stats. A real TeamSpeak desktop join still requires the account owner to complete the one-time code flow. A synthetic session/API check does not establish a completed Steam OpenID login or possession of a real desktop identity.

Rollback images are pinned in the private backup’s `rollback.yml`; its saved Compose and TeamSpeak data preserve the preceding policy. Restoring website images does not undo native permission/database changes. If restoring TeamSpeak data, stop it before restoring the private snapshot and preserve filesystem ownership. Keep Query restricted to localhost/private network even during recovery. Existing website-managed memberships require explicit revocation if the integration is disabled; an absent credential disables both new verification and its maintenance.

Do not delete backups or existing images until the account-owner desktop test has passed.
