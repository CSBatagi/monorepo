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
- `POST /live/attendance/reset` — clear all attendance
- `GET /live/team-picker` — returns full team-picker state + version
- `POST /live/team-picker/assign` — assign player to team
- `POST /live/team-picker/remove` — remove player from team
- `POST /live/team-picker/update` — update maps, nameMode, captain, overrides
- `POST /live/team-picker/reset` — reset all team-picker state

All GET endpoints accept `?v=N` — return 304 if server version <= N.

### Frontend

- New `useLivePolling(url, intervalMs)` hook — replaces `onValue` listeners
- Migrate TeamPickerClient: replace all Firebase RTDB reads/writes ✅
- Migrate AttendanceClient: replace all Firebase RTDB reads/writes ✅
- Remove `firebase/database` imports from these files ✅
- Notification emit route reads coming count from PostgreSQL (fallback: Firebase RTDB) ✅
- Note: `/attendance` stays in `FIREBASE_ROUTES` because `emitTekerDonduIfNeeded()` needs `firebaseAuth.currentUser.getIdToken()`

## Phase 2: MVP Voting (P1)

- `mvp_votes` table (date, voter, voted_for)
- `mvp_locks` table (date, locked, locked_by)
- Backend CRUD routes
- Migrate GecenInMVPsiClient

## Phase 3: Batak + Admin (P2)

- `batak_captains` + `batak_super_kupa` tables
- `admins` table
- Migrate BatakAllStarsClient, SuperKupaBracket, AdminStatsButton

## Phase 4: Notifications (P2)

- Keep FCM for push delivery (no alternative)
- Move preferences, inbox, subscriptions, events to PostgreSQL
- Backend scheduler reads from PostgreSQL instead of RTDB
- Only firebase-admin Messaging remains

## What Stays on Firebase

- **Firebase Auth** — login flow works, HMAC session cookie minimizes impact
- **FCM push delivery** — no self-hosted alternative without significant infra
- **Service worker** — firebase-messaging-sw.js for background notifications
