# Firebase → PostgreSQL Migration Plan

## Why Migrate

Firebase RTDB is hosted on Google's infrastructure. Every page load requires:
1. Download Firebase client SDK (~200-400 KB JS)
2. WebSocket handshake to Google servers (~100-200ms from Turkey)
3. Firebase Auth token resolution
4. Subscription for each `onValue` listener (7+ on team-picker page)

Our PostgreSQL is on the **same VM** (Docker internal network). Queries take <1ms.

## Current Firebase RTDB Paths

| Path | Used By | Priority |
|------|---------|----------|
| `attendanceState` | AttendanceClient, TeamPickerClient, Backend scheduler | P0 |
| `emojiState` | AttendanceClient | P0 |
| `kaptanlikState` | AttendanceClient, BatakAllStarsClient | P0 |
| `teamPickerState/*` | TeamPickerClient | P0 |
| `mvpVotes/*` | GecenInMVPsiClient | P1 |
| `batakAllStars/*` | BatakAllStarsClient, SuperKupaBracket | P2 |
| `notifications/*` | NotificationContext, Backend scheduler | P2 |
| `admins/{uid}` | AdminStatsButton, Admin API routes | P2 |

## Real-time Strategy

Replace Firebase RTDB listeners with **short polling** (3s interval).

- Data is tiny (~20 players, 2 teams of ~5 players)
- Uses a `version` counter per table — if version unchanged, server returns `304`
- Total latency: ~5-10ms (local Docker network) vs 100-300ms (Firebase RTDB)
- No extra memory for WebSocket connections on the 1 GB VM

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

- `GET /live/attendance` — returns attendance rows + version
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

## Phase 2: MVP Voting (P1)

- `mvp_votes` table (date, voter, voted_for)
- `mvp_locks` table (date, locked, locked_by)
- Backend CRUD routes
- Migrate GecenInMVPsiClient

## Phase 3: Batak + Admin (P2)

- `batak_captains` + `batak_super_kupa` tables
- `admins` table
- Migrate BatakAllStarsClient, SuperKupaBracket, AdminStatsButton

## Phase 4: Notifications (P2) - IN PROGRESS

- Keep FCM for push delivery (no alternative)
- Inbox storage/read state moved to PostgreSQL
- Preferences, subscriptions, and event dedup are still in Firebase RTDB
- Backend scheduler reads attendance count from PostgreSQL
- firebase-admin remains for Auth verification, RTDB settings/event nodes, and FCM delivery

## Remaining Firebase Dependencies

### Client-Side (loaded only on FIREBASE_ROUTES: `/gecenin-mvpsi`, `/notifications`, `/login`, `/batak-allstars`)

| File | Firebase Feature | Purpose |
|------|-----------------|---------|
| `contexts/AuthContext.tsx` | Auth (client SDK) | Login/signup (email, Google OAuth), `onIdTokenChanged` syncs to session cookie |
| `contexts/SessionContext.tsx` | Auth (dynamic `signOut` import) | Clears Firebase auth state on logout |
| `components/GecenInMVPsiClient.tsx` | RTDB (`onValue`, `set`, `remove`) + Auth (`getIdToken`) | MVP voting: `mvpVotes/byDate`, `mvpVotes/lockedByDate` |
| `components/AdminStatsButton.tsx` | RTDB (`get`) + Auth (`getIdToken`) | Admin check: `admins/{uid}`, stats regeneration |
| `app/batak-allstars/BatakAllStarsClient.tsx` | RTDB (`onValue`, `set`) | Kaptanlik state: `kaptanlikState` |
| `app/batak-allstars/SuperKupaBracket.tsx` | RTDB (`onValue`, `set`, `remove`) | Tournament bracket: `batakAllStars/superKupa` |
| `app/notifications/page.tsx` | RTDB + Auth + Messaging (`getToken`) | FCM registration, notification preferences |
| `components/NotificationForegroundHandler.tsx` | Messaging (`onMessage`) | Foreground push notification display |
| `public/firebase-messaging-sw.js` | Messaging (service worker) | Background push notification handling |

### Server-Side (loaded lazily via `firebaseAdmin.ts`)

| File | Firebase Feature | Purpose |
|------|-----------------|---------|
| `lib/serverNotifications.ts` | Admin RTDB + Messaging | Dispatch FCM messages, persist inbox rows to PostgreSQL, RTDB event dedup |
| `lib/notificationScheduler.ts` | Admin RTDB | Reads `attendanceState` for timed notifications |
| `api/notifications/emit/route.ts` | Admin Auth + RTDB | `verifyIdToken` fallback (for gecenin-mvpsi), `isMvpDateLocked` |
| `api/admin/notifications/send/route.ts` | Admin Auth + RTDB | Admin broadcast: verifies token + checks `admins/{uid}` |
| `api/admin/regenerate-stats/route.ts` | Admin Auth + RTDB | Admin stats regen: verifies token + checks `admins/{uid}` |

### Config Files

| File | Purpose |
|------|---------|
| `lib/firebase.ts` | Client SDK init (app, auth, db, googleProvider) |
| `lib/firebaseAdmin.ts` | Admin SDK init (adminAuth, adminDb, adminMessaging) |
| `components/FirebaseProviders.tsx` | Code-split wrapper, only loaded for FIREBASE_ROUTES |

### What Will Always Stay on Firebase

- **Firebase Auth** — login flow (email + Google OAuth). HMAC session cookie minimizes runtime impact
- **FCM push delivery** — `adminMessaging().sendEachForMulticast()`. No self-hosted alternative without significant infra
- **Service worker** — `firebase-messaging-sw.js` for background push notifications
