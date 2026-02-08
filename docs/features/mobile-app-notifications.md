# Mobile App + Notifications Plan

## Goal

Provide a mobile-app-like experience for a private group (20-30 users) on Android and iOS, with push notifications as the main feature, while keeping the existing website as the single source of truth.

## Current Architecture (Verified from Repo)

### Deployment and Hosting

- App deploys to a GCP VM through GitHub Actions (`.github/workflows/deploy.yml`).
- Runtime stack on VM is Docker Compose + Caddy reverse proxy (`docker-compose.yml`, `Caddyfile`).
- Routes:
  - `https://csbatagi.com/*` -> `frontend-nextjs`
  - `https://csbatagi.com/backend/*` -> `backend`

### Data Ownership

- Match/stats source data: Postgres (`backend` service).
- Generated stats datasets: produced by backend and persisted in `frontend-nextjs/runtime-data/`.
- Live social/game-night state: Firebase Realtime Database (attendance, MVP voting, team picker, admins).

### Stats Publishing Flow

- Backend polls DB timestamp every 60s (`backend/index.js`) and serves:
  - `GET /stats/incremental`
  - `GET /stats/aggregates`
  - `POST /stats/force-regenerate`
  - `GET /stats/diagnostics`
- Next.js proxies and persists datasets in:
  - `frontend-nextjs/src/app/api/stats/check/route.ts`
  - `frontend-nextjs/src/app/api/stats/aggregates/route.ts`
  - `frontend-nextjs/src/app/api/admin/regenerate-stats/route.ts`

### Firebase Realtime Features Already in Use

- Attendance page writes/reads `attendanceState` (`src/app/attendance/page.tsx`).
- MVP page writes/reads:
  - `mvpVotes/votesByDate`
  - `mvpVotes/lockedByDate`
  (`src/components/GecenInMVPsiClient.tsx`)
- Admin gate already exists via `admins/{uid}` (`src/components/AdminStatsButton.tsx`).

## Gaps Before Mobile Notification Rollout

- There is a service worker file (`public/firebase-messaging-sw.js`), but:
  - No active registration flow in React code.
  - No token collection/storage flow (`getToken` not used).
  - No server-side sender path for FCM.
  - No user notification preferences/toggles model.
- PWA metadata exists (`public/manifest.json`), but install/push integration is incomplete.

## Recommended Product Strategy

### 1) PWA-First (Recommended for this team size)

Use the existing Next.js website as an installable PWA:

- Android: install from browser menu ("Add to Home Screen").
- iOS: install from Safari share sheet ("Add to Home Screen").
- No app-store publishing required for MVP.
- Single codebase, minimal maintenance overhead.

### 2) Optional Native Wrapper Later

If you need richer native capabilities later, wrap the same web app with Capacitor/Expo after push MVP is stable.

## Notification Architecture (Extensible)

### Event Types (start here)

- `teker_dondu_reached`
- `mvp_poll_locked`
- `stats_updated`
- `timed_reminders`
- `admin_custom_message`

### Realtime DB Namespaces

Use dedicated nodes to avoid conflict with stats and existing app state:

- `notifications/subscriptions/{uid}/{deviceId}`
- `notifications/preferences/{uid}`
- `notifications/events/{eventId}`
- `notifications/adminMessages/{messageId}` (optional log/audit)

### Suggested Preferences Shape

`notifications/preferences/{uid}`:

```json
{
  "enabled": true,
  "topics": {
    "teker_dondu_reached": true,
    "mvp_poll_locked": true,
    "admin_custom_message": true
  },
  "updatedAt": 1730000000000
}
```

### Suggested Subscription Shape

`notifications/subscriptions/{uid}/{deviceId}`:

```json
{
  "token": "<fcm-token>",
  "platform": "android|ios|web",
  "enabled": true,
  "lastSeenAt": 1730000000000
}
```

## Trigger Rules

### Teker Dondu Notification

- Trigger only on threshold crossing:
  - previous `comingCount < 10`
  - new `comingCount >= 10`
- Create deterministic `eventId` (for dedupe), for example:
  - `teker_dondu_reached:YYYY-MM-DD`

### MVP Poll Locked Notification

- Trigger when `mvpVotes/lockedByDate/{date}` transitions from unlocked to locked.
- Event id for dedupe:
  - `mvp_poll_locked:{date}`

### Admin Custom Message

- Admin UI publishes a message payload (title/body/topic filter).
- Sender dispatches to opted-in subscriptions only.

## No-Conflict Rules with Existing Stats Runtime

- Notifications must not write anything into `runtime-data/`.
- Notifications must not alter existing `/stats/*` contracts.
- Keep notification writes under `notifications/*` only.
- Existing pages (`attendance`, `gecenin-mvpsi`) remain source event producers.

## Security and Operations Notes

- Keep Firebase sender credentials in secret env files only (do not hardcode in source).
- Require admin checks for custom message dispatch (reuse `admins/{uid}`).
- Add idempotency checks (`notifications/events/{eventId}`) before sending push.
- Add basic delivery logging (success/failure counts) for debugging.

## Implementation Phases

1. PWA hardening
   - Confirm manifest/icons/start_url/display are valid.
   - Register service worker from React app.
2. Device registration + user toggles
   - Request notification permission.
   - Store FCM token and preferences in RTDB.
   - Add settings UI for on/off per notification type.
3. Event dispatch
   - Add sender service and dedupe by `eventId`.
   - Wire triggers for:
     - attendance threshold crossing
     - MVP lock event
4. Admin console
   - Add `/admin/notifications` page.
   - Allow admins to send custom message to all or selected topics.
5. Optional native packaging
   - Only if PWA constraints become a blocker.

## Timed Notification Rules

Timed rules live in:

- `frontend-nextjs/src/lib/notificationScheduleRules.ts`

Current rules:

- Monday 22:00 (Europe/Istanbul): "Yarın oynuyor musun?" + current coming count.
- Thursday 22:00 (Europe/Istanbul): "Yarın oynuyor musun?" + current coming count.
- Tuesday 21:30 (Europe/Istanbul): if coming count is odd, send "Tek kaldık".
- Friday 21:30 (Europe/Istanbul): if coming count is odd, send "Tek kaldık".

## How To Add New Notifications

### A) Timed notifications (cron-like)

1. Add a new rule in `frontend-nextjs/src/lib/notificationScheduleRules.ts`.
2. Set `id`, `dayOfWeek`, `hour`, `minute`, `title`, `body`, and optional `condition`.
3. If you introduce a new topic (not `timed_reminders`), also update:
   - `frontend-nextjs/src/lib/serverNotifications.ts` (`NOTIFICATION_TOPICS`)
   - `frontend-nextjs/src/app/notifications/page.tsx` (`TopicKey`, `TOPIC_META`, default toggles)

### B) Event-driven notifications (feature trigger)

1. Emit an event from the source flow (example files):
   - `frontend-nextjs/src/app/attendance/page.tsx` (teker dondu threshold)
   - `frontend-nextjs/src/components/GecenInMVPsiClient.tsx` (MVP lock)
   - `frontend-nextjs/src/lib/notificationScheduler.ts` (stats update and timed checks)
2. Use deterministic `eventId` format for dedupe (e.g. `topic:date` or `topic:timestamp`).
3. If it is a new topic, update:
   - `frontend-nextjs/src/lib/serverNotifications.ts`
   - `frontend-nextjs/src/app/notifications/page.tsx`
   - optional defaults in `frontend-nextjs/src/app/api/notifications/emit/route.ts`

### C) Admin custom messages

- Admin dispatch endpoint: `frontend-nextjs/src/app/api/admin/notifications/send/route.ts`
- UI sender form: `frontend-nextjs/src/app/notifications/page.tsx`
- AuthZ source: `admins/{uid}` in Firebase Realtime DB

## Scheduler Polling + Cost

- Scheduler starts in app runtime via `frontend-nextjs/src/app/layout.tsx` (`ensureNotificationSchedulerStarted`).
- Main loop interval is every 30 seconds (`SCHEDULER_INTERVAL_MS = 30_000`).
- Work per loop:
  - Timed rules: one RTDB read (`attendanceState`) to compute `comingCount`.
  - Stats update: at most once per 60 seconds (`STATS_CHECK_COOLDOWN_MS = 60_000`), one fetch to `/stats/incremental` through `BACKEND_INTERNAL_URL`.
- Duplicate sends are blocked by `notifications/events/{eventId}` transaction guard.
- If backend is unavailable or `BACKEND_INTERNAL_URL` is missing, stats check is skipped with warning logs; scheduler keeps running for other rules.

For your user size (20-30 people), this is lightweight and should not bottleneck GCP. Load is dominated by small RTDB reads and one small backend check per minute.

## Acceptance Criteria for MVP

- User can install app-like experience on Android and iOS.
- User can enable/disable each notification type.
- `teker_dondu_reached` sends once per event (no spam duplicates).
- `mvp_poll_locked` sends once per date lock.
- Admin can send one-off custom message.
- Existing stats pages and runtime regeneration behavior remain unchanged.
