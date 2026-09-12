# Steam website login

The website uses [Steam OpenID 2.0](https://partner.steamgames.com/doc/features/auth#website). Google sign-in and equipment linking codes no longer create identities. Members sign in on Steam's own website; CS Batagi receives a verified SteamID, never a Steam password or email address.

## Access and sessions

- Only SteamIDs in `frontend-nextjs/public/data/players.json` can sign in. The backend reads the existing `PLAYERS_FILE` mount (`/app/players.json` in production). All roster entries are eligible, including temporarily inactive players. Missing or unreadable roster data fails closed. Update the mounted roster when adding a member.
- `/api/auth/steam` creates a ten-minute, HMAC-signed, HttpOnly state cookie and redirects to Steam. `/api/auth/steam/callback` checks the cookie, return URL, provider, signed identity fields and response freshness, then asks Steam's fixed HTTPS endpoint to verify the assertion. External post-login redirects and duplicate assertion fields are rejected.
- After Steam verification, the frontend calls the bearer-protected backend `/auth/steam/session`. The backend checks the roster and persists the member. Browser-supplied UID, email and admin flags are ignored.
- Website sessions use 30-day HMAC cookies with `provider: steam` and `steamId`. Both Edge middleware and Node API routes verify signature and expiry. Existing Google cookies cannot access member pages or protected APIs. The retired Google callback redirects to the Steam login page.
- Normal signed-in use renews the cookie for another 30 days, at most once per 30 minutes per browser cookie. Mount/navigation, returning to a visible tab and pointer/keyboard/scroll activity trigger the check. Idle timers and background data polling do not renew it. Existing unexpired five-day Steam cookies upgrade on their next active visit. Logging out, clearing cookies, switching browsers/devices, signing-secret rotation or expiry after inactivity requires Steam sign-in again.
- `POST /api/session/refresh` requires a same-origin request and a valid, unexpired Steam cookie. It calls bearer-protected `/auth/steam/refresh`, which rechecks the roster and the stored SteamID/UID pair before issuing a new cookie. Renewal never contacts Steam, provisions a member, migrates a legacy identity or changes admin roles. Temporary backend failures leave the current cookie intact and retry on later activity after at least one minute. Logout waits for an in-flight renewal before clearing the cookie.
- Browser writes through Next.js require a valid Steam session and reject a foreign Origin. Internal stats prewarm retains its separate bearer authentication. Existing public stats and live read endpoints are unchanged; this change is a member sign-in restriction, not a conversion of all public datasets into private data.
- Roster eligibility is checked at sign-in and renewal. A removed member cannot sign in or renew; the browser clears its session on a renewal rejection. An already-issued token remains cryptographically valid until its expiry if used outside that browser flow. Admin permission is checked from PostgreSQL on each privileged request, so admin revocation is immediate.

`steam_members` is the persistent account directory: SteamID, internal UID, current display name/avatar, optional legacy email, admin role and login timestamps. New members get a SteamID-based UID. The SteamID always identifies equipment and privilege checks; the internal UID keeps notification ownership stable during migration. Display names never establish identity or membership.

## Existing data and admin migration

`cosmetic_loadouts`, keyed by SteamID, replaces email-keyed loadout reads and writes. Migration copies existing linked loadouts, revisions and fetch timestamps once with `ON CONFLICT DO NOTHING`. The old `cosmetic_accounts` and link-code tables remain as recovery data. Wallets, XP, tokens, unlocks and reward ledgers already use SteamID and are untouched. New premium awards record `admin_steam_id`; old email-based audit records remain readable.

On first Steam login, a still-valid signed Google session can carry over its internal notification UID and current admin permission. This requires that the old identity has not already been used and that any existing equipment link matches the verified SteamID. It does not move a conflicting account. Subsequent logins never overwrite a member's UID or restore a revoked admin role. Without a usable old session, a new Steam member is created; old notification records remain in PostgreSQL but are not assigned by guessing a display name.

Before switching production, provision the existing admins explicitly so expired Google sessions cannot lock them out. `backend/migrateSteamAdmins.js` takes an operator-approved private JSON array of `{ email, steamId, legacyUid? }`. It verifies current email-based admin status and roster membership, rejects conflicting links/identities, and commits all entries together only with `--apply`. A legacy UID preserves that admin's notification history. Keep the input outside Git; do not use player-name guesses to grant admin access.

```powershell
cd backend
node migrateSteamAdmins.js ../steam-admin-migration_secrets.local
node migrateSteamAdmins.js ../steam-admin-migration_secrets.local --apply
```

Run against the intended deployment database using its existing private environment. The first command is a rollback-only dry-run, including any required member-table creation. A reviewed private mapping for the two existing admins was prepared during this implementation; it is not part of source control.

## Deployment

Deploy backend and frontend together. The ordinary images copy all new source files. The prebuilt deployment helper must include `steamAuth.js`, `migrateSteamAdmins.js`, `gameServer.js` and `demoRoutes.js` alongside the cosmetics files. Build Next.js locally or in CI, never on the 1 GiB VM. No runtime dependency, background job, connection pool or Docker memory limit was added or increased.

Keep `AUTH_TOKEN`/`MATCHMAKING_TOKEN` shared between services. `SITE_ORIGIN` is optional and defaults to `https://csbatagi.com` in production; set it explicitly when testing a production build at a local origin. `STEAM_API_KEY` is optional for profile names/avatars, not required for OpenID authentication. Google OAuth client configuration is no longer consumed; Google Cloud service credentials still support VM and demo operations.

Take the usual database backup, dry-run/apply the admin migration, deploy both services and check all schema migrations succeeded. Confirm that an actual roster member can finish Steam sign-in, sees their equipment and balance, and retains expected admin controls. Confirm a non-roster Steam account is rejected. Steam Guard/consent must be completed by the account owner. The game plugin's equipped v5 API is unchanged; `!ws` still refreshes equipment. `!bagla` now returns a retirement message.

Rolling back to the Google implementation requires both previous images. Keep the new tables and ledgers for recovery. Because old code reads `cosmetic_accounts`, loadout edits made after Steam deployment would need a deliberate reconciliation before rollback; the migration does not mirror new saves back into the old table. Do not reset wallets or the economy launch timestamp.

## Production rollout — 2026-09-12

Steam login was deployed using an isolated source snapshot based on `bc2438a` plus the Steam changes. Unfinished attendance/loading-recovery edits in the shared workspace were excluded. The initial frontend image was `csbatagi-cosmetics-frontend-nextjs:20260912t221858z`; the subsequent Steam-equipment UI release is recorded in [server equipment](server-cosmetics.md#mixing-owned-steam-skins-and-club-equipment). The corrected backend image is `csbatagi-cosmetics-backend:20260912t222935z`. `/home/runner/docker-compose.cosmetics.yml` pins the running images. These source changes must be included in the next normal CI release before that deployment replaces the local images.

A complete custom-format PostgreSQL backup and verified restore listing are in `/home/runner/steam-login-backup-20260912T221255Z/`. The backup SHA-256 is `902a604c1221b1f8facadb6098a0c127701a7d1f7944cf4322d5edf911d90127`. Both existing admins were migrated with their original internal notification UIDs. The existing linked loadout, economy launch time and all preexisting economy rows were verified unchanged before API testing. Published stats stayed clean at version 54, mutation version 1100.

The first production equipment check exposed an older rewards query referencing `matches.date`. CS Demo Manager stores that timestamp on `demos.date`. The corrected query joins demos by checksum; the PostgreSQL test fixture now follows that real schema. All 12 database checks passed, and the corrected settlement was also exercised against production inside a rolled-back transaction before deployment. Test reads then settled Malawhur's legitimate welcome/match rewards once: 61 tokens, 310 XP, level 2. Repeated reads did not award them again. No item purchase, premium award, attendance edit or game-server operation was performed.

The frontend production build, TypeScript validation and 87 targeted checks passed. All 19 final live API checks passed, covering role enforcement, roster rejection, invalid/legacy cookies, foreign-origin writes, avatar lookup, equipment, stable repeat wallet reads and public login/attendance routes. Live checks use short-lived, server-signed test sessions and do not establish that a real Steam OpenID callback has completed. The rendered login page and its navigation to Steam were verified in a browser; the account owner must complete Steam sign-in/Steam Guard to finish that end-to-end check.

The pre-Steam image rollback override is `/home/runner/cosmetics-web-backup-20260912t221858z/rollback.yml`. The later `20260912t222935z` backup contains the first Steam backend with the broken date query and should not be used as a healthy rollback target. Reconcile any post-deployment loadout saves before returning to the email-keyed implementation.

## Remembered sessions and combined refresh rollout — 2026-09-13

Deployed 30-day activity-renewed sessions together with all pending equipment and attendance loading-recovery changes. Both images use tag `20260912t232155z` (UTC deployment date); backend image ID is `f225eac92972ea4b3903ea821107e9f5bea1308d73c0c2710d16a09fefcb2d47` and frontend image ID is `d0764f1830e9fa4462f38dbce3e51a94debb45bed59912bcbdc950de8cb9c678`. All 433 packaged artifact files were hash-verified inside the running containers. Archive SHA-256: `8fc26013cf360f322737b33d501b517952752007a366d5c5b89d72e7f80313e5`.

Validation passed: the entire backend suite (118 tests, including 13 PostgreSQL checks and 23 loading-recovery checks), 19 frontend Steam/auth/renewal tests, the pull-to-refresh checks, production build and a separate TypeScript check. All 35 live checks passed: 16 new checks for the old five-day cookie upgrade, 30-day signature/cookie expiry, equipment access, current roles, rejected identities/origins, logout, unchanged member records, attendance versions and clean stats, plus the existing 19 login/equipment checks. One early renewal request ran during backend startup hydration and failed temporarily; all checks passed after readiness. Both services were running without OOMs or unexpected restarts, with memory limits unchanged; PostgreSQL was not restarted.

Rollback for this release: `/home/runner/cosmetics-web-backup-20260912t232155z/rollback.yml`. It preserves the working Steam login/equipment release immediately before renewal and loading recovery. No schema or account migration is needed to roll back this release. The source commit skips CI because the existing push-triggered deployment does not wait for image builds and can otherwise replace this directly deployed release with older `latest` images.

## Local checks

```powershell
cd frontend-nextjs
node scripts/check-steam-auth.cjs
npx --no-install tsc --noEmit --pretty false
npm run build -- --no-lint
cd ../backend
npm test -- --runTestsByPath test/steamAuth.test.js test/cosmetics.test.js test/cosmeticProgression.test.js test/gameServer.test.js test/demoRoutes.test.js
# Disposable local PostgreSQL only:
$env:COSMETICS_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55441/postgres'
npm test -- --runTestsByPath test/steamAuthDb.test.js test/cosmeticProgressionDb.test.js
```
