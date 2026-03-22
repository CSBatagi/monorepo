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
- Live social/game-night state: PostgreSQL (attendance, MVP voting, team picker, admins) via short polling.

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

### Realtime Features (all migrated to PostgreSQL)

- Attendance page writes/reads via `/live/attendance` (PostgreSQL polling).
- MVP page writes/reads via `/live/mvp-votes` (PostgreSQL polling).
- Admin gate via `/live/admin/check` (PostgreSQL `admins` table).

## Notification System Status

Push notifications are fully implemented using **standard Web Push (VAPID)**:
- Service worker: `public/push-sw.js`
- Device registration: Push API `pushManager.subscribe()` with VAPID key
- Token storage: PostgreSQL `notification_subscriptions` table
- Backend dispatch: `web-push` npm package
- Preferences: PostgreSQL `notification_preferences` table
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

### PostgreSQL Tables

Notification data is stored in PostgreSQL:

- `notification_subscriptions` — device push subscriptions (PushSubscription JSON)
- `notification_preferences` — per-user topic toggles
- `notification_events` — idempotency log for deduplication
- `notification_inbox` — in-app notification messages

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

- Keep VAPID keys and OAuth credentials in secret env files only (do not hardcode in source).
- Require admin checks for custom message dispatch (reuse `admins` PG table).
- Add idempotency checks (`notifications/events/{eventId}`) before sending push.
- Add basic delivery logging (success/failure counts) for debugging.

## Implementation Phases

1. PWA hardening
   - Confirm manifest/icons/start_url/display are valid.
   - Register service worker from React app.
2. Device registration + user toggles
   - Request notification permission.
   - Store PushSubscription and preferences in PostgreSQL.
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

- `backend/notificationScheduler.js` (the `TIMED_NOTIFICATION_RULES` array)

Current rules:

- Monday 22:00 (Europe/Istanbul): "Yarın oynuyor musun?" + current coming count.
- Thursday 22:00 (Europe/Istanbul): "Yarın oynuyor musun?" + current coming count.
- Tuesday 21:30 (Europe/Istanbul): if coming count is odd, send "Tek kaldık".
- Friday 21:30 (Europe/Istanbul): if coming count is odd, send "Tek kaldık".

## How To Add New Notifications

### A) Timed notifications (cron-like)

1. Add a new rule in `backend/notificationScheduler.js` (the `TIMED_NOTIFICATION_RULES` array).
2. Set `id`, `dayOfWeek`, `hour`, `minute`, `title`, `body`, and optional `condition`.
3. If you introduce a new topic (not `timed_reminders`), also update:
   - `frontend-nextjs/src/lib/serverNotifications.ts` (`NOTIFICATION_TOPICS`)
   - `frontend-nextjs/src/app/notifications/page.tsx` (`TopicKey`, `TOPIC_META`, default toggles)

### B) Event-driven notifications (feature trigger)

1. Emit an event from the source flow (example files):
   - `frontend-nextjs/src/app/attendance/AttendanceClient.tsx` (teker dondu threshold)
   - `frontend-nextjs/src/components/GecenInMVPsiClient.tsx` (MVP lock)
   - `backend/notificationScheduler.js` (stats update and timed checks)
2. Use deterministic `eventId` format for dedupe (e.g. `topic:date` or `topic:timestamp`).
3. If it is a new topic, update:
   - `frontend-nextjs/src/lib/serverNotifications.ts`
   - `frontend-nextjs/src/app/notifications/page.tsx`
   - optional defaults in `frontend-nextjs/src/app/api/notifications/emit/route.ts`

### C) Admin custom messages

- Admin dispatch endpoint: `frontend-nextjs/src/app/api/admin/notifications/send/route.ts`
- UI sender form: `frontend-nextjs/src/app/notifications/page.tsx`
- AuthZ source: `admins` table in PostgreSQL, checked via `/api/live/admin/check`

## Scheduler Polling + Cost

- Scheduler runs in the **backend** Express process (`backend/notificationScheduler.js`), NOT in Next.js.
- Started after the Express server is listening; uses the backend's in-memory cached DB timestamp for stats-update checks (zero HTTP cost).
- Main loop interval is every 60 seconds (`SCHEDULER_INTERVAL_MS = 60_000`).
- Work per loop:
  - Timed rules: reads attendance count from PostgreSQL.
  - Stats update: compares the cached DB timestamp (updated by the backend's 60s poller) — no network call needed.
- Duplicate sends are blocked by `notification_events` table in PostgreSQL.
- Push delivery uses `web-push` (VAPID) — lightweight, no Firebase SDK needed.
- Can be disabled via `ENABLE_NOTIFICATION_SCHEDULER=false` env var on the backend.
- Requires VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) in the backend environment. These are shared from `.frontend_secrets` via docker-compose.

For your user size (20-30 people), this is lightweight and should not bottleneck GCP. Load is dominated by small PostgreSQL reads and in-memory timestamp comparisons.

## Acceptance Criteria for MVP

- User can install app-like experience on Android and iOS.
- User can enable/disable each notification type.
- `teker_dondu_reached` sends once per event (no spam duplicates).
- `mvp_poll_locked` sends once per date lock.
- Admin can send one-off custom message.
- Existing stats pages and runtime regeneration behavior remain unchanged.
