/**
 * Lazy-initialized Firebase Admin SDK for the backend.
 * Used by the notification scheduler for RTDB reads and FCM sends.
 *
 * Required env vars:
 *   FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON or FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64
 *   FIREBASE_DATABASE_URL  (or NEXT_PUBLIC_FIREBASE_DATABASE_URL)
 *   FIREBASE_PROJECT_ID    (or NEXT_PUBLIC_FIREBASE_PROJECT_ID)
 */

let adminApp = null;

function tryParseServiceAccount(raw) {
  if (!raw) return null;
  const candidates = [raw];
  try {
    candidates.push(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {}
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const sa = {
        projectId: parsed.projectId || parsed.project_id,
        clientEmail: parsed.clientEmail || parsed.client_email,
        privateKey: (parsed.privateKey || parsed.private_key || '').replace(/\\n/g, '\n'),
      };
      if (sa.projectId && sa.clientEmail && sa.privateKey) return sa;
    } catch {}
  }
  return null;
}

function getApp() {
  if (adminApp) return adminApp;

  const admin = require('firebase-admin');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const dbUrl = process.env.FIREBASE_DATABASE_URL || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  const sa = tryParseServiceAccount(
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64
  );

  const options = {};
  if (projectId) options.projectId = projectId;
  if (dbUrl) options.databaseURL = dbUrl;
  if (sa) {
    options.credential = admin.credential.cert(sa);
  } else {
    options.credential = admin.credential.applicationDefault();
  }

  adminApp = admin.initializeApp(options, 'backend-admin');
  return adminApp;
}

function adminDb() {
  const admin = require('firebase-admin');
  return admin.database(getApp());
}

function adminMessaging() {
  const admin = require('firebase-admin');
  return admin.messaging(getApp());
}

module.exports = { getApp, adminDb, adminMessaging };
