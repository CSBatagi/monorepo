# Push Notifications Setup Guide

This document explains how to set up and configure Web Push notifications for CS Batağı.

## Overview

The push notification system uses **Web Push (VAPID)** instead of Firebase Cloud Messaging (FCM). This approach works on:
- ✅ Android Chrome/Edge/Firefox (normal browser or PWA)
- ✅ Desktop Chrome/Edge/Firefox
- ✅ **iOS Safari 16.4+** when installed as PWA (Add to Home Screen)

**Important for iOS users:** Push notifications only work after adding the app to the home screen via Safari's "Share → Add to Home Screen" option.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Frontend      │      │    Backend      │      │  Firebase RTDB  │
│   (Next.js)     │──────│   (Express)     │──────│  (Subscriptions │
│                 │      │                 │      │   + Dedupe)     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        │                        │
        │ Subscribe              │ Send via web-push
        │ (Push API)             │ (VAPID)
        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Push Services                                 │
│   (Google FCM for Chrome, Mozilla for Firefox, Apple for Safari)    │
└─────────────────────────────────────────────────────────────────────┘
```

## Setup Steps

### 1. Generate VAPID Keys (one-time)

```bash
cd backend
npx web-push generate-vapid-keys --json
```

This outputs a public/private key pair. **Save these securely** - you only generate once.

### 2. Configure Backend Environment Variables

Add to your backend `.env` file:

```env
# VAPID Keys (from step 1)
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_SUBJECT=mailto:your-email@example.com

# Firebase Admin SDK
FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/serviceAccountKey.json

# Optional: allowlist Firebase Auth UIDs that can trigger admin-only in-app notifications
# (e.g. /push/trigger/teker-dondu)
PUSH_ADMIN_UIDS=uid1,uid2
```

### 3. Configure Frontend Environment Variables

Add to your frontend `.env.local`:

```env
NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com
```

#### Production note (csbatagi.com + Caddy reverse proxy)

In production, [Caddyfile](Caddyfile) routes backend traffic under `/backend/*`:

```
csbatagi.com {
  handle_path /backend/* {
    reverse_proxy backend:3000
  }
  handle {
    reverse_proxy frontend-nextjs:3000
  }
}
```

So the frontend must call the backend using the `/backend` prefix. Recommended:

```env
NEXT_PUBLIC_BACKEND_URL=/backend
```

That makes frontend calls like `/backend/push/subscribe`, which Caddy forwards to backend `/push/subscribe`.

### 4. Firebase Service Account

1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save the JSON file and set `FIREBASE_SERVICE_ACCOUNT_PATH` to its path

### 5. Deploy

Restart your backend and frontend after configuration changes.

## Production Deployment (GCP VM + GitHub Actions)

This repo deploys to a GCP VM using GitHub Actions and [docker-compose.yml](docker-compose.yml) (see [.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

Push notifications require additional backend secrets (VAPID + Firebase Admin) and one additional frontend env var (`NEXT_PUBLIC_BACKEND_URL`).

### A) GitHub Actions secrets to add

Add these secrets in GitHub → Repository → Settings → Secrets and variables → Actions:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `FIREBASE_DATABASE_URL`
- `PUSH_ADMIN_UIDS` (comma-separated Firebase Auth UIDs allowed to call `/push/trigger/teker-dondu`)

Firebase Admin credentials (choose one):

- Recommended: `FIREBASE_SERVICE_ACCOUNT_JSON` (the full JSON contents of the Firebase service account key)

### B) Files on the VM (created during deploy)

The deployment workflow currently generates secret env files like `~/.backend_secrets` and `~/.frontend_secrets` on the runner, then copies them to the VM.

For push to work, the VM needs:

1. `~/.backend_secrets` to include:
  - `VAPID_PUBLIC_KEY=...`
  - `VAPID_PRIVATE_KEY=...`
  - `VAPID_SUBJECT=...`
  - `FIREBASE_DATABASE_URL=...`
  - `FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json`
  - `PUSH_ADMIN_UIDS=uid1,uid2`

2. A Firebase Admin service account JSON file, mounted into the backend container as:
  - Host path: `~/firebase-service-account.json`
  - Container path: `/app/secrets/firebase-service-account.json`

Permissions recommendation:
- `chmod 600 ~/.backend_secrets ~/firebase-service-account.json`

### C) docker-compose.yml change (required)

The backend container must be able to read the Firebase service account JSON.

Add this volume mount under the `backend` service in [docker-compose.yml](docker-compose.yml):

```yaml
  backend:
   volumes:
    - ./firebase-service-account.json:/app/secrets/firebase-service-account.json:ro
```

Then set `FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json` in `~/.backend_secrets` (see section B).

### D) Frontend env in production

Ensure `~/.frontend_secrets` includes:

```env
NEXT_PUBLIC_BACKEND_URL=/backend
```

Without this, the frontend will try to call `/push/*` directly, but production routes backend under `/backend/*`.

### E) Quick production smoke checks

After deploy, verify:

- `https://csbatagi.com/backend/push/vapid-public-key` returns `{ "publicKey": "..." }`
- Subscribing from the UI succeeds (backend can verify Firebase ID tokens + write to RTDB)


## Notification Types

| Type | Trigger | Who Receives | Dedupe Key |
|------|---------|--------------|------------|
| Match Day Reminder | Daily scheduler (e.g., 10:00) | Users who haven't declared status | `matchday:{date}` |
| New Stats | After stats generation | All opted-in users | `stats:{timestamp}` |
| Awards/MVP | When award is published | All opted-in users | `award:{type}:{period}` |
| Teker Döndü | When 10th person marks "coming" | All opted-in users | `teker:{matchId}` |

## Firebase Realtime Database Schema

```
/pushSubscriptions
  /{uid}
    /{deviceId}
      endpoint: string
      keys: { p256dh: string, auth: string }
      userAgent: string
      platform: string
      createdAt: number
      updatedAt: number

/notificationPrefs
  /{uid}
    matchDay: boolean
    stats: boolean
    awards: boolean
    tekerDondu: boolean
    updatedAt: number

/notificationLog
  /{eventId}
    sentAt: number
    recipientCount: number
    payload: { title: string, body: string }
```

## API Endpoints

### Public
- `GET /push/vapid-public-key` - Get VAPID public key

### Authenticated (Firebase ID Token)
- `POST /push/subscribe` - Subscribe device to notifications
- `POST /push/unsubscribe` - Unsubscribe device
- `GET /push/preferences` - Get notification preferences
- `POST /push/preferences` - Update preferences

### Admin (Firebase ID Token + UID allowlist)
- `POST /push/trigger/teker-dondu` - Trigger the “Teker Döndü” notification (requires `PUSH_ADMIN_UIDS`)

### Admin (AUTH_TOKEN)
- `POST /push/send` - Trigger a notification manually

## Testing

### Send a test notification via API:

```bash
curl -X POST https://your-backend/push/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "type": "custom",
    "eventId": "test:123",
    "payload": {
      "title": "Test Notification",
      "body": "This is a test push notification!",
      "url": "/attendance"
    }
  }'
```

## Troubleshooting

### iOS users not receiving notifications
1. Ensure they're using iOS 16.4 or later
2. Must install via Safari "Add to Home Screen"
3. Must grant notification permission when prompted inside the PWA

### Notifications not arriving
1. Check backend logs for send errors
2. Verify VAPID keys are correctly configured
3. Check if subscription endpoint is still valid (410 Gone = expired)

### Service worker issues
1. Check browser DevTools → Application → Service Workers
2. Ensure `sw.js` is registered at root scope
3. Clear old service workers if switching from FCM

## Match Day Reminder Scheduler

For automatic daily reminders, add a cron job or scheduled task that calls:

```bash
# Example: Run at 10:00 AM on match days
curl -X POST https://your-backend/push/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "type": "custom",
    "eventId": "matchday:'$(date +%Y-%m-%d)'",
    "payload": {
      "title": "⚽ Bugün Maç Var!",
      "body": "Katılım durumunu bildirmeyi unutma!",
      "url": "/attendance"
    }
  }'
```

Or implement a scheduler in the backend using `node-cron` or similar.
