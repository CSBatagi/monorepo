# Firebase → PostgreSQL Migration Plan

## Why Migrate

Firebase RTDB is hosted on Google's infrastructure. Every page load requires:
1. Download Firebase client SDK (~200-400 KB JS)
2. WebSocket handshake to Google servers (~100-200ms from Turkey)
3. Firebase Auth token resolution
4. Subscription for each `onValue` listener (7+ on team-picker page)

Our PostgreSQL is on the **same VM** (Docker internal network). Queries take <1ms.

## Current Firebase RTDB Paths

| Path | Status | Used By |
|------|--------|---------|
| `attendanceState` | **MIGRATED** (P0) — no readers/writers left except stale scheduler | — |
| `emojiState` | **MIGRATED** (P0) — zero references in code | — |
| `kaptanlikState` | **BROKEN** — BatakAllStarsClient reads it, but nothing writes to it anymore | BatakAllStarsClient (read-only) |
| `teamPickerState/*` | **MIGRATED** (P0) — zero references in code | — |
| `mvpVotes/votesByDate/*` | **MIGRATED** (P1) — PG `mvp_votes` table | — |
| `mvpVotes/lockedByDate/*` | **MIGRATED** (P1) — PG `mvp_locks` table | — |
| `batakAllStars/captainsByDate/*` | Active | BatakAllStarsClient |
| `batakAllStars/superKupa/*` | Active | SuperKupaBracket |
| `notifications/preferences/*` | Active | notifications/page.tsx, serverNotifications.ts, backend scheduler |
| `notifications/subscriptions/*` | Active | notifications/page.tsx, serverNotifications.ts, backend scheduler |
| `notifications/events/*` | Active | serverNotifications.ts, backend scheduler (dedup) |
| `admins/{uid}` | Active | admin/check/route.ts, admin/regenerate-stats/route.ts, admin/notifications/send/route.ts |

## Real-time Strategy

Replace Firebase RTDB listeners with **short polling** (3s interval).

- Data is tiny (~20 players, 2 teams of ~5 players)
- Uses a `version` counter per table — if version unchanged, server returns `304`
- Total latency: ~5-10ms (local Docker network) vs 100-300ms (Firebase RTDB)
- No extra memory for WebSocket connections on the 1 GB VM

## SSR Stats Data Path (unified)

All stats pages now use a unified SSR data path via `fetchStats()` in `lib/statsServer.ts`:
- **SSR**: Calls backend directly (server-to-server) via `/stats/incremental` → serves from in-memory cache
- **Client**: `/api/stats/check` as a refresh-if-newer enhancement (not primary source)
- **Disk fallback**: `readJson()` if backend unreachable (written by `layout.tsx` `after()` hook)
- Module-level 10s cache prevents redundant backend calls during concurrent SSR renders

## Phase 1: Attendance + Team Picker (P0) — COMPLETE

### Database Tables

```sql
CREATE TABLE IF NOT EXISTS attendance (
  steam_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'no_response',
  emoji_status TEXT NOT NULL DEFAULT 'normal',
  is_kaptan BOOLEAN NOT NULL DEFAULT FALSE,
  kaptan_timestamp BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_picker (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  team_a_players JSONB NOT NULL DEFAULT '{}',
  team_b_players JSONB NOT NULL DEFAULT '{}',
  team_a_name_mode TEXT NOT NULL DEFAULT 'generic',
  team_b_name_mode TEXT NOT NULL DEFAULT 'generic',
  team_a_captain TEXT NOT NULL DEFAULT '',
  team_b_captain TEXT NOT NULL DEFAULT '',
  team_a_kabile TEXT NOT NULL DEFAULT '',
  team_b_kabile TEXT NOT NULL DEFAULT '',
  maps JSONB NOT NULL DEFAULT '{}',
  overrides JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_version (
  key TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 0
);
INSERT INTO live_version (key, version) VALUES ('attendance', 0), ('team_picker', 0) ON CONFLICT DO NOTHING;
```

### Backend Routes

- `GET /live/attendance` — returns attendance rows + version (includes `kaptanlik` volunteer data)
- `POST /live/attendance/:steamId` — update one player's status/emoji/kaptan
- `POST /live/attendance/bulk` — bulk update multiple players
- `POST /live/attendance/reset` — clear all attendance
- `GET /live/team-picker` — returns full team-picker state + version
- `POST /live/team-picker/assign` — assign player to team
- `POST /live/team-picker/remove` — remove player from team
- `POST /live/team-picker/update` — update maps, nameMode, captain, overrides
- `POST /live/team-picker/reset` — reset all team-picker state

All GET endpoints accept `?v=N` — return 304 if server version <= N.
Rate limiting is bypassed for `/live/*` routes (high-frequency polling by design, all frontend proxy traffic shares one Docker IP).

### Frontend

- `useLivePolling(url, intervalMs)` hook — replaces `onValue` listeners, polls with version-based 304
- `useLivePolling.refetch()` resets the polling timer to avoid redundant requests after writes
- `liveApi.ts` — POST helpers: `updateAttendance`, `bulkUpdateAttendance`, `resetAttendance`, `resetTeamPicker`
- Migrate TeamPickerClient: replace all Firebase RTDB reads/writes ✅
- Migrate AttendanceClient: replace all Firebase RTDB reads/writes ✅
- Remove `firebase/database` imports from these files ✅
- Notification emit route reads coming count from PostgreSQL exclusively ✅
- Notification emit route uses HMAC session cookie (no Firebase ID token needed) ✅
- Teker dondu crossing detection uses in-memory state (no Firebase RTDB transaction) ✅
- `/attendance` removed from `FIREBASE_ROUTES` — zero Firebase SDK on this page ✅
- `/team-picker` removed from `FIREBASE_ROUTES` — zero Firebase SDK on this page ✅

### Known Issue: `kaptanlikState` RTDB path is now dead

After Phase 1 migration, `AttendanceClient.tsx` writes kaptanlik volunteer data exclusively to PostgreSQL (the `is_kaptan` and `kaptan_timestamp` columns in the `attendance` table). However, nothing writes to the `kaptanlikState` RTDB path anymore.

`BatakAllStarsClient.tsx` still reads `kaptanlikState` from RTDB (line 302) to show kaptanlik volunteers in the "Kaptanlik Durumu" tab. **This read returns stale/empty data.**

**Fix needed in Phase 3:** Migrate `BatakAllStarsClient.tsx` to read kaptanlik data from PG via `/api/live/attendance` instead of RTDB.

### Known Issue: Frontend notification scheduler reads stale `attendanceState`

`lib/notificationScheduler.ts` (line 67) reads `attendanceState` from Firebase RTDB unconditionally. Since nothing writes to this RTDB path anymore, it returns stale data. The backend scheduler (`backend/notificationScheduler.js`) correctly reads from PG as the primary source.

**Fix needed in Phase 4:** Migrate `lib/notificationScheduler.ts` to read from PG backend via HTTP, matching how the backend scheduler works.

## Phase 2: MVP Voting (P1) — COMPLETE

### Current State

MVP voting is entirely on Firebase RTDB with no backend routes:

- **Client reads/writes:** `GecenInMVPsiClient.tsx`
  - `mvpVotes/votesByDate` — `onValue` subscription for all votes (line 108)
  - `mvpVotes/votesByDate/{date}/{voterSteamId}` — `set()` to cast vote (line 254)
  - `mvpVotes/lockedByDate` — `onValue` subscription for lock state (line 124)
  - `mvpVotes/lockedByDate/{date}` — `set()`/`remove()` to lock/unlock (line 288)
- **Server-side:** `api/notifications/emit/route.ts`
  - `mvpVotes/lockedByDate/{date}` — `get()` to verify MVP is locked before sending notification (line 87)

### Data Structures

```
mvpVotes/votesByDate/{YYYY-MM-DD}/{voterSteamId} = "votedForSteamId"
mvpVotes/lockedByDate/{YYYY-MM-DD} = { locked: true, lockedAt: number, lockedByUid: string, lockedByName: string } | true (legacy)
```

### Migration Plan

1. **Database tables:**
   ```sql
   CREATE TABLE IF NOT EXISTS mvp_votes (
     date TEXT NOT NULL,
     voter_steam_id TEXT NOT NULL,
     voted_for_steam_id TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (date, voter_steam_id)
   );

   CREATE TABLE IF NOT EXISTS mvp_locks (
     date TEXT PRIMARY KEY,
     locked BOOLEAN NOT NULL DEFAULT TRUE,
     locked_by_uid TEXT,
     locked_by_name TEXT,
     locked_at BIGINT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   INSERT INTO live_version (key, version) VALUES ('mvp_votes', 0) ON CONFLICT DO NOTHING;
   ```

2. **Backend routes (in `liveRoutes.js`):**
   - `GET /live/mvp-votes` — returns all votes + locks + version
   - `POST /live/mvp-votes/vote` — cast/update a vote
   - `POST /live/mvp-votes/lock` — lock/unlock a date
   - `GET /live/mvp-votes/is-locked/:date` — server-side lock check (replaces RTDB read in emit route)

3. **Frontend migration:**
   - Replace `onValue` subscriptions with `useLivePolling('/api/live/mvp-votes', 3000)`
   - Replace `set(ref(db, ...))` calls with HTTP POST via `liveApi.ts` helpers
   - Remove `firebase/database` import from `GecenInMVPsiClient.tsx`
   - Update `api/notifications/emit/route.ts` to call backend HTTP instead of RTDB
   - Remove `/gecenin-mvpsi` from `FIREBASE_ROUTES` (will still need Auth for voter identity — use session cookie instead)

4. **Data migration script:** One-time read of `mvpVotes/*` from RTDB → INSERT INTO PG tables.

## Phase 3: Batak AllStars + Admin (P2)

### Current State

**BatakAllStarsClient.tsx** uses 3 Firebase RTDB paths:
- `batakAllStars/captainsByDate` — read all captain assignments (`onValue`, line 286)
- `batakAllStars/captainsByDate/{date}/{team1|team2}` — read/write per-date captain (`onValue` + `set`, lines 476-477, 559)
- `kaptanlikState` — **BROKEN READ** (nothing writes here anymore, line 302)

**SuperKupaBracket.tsx** uses 1 Firebase RTDB path:
- `batakAllStars/superKupa` — read/write bracket results (`onValue` + `set` + `remove`, lines 231, 313, 322, 345)

**Admin check** uses `admins/{uid}` (Firebase RTDB boolean):
- `api/admin/check/route.ts` — server-side admin check via HMAC session (line 19)
- `api/admin/regenerate-stats/route.ts` — admin check (line 56)
- `api/admin/notifications/send/route.ts` — admin check (line 27)
- `notifications/page.tsx` — client-side admin check (line 164)

**Note:** `AdminStatsButton.tsx` does NOT use Firebase directly anymore. It calls `/api/admin/check` (session cookie) and `/api/admin/regenerate-stats` (session cookie). The Firebase dependency is only in the server-side routes.

### Captain Performance Computation

Captain wins/losses are **NOT stored** in Firebase. They are **computed at runtime** from:
- `sonmac_by_date.json` (match results) — determines team compositions and map wins
- `night_avg.json` (player stats) — HLTV2 and ADR for captain performance deltas
- `batakAllStars/captainsByDate` (RTDB) — only stores which player was captain on which date/team

The computation logic is in `lib/batakAllStars.ts`:
- `computeStandings()` — computes points from HLTV2 + win-rate bonus per night
- `computeCaptainPerformance()` — computes HLTV2/ADR deltas on captained nights
- `computeCaptainTokens()` — counts captain appearances (used for dropping worst nights)

### Migration Plan

1. **Database tables:**
   ```sql
   CREATE TABLE IF NOT EXISTS batak_captains (
     date TEXT NOT NULL,
     team TEXT NOT NULL CHECK (team IN ('team1', 'team2')),
     steam_id TEXT NOT NULL,
     name TEXT NOT NULL,
     assigned_by TEXT,
     assigned_at BIGINT,
     PRIMARY KEY (date, team)
   );

   CREATE TABLE IF NOT EXISTS batak_super_kupa (
     slot TEXT PRIMARY KEY CHECK (slot IN ('semi1', 'semi2', 'final')),
     data JSONB NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE TABLE IF NOT EXISTS admins (
     uid TEXT PRIMARY KEY,
     is_admin BOOLEAN NOT NULL DEFAULT TRUE,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   INSERT INTO live_version (key, version) VALUES ('batak_captains', 0), ('batak_super_kupa', 0) ON CONFLICT DO NOTHING;
   ```

2. **Backend routes:**
   - `GET /live/batak-captains` — returns all captain assignments + version
   - `POST /live/batak-captains/assign` — assign a captain for a date/team
   - `GET /live/batak-super-kupa` — returns bracket data + version
   - `POST /live/batak-super-kupa/save` — save a match result
   - `POST /live/batak-super-kupa/clear` — clear a slot (cascade to final)
   - `POST /live/batak-super-kupa/reset` — reset all bracket
   - `GET /live/admin/check` — check if current user is admin (from PG `admins` table)

3. **Frontend migration:**
   - Replace `onValue` subscriptions with `useLivePolling`
   - Replace `set`/`remove` calls with HTTP POST via `liveApi.ts`
   - **Fix broken kaptanlik read:** read from `/api/live/attendance` (PG) instead of RTDB `kaptanlikState`
   - Remove `firebase/database` imports from BatakAllStarsClient.tsx and SuperKupaBracket.tsx
   - Update admin API routes to check PG `admins` table instead of RTDB `admins/{uid}`
   - Update `notifications/page.tsx` admin check to use `/api/live/admin/check`
   - Remove `/batak-allstars` from `FIREBASE_ROUTES`

4. **Data migration scripts:**
   - Read `batakAllStars/captainsByDate` from RTDB → INSERT INTO `batak_captains`
   - Read `batakAllStars/superKupa` from RTDB → INSERT INTO `batak_super_kupa`
   - Read `admins/*` from RTDB → INSERT INTO `admins`

## Phase 4: Notifications (P2) — PARTIALLY COMPLETE

### Current State

| Feature | Storage | Status |
|---------|---------|--------|
| Notification inbox (in-app messages) | **PostgreSQL** (`notification_inbox` + `notification_inbox_version` tables) | **MIGRATED** ✅ |
| Push delivery | **Firebase Cloud Messaging** (`adminMessaging().sendEachForMulticast()`) | Stays on FCM (no alternative) |
| Preferences (per-user topic toggles) | **Firebase RTDB** (`notifications/preferences/{uid}`) | **NOT migrated** |
| Subscriptions (FCM tokens per device) | **Firebase RTDB** (`notifications/subscriptions/{uid}/{deviceId}`) | **NOT migrated** |
| Event dedup (idempotency log) | **Firebase RTDB** (`notifications/events/{eventId}`) | **NOT migrated** |
| Attendance count for scheduler | **PostgreSQL** (backend scheduler, line 311) | **MIGRATED** in backend, **BROKEN** in frontend scheduler |

### Backend Notification Infrastructure (already in PG)

- `backend/notificationInboxStore.js` — PG tables: `notification_inbox`, `notification_inbox_version`
- `backend/notificationInboxRoutes.js` — Express routes: `/list`, `/persist`, `/mark-all`, `/clear`, `/:id/read`, `/:id/delete`
- Frontend inbox API routes proxy to backend: `api/notifications/inbox/*` → `backend /live/notifications/inbox/*`
- `backend/notificationScheduler.js` — reads attendance from PG (line 311), falls back to RTDB only when `dbPool` is null

### Remaining Migration

1. **Database tables:**
   ```sql
   CREATE TABLE IF NOT EXISTS notification_preferences (
     uid TEXT PRIMARY KEY,
     enabled BOOLEAN NOT NULL DEFAULT TRUE,
     topics JSONB NOT NULL DEFAULT '{}',
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE TABLE IF NOT EXISTS notification_subscriptions (
     uid TEXT NOT NULL,
     device_id TEXT NOT NULL,
     token TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT TRUE,
     platform TEXT,
     user_agent TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (uid, device_id)
   );

   CREATE TABLE IF NOT EXISTS notification_events (
     event_id TEXT PRIMARY KEY,
     sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     topic TEXT,
     recipient_count INT
   );
   ```

2. **Backend routes:**
   - `GET /live/notifications/preferences/:uid` — get user's notification preferences
   - `POST /live/notifications/preferences/:uid` — save preferences
   - `GET /live/notifications/subscriptions/:uid/:deviceId` — get device subscription
   - `POST /live/notifications/subscriptions/:uid/:deviceId` — register/update device
   - `DELETE /live/notifications/subscriptions/:uid/:deviceId` — unregister device

3. **Server-side migration:**
   - Update `serverNotifications.ts` to resolve recipients from PG instead of RTDB
   - Update `backend/notificationScheduler.js` to resolve recipients from PG (remove RTDB fallback)
   - Update event dedup to use PG `notification_events` table instead of RTDB transactions
   - **Fix `lib/notificationScheduler.ts`** to read attendance from PG backend (currently reads stale RTDB data)

4. **Frontend migration:**
   - Update `notifications/page.tsx` to read/write preferences and subscriptions via HTTP
   - Remove `firebase/database` and `get`/`onValue`/`set`/`remove` imports
   - Remove `/notifications` from `FIREBASE_ROUTES` (will still need FCM `getToken` for push registration)

## Remaining Firebase Dependencies (after all phases complete)

### Client-Side (loaded only on FIREBASE_ROUTES: `/login` only)

| File | Firebase Feature | Purpose |
|------|-----------------|---------|
| `contexts/AuthContext.tsx` | Auth (client SDK) | Login/signup (email, Google OAuth), `onIdTokenChanged` syncs to session cookie |
| `contexts/SessionContext.tsx` | Auth (dynamic `signOut` import) | Clears Firebase auth state on logout |
| `components/NotificationForegroundHandler.tsx` | Messaging (`onMessage`) | Foreground push notification display |
| `public/firebase-messaging-sw.js` | Messaging (service worker) | Background push notification handling |

### Server-Side (loaded lazily via `firebaseAdmin.ts`)

| File | Firebase Feature | Purpose |
|------|-----------------|---------|
| `lib/serverNotifications.ts` | Admin Messaging only | Dispatch FCM messages via `adminMessaging().sendEachForMulticast()` |
| `backend/notificationScheduler.js` | Admin Messaging only | Dispatch timed FCM notifications |

### Config Files

| File | Purpose |
|------|---------|
| `lib/firebase.ts` | Client SDK init (app, auth, ~~db~~, googleProvider) — RTDB `db` export can be removed when all phases done |
| `lib/firebaseAdmin.ts` | Admin SDK init (adminAuth, ~~adminDb~~, adminMessaging) — `adminDb` can be removed when all phases done |
| `backend/firebaseAdmin.js` | Backend SDK init (~~adminDb~~, adminMessaging) — `adminDb` can be removed when all phases done |
| `components/FirebaseProviders.tsx` | Code-split wrapper — may be simplified to Auth-only when RTDB is fully removed |

### What Will Always Stay on Firebase

- **Firebase Auth** — login flow (email + Google OAuth). HMAC session cookie minimizes runtime impact
- **FCM push delivery** — `adminMessaging().sendEachForMulticast()`. No self-hosted alternative without significant infra
- **Service worker** — `firebase-messaging-sw.js` for background push notification handling

## Migration Priority Order

1. **Phase 2 (MVP Voting)** — COMPLETE. `/gecenin-mvpsi` removed from FIREBASE_ROUTES.
2. **Phase 3 (Batak + Admin)** — fixes the broken `kaptanlikState` read. Removes `/batak-allstars` from FIREBASE_ROUTES.
3. **Phase 4 (Notifications)** — most complex, requires migrating preferences/subscriptions/events dedup. Removes `/notifications` from FIREBASE_ROUTES.

After all phases: only `/login` needs Firebase client SDK (for Auth). All RTDB usage is eliminated.
