# Community server equipment

Members use `/ekipman` to build their own server loadouts. This is a cosmetic overlay on CS Batagi's community server; it does not add tradable items to Steam or change official matchmaking inventory.

## Choice of plugin

Research checked on 11 September 2026:

| Project | Fit |
| --- | --- |
| [WeaponPaints](https://github.com/Nereziel/cs2-WeaponPaints) | CounterStrikeSharp, weapon finishes, knives, gloves, agents, music and pins. Requires MySQL and additional menu/settings dependencies. |
| [Inventory Simulator](https://github.com/ianlucas/cs2-css-inventory-simulator) | Selected. CounterStrikeSharp, HTTP equipment API, weapons, knives, gloves, agents, stickers, charms and music. Our Express/Postgres backend implements its v5 contract; no new database service or website framework. |
| [Swiftly WeaponSkins](https://forum.swiftlys2.net/t/weaponskins-swiftlys2-skin-changer/66) | Uses another plugin framework, adding an unnecessary runtime to this server. |

The user experience follows the [xplay skinchanger](https://xplay.gg/blog/cs2-skinchanger-how-it-works-and-how-to-access-it-on-our-servers/) pattern: searchable items, personalized attributes and saved loadouts. It is our own implementation and does not use xplay accounts, assets, APIs, marketplace or virtual currency.

## Member flow

1. Sign in to the website and open **Ekipman**.
2. If the signed-in email already has a Steam link in `cosmetic_accounts`, the page automatically loads that player's Steam avatar/name, level, XP, regular and premium tokens, collection and saved sets. No new code is needed. Steam profile lookup uses the existing avatar endpoint, with the login name and fallback avatar/initials when Steam is unavailable.
3. Only members without a saved link choose **Kod oluştur**, join `cs2.csbatagi.com:27015`, and enter `css_bagla CODE` in the game console (or `!bagla CODE` in chat). Codes expire after ten minutes and can only be used once. Use the console to keep the code out of public chat.
4. Press **Bağlantıyı kontrol et**. No Steam password or manually entered Steam ID is required; the plugin identifies the connected player.
5. Browse item tiers, spend earned tokens to permanently unlock an item, then choose T or CT and add it to a set. Free starter items need no purchase. Weapons support five sticker slots and one charm; attachments have their own permanent unlocks. Float is restricted to each finish's bounds, seed to 0–1000, and name tags to 20 characters.
6. Maintain up to three named sets, choose the active one, and save. Sets persist in PostgreSQL.
7. Join/reconnect or enter `!ws`. Changes apply at the next spawn, with a 30-second refresh cooldown. Immediate weapon replacement is disabled for competitive play. Unequipped slots use the player's original Steam inventory; music is a single shared slot across teams.

`frontend-nextjs/public/data/players.json` is a roster of player names, Steam IDs and activity status; it does not map Google login emails. The stats database's `steam_accounts` table also has no email identity. Neither source can establish account ownership by matching display names.

StatTrak is a session counter, reset when the inventory is fetched again. Sticker position/rotation and charm offsets are not exposed; images show representative items, not a rendered preview of the chosen float/pattern. The catalogue currently includes 13,590 entries (including stickers and charms), not 13,590 weapon skins.

## Progression and premium awards

The progression economy starts at the first successful insertion into `cosmetic_economy` during backend migration. That timestamp is persisted and never reset by restart, reanalysis or a season change. Earlier matches are not backfilled. New Steam-linked wallets receive 30 welcome tokens once per verified SteamID. XP, balances and unlocks persist across seasons; they are independent of Token Wars and other feature currencies.

| Reward | Tokens | XP |
| --- | ---: | ---: |
| Each recorded eligible map | 10 | 100 |
| First eligible map of the game night | +5 | +50 |
| Team victory | +2 | +20 |
| HLTV 2 rating >= 1.20 **or** >= 5 assists (once per map) | +2 | +20 |

Every 300 XP gains a level, starting at level 1. There are no streak penalties, random drops or seasonal expiry. Base participation is the largest reward. Game nights roll over at 06:00 Europe/Istanbul, so playing past midnight does not create another first-night bonus.

| Club tier | Required level | Permanent unlock cost |
| --- | ---: | ---: |
| Başlangıç | 1 | Free |
| Kulüp | 1 | 20 regular tokens |
| Nadir | 3 | 60 regular tokens |
| Seçkin | 5 | 120 regular tokens |
| Premium | 1 | 1 admin-awarded premium token |

These are club reward tiers, not live market valuations. `backend/cosmeticProgression.js` is the policy source: catalog rarity colors determine regular weapon/sticker tiers; music and charms are Kulüp, agents Nadir, and regular knives/gloves Seçkin. The premium reserve includes Dragon Lore, Gungnir, Wild Lotus, Howl, Pandora's Box, Vice, Superconductor, Doppler, Fade, Case Hardened, Katowice 2014 stickers, Crown (Foil) and Howling Dawn. Entire pattern-variable finish families are reserved, including every Doppler phase, because members may freely choose wear/seed. Regular tokens and high levels cannot substitute for premium currency.

Admins open **Yönetici · Premium ödül ver** on `/ekipman`, select a linked member, canonical season and reason (e.g. seasonal MVP or season champion captain), then award 1–10 tokens. Awards are manual, never automatically inferred from stats or captain records. The recipient chooses their own premium items. Every award records the admin's signed-session identity, reason, season, amount and recipient. A UUID makes retries idempotent; reusing the UUID with different details fails. Admin status is checked against the `admins` table on every award and admin-list request.

Rewards settle automatically when the linked member opens `/ekipman`, refreshes rewards or unlocks an item. No browser-submitted match IDs, performance values, balances or identity fields are trusted. A single SQL statement reads `players`, `matches`, `rounds` and the published `stats_refresh_state.dirty=false` flag in one snapshot. Only maps dated after economy launch, no later than now, with at least 12 recorded rounds count. During an import, rewards wait for publishing; incomplete/short warmups do not count. Match checksums and game-night keys are unique per SteamID. Reanalysis does not reissue or claw back settled rewards. Maps for unlinked members remain eligible after they link, provided the maps occurred after launch.

Wallet row locks serialize rewards, spending and awards. Unlock rows and debits commit together. Purchasing an already-owned item is a successful no-charge retry. Ownership covers all sets and supported teams, including stickers/charms. Both save validation and the game's v5 response enforce ownership. Old unrestricted loadout entries that are now locked are omitted (and explained in the UI); existing Steam inventory still supplies empty slots. Previously cached game loadouts change on the plugin's next fetch (`!ws`/reconnect), not immediately on website deployment.

New persistent tables: `cosmetic_economy`, `cosmetic_wallets`, `cosmetic_rewards`, `cosmetic_unlocks`, `cosmetic_premium_awards`. Include these in the normal database backup. Wallets and ledgers are keyed by verified SteamID, so account-email recovery does not mint another starter allowance. Do not delete wallets to unlink an email. No new runtime stats JSON, trigger, background scheduler, dependency or production parallelism is introduced.

## Data and security

- `backend/data/cosmetics-catalog.json`: normalized, pinned [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) snapshot. Its `revision` records the exact source commit. MIT attribution is in `backend/data/COSMETICS-LICENSE.txt`; Valve owns the game item artwork.
- `cosmetic_accounts`: signed-session email, unique verified SteamID64, three-set JSON state, optimistic revision and last game fetch timestamp.
- `cosmetic_link_codes`: SHA-256 of a random 64-bit code, owner email and expiry. One current code per email. Consume/link is atomic and rolls back on uniqueness conflict. Existing account links cannot be silently reassigned; administrator intervention is required for account recovery.
- Every cosmetics route requires the existing server bearer credential. Member reads/writes also require the signed HMAC session. Browser writes cannot supply the target email or Steam ID. The server linking endpoint accepts identity only from the trusted plugin.
- The game adapter reads the existing private `cfg/csbatagi-web-token`, permits only HTTPS requests to `csbatagi.com/backend/cosmetics/`, disables redirects and never exposes the credential through a convar. `invsim_apikey` stays empty. No Steam Web API key or extra service credential is needed.
- Catalogue definitions, paint indices, teams and item types come from the server allowlist. User payloads cannot inject arbitrary entity definitions or model paths. Revision checks prevent stale tabs overwriting a more recent save.
- Per-member rate limiting avoids the backend's shared-proxy IP limit. Game requests have a separate bounded budget. Catalog responses contain at most 48 entries, and images load lazily. Retained catalogue heap measured approximately 8.8 MiB locally after GC. No Docker memory limits or pool sizes were increased.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /cosmetics/catalog?kind=weapon&q=...&weapon=...&offset=0` | Member catalogue search |
| `GET /cosmetics/me` | Member link, saved sets, revision and last fetch |
| `POST /cosmetics/link-code` | Issue a one-time link code |
| `POST /cosmetics/save` | Save `{ state, revision }` for the authenticated member |
| `POST /cosmetics/unlock` | Spend the member's server-priced currency on `{ itemId }`, once |
| `GET /cosmetics/awards` | Admin-only linked-member picker, canonical seasons and last 30 awards |
| `POST /cosmetics/award` | Admin-only `{ requestId, steamId, amount, reason, seasonStart }` premium award |
| `POST /cosmetics/server/link` | Game-authenticated `{ code, steamId }` verification |
| `GET /cosmetics/api/equipped/v5/<SteamID64>.json` | Authenticated plugin equipment read |

Next proxies the member endpoints at `/api/cosmetics/`. Caddy's existing `/backend/*` route exposes the game endpoints with their bearer authentication. These tables are independent of match statistics and are not included in stats generation or publishing triggers.

## Build, deployment and rollback

Plugin pin: `ianlucas/cs2-css-inventory-simulator` commit `5e3c96283b3d3f5aeba44822a38031df2e213376`. It uses .NET 10 and CounterStrikeSharp API 1.0.371; the game VM's installed CounterStrikeSharp 1.0.374 already includes .NET 10.0.3. Do not replace the installed runtime with the older .NET 8 directory that remains alongside it.

```powershell
./ops/cs2/build-inventory.ps1 -Source C:/path/to/pinned-checkout -Dotnet C:/path/to/dotnet.exe -Output C:/path/to/package
```

The checked patch changes the default API URL and authenticates reads. `CSBatagiInventory.cs` adds account linking and the server-only `csbatagi_inventory_check` diagnostic. The build copies gamedata, translations and upstream MIT license. Keep the source pin, patch and gamedata together; game updates can invalidate native signatures.

Stage the build, `inventory.cfg`, and `install-inventory.py` on the game VM. The installer refuses to restart an occupied server, a loaded/live match, an active recording or pending uploads. It backs up touched files under `/home/steam/inventory-backup-<timestamp>/` and installs into the existing CounterStrikeSharp directory. `server.cfg` loads `csbatagi-inventory.cfg`. The skin plugin requires `FollowCS2ServerGuidelines=false` in CSS core configuration, as other skin replacement plugins do; this setting is captured in the backup and should not be described as Valve approval of server skins.

Build the website on the workstation/CI, never on the 1 GiB backend VM. `deploy-cosmetics-web.py` layers a prebuilt `.next` and backend files over the current running image IDs and preserves compose environment, volumes, networking and 256 MiB limits. It records a rollback override in `/home/runner/cosmetics-web-backup-<timestamp>/rollback.yml`. Normal CI must publish these source changes before its next deployment replaces those local images.

Deploy progression backend and frontend together. The staged backend must also include `cosmeticProgression.js` and `cosmeticProgressionStore.js`; the deployment script copies both. The existing game plugin needs no change. Verify every progression migration succeeded before smoke testing. Rolling the backend back to the old unrestricted implementation disables ownership enforcement; keep the progression backend when only rolling back presentation, or accept that the old backend reopens the catalog. Never reset `cosmetic_economy.starts_at` as a rollback step.

For website rollback, run `docker compose -f /home/runner/docker-compose.yml -f <backup>/rollback.yml up -d --no-deps backend frontend-nextjs`. Keep the cosmetics tables for recovery; they do not alter existing stats data.

For game rollback, first verify the server is empty with no match or recording. Stop `cs2`, restore each previously existing path from the backup's `manifest.json`, and move any newly installed plugin/gamedata/config out of the active directories. Restore `core.json` and `server.cfg`, then start `cs2`. Do not touch the match plugin, demos or private credentials.

## Verification

Progression source validation (local, not a live deployment): 42 targeted tests passed, including 8 against a disposable PostgreSQL 17 instance. These cover concurrent wallet settlement, repeated imports, the Istanbul night boundary, launch/dirty/warmup eligibility, overspending, premium and level gates, admin revocation and award retries, and saved/game attachment enforcement. TypeScript also passes.

Run the database tests against a disposable local database (they create and remove a unique schema, refuse non-local hosts, and skip without this environment variable):

```powershell
cd backend
$env:COSMETICS_TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/postgres'
npm test -- --runTestsByPath test/cosmetics.test.js test/cosmeticProgression.test.js test/cosmeticProgressionDb.test.js test/gameServer.test.js test/demoRoutes.test.js
```

The deployed smoke script now checks ownership rejection, admin-only award access and idempotent purchases before saving all categories. It grants test balances only to its synthetic SteamID after proving that neither an account nor a wallet already uses it, then removes its account, wallet, unlocks and reward records. It does not insert real match/stat data or award real members.

- `npm test -- --runTestsByPath test/cosmetics.test.js test/gameServer.test.js test/demoRoutes.test.js`: 31 tests passed.
- `npx tsc --noEmit --pretty false` and Next production build passed.
- Pinned plugin compiled with .NET 10; the running game server lists both InventorySimulator and MatchZy as loaded. Refresh is enabled, immediate replacement disabled, zero automatic restarts after startup, and CSTV/voice status retained.
- `ops/cs2/smoke-cosmetics.cjs` exercises the deployed frontend/session proxy, Postgres link and save, replay rejection, optimistic conflicts and all game payload categories using a temporary synthetic account. It removes only its own account/code in `finally`.
- Run `csbatagi_inventory_check` through local RCON and read `csbatagi-state/inventory-check.json`; its `checkedAt` must advance and `success` must be true. This verifies the actual plugin can authenticate and parse the website response. Capturing `Server.GameDirectory` in plugin startup is essential: it invokes an engine native and cannot be read on the HTTP background thread.
- Human-client visual acceptance is still required: link a real member, save a set, use `!ws`, respawn and inspect knife/gloves/weapon/stickers/agent in game. A plugin load or API response alone does not prove rendered appearance or 20-player gameplay performance.

### Live installation, 11 September 2026

- Website and backend installed; the full production smoke check passed and removed its synthetic account/code.
- The game plugin's authenticated v5 check reported `success=true` at `2026-09-11T11:18:56Z`. InventorySimulator and MatchZy both load; zero automatic restarts after startup. The service reports a core dump when the old CS2 process exits through its existing stop procedure; the subsequent process is running normally.
- Website startup stats hydration took approximately 92 seconds. The startup prewarm kept published stats version 52 unchanged. No match/analysis data was inserted by these tests.
- Measured running container memory: backend approximately 175 MiB / 256 MiB, frontend approximately 71 MiB / 256 MiB, PostgreSQL approximately 82 MiB / 192 MiB.
- Original game backup before cosmetics: `/home/steam/inventory-backup-20260911T110901Z`. The subsequent plugin correction also has a backup at `/home/steam/inventory-backup-20260911T111805Z`.
- Original website rollback: `/home/runner/cosmetics-web-backup-20260911t110943z/rollback.yml`. The active deployment override is `/home/runner/docker-compose.cosmetics.yml`.
- Final frontend correction deployed as `csbatagi-cosmetics-frontend-nextjs:20260911t112008z`; its rollback override is `/home/runner/cosmetics-web-backup-20260911t112008z/rollback.yml`. The editor renders through a body portal so the page shell's animation cannot clip it. Search, sticker selection, desktop display and the 390-pixel mobile editor were checked in the authenticated production browser; no personal loadout was saved by those UI checks.
- The initial installation used local deployment layers before the source was committed. The implementation is now versioned on `main`; normal CI builds include the cosmetics routes, catalogue and website. The game plugin is installed separately using the pinned build and installation scripts above.
