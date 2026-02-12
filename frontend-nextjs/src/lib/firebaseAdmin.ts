import "server-only";

import {
  App,
  AppOptions,
  cert,
  deleteApp,
  getApp,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import type { ServiceAccount } from "firebase-admin";

declare global {
  // eslint-disable-next-line no-var
  var __firebaseAdminApp: App | undefined;
}

const ADMIN_APP_NAME = "csbatagi-admin";

function tryParseServiceAccount(raw?: string): ServiceAccount | null {
  if (!raw) return null;
  const candidates = [raw];

  try {
    candidates.push(Buffer.from(raw, "base64").toString("utf-8"));
  } catch {
    // ignore base64 parsing errors
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as
        | ServiceAccount
        | {
            project_id?: string;
            client_email?: string;
            private_key?: string;
          };

      const normalized: ServiceAccount = {
        projectId: (parsed as any).projectId || (parsed as any).project_id,
        clientEmail: (parsed as any).clientEmail || (parsed as any).client_email,
        privateKey: ((parsed as any).privateKey || (parsed as any).private_key || "").replace(
          /\\n/g,
          "\n"
        ),
      };

      if (normalized.projectId && normalized.clientEmail && normalized.privateKey) {
        return normalized;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

function buildAdminApp(): App {
  const expectedProjectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

  // If our named app already exists, reuse it.
  const existingNamed = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existingNamed) {
    return getApp(ADMIN_APP_NAME);
  }

  const dbUrl =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    process.env.FIREBASE_DATABASE_URL;

  const serviceAccount = tryParseServiceAccount(
    process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64
  );

  if (
    serviceAccount?.projectId &&
    expectedProjectId &&
    serviceAccount.projectId !== expectedProjectId
  ) {
    throw new Error(
      `Firebase Admin service account project mismatch: expected ${expectedProjectId}, got ${serviceAccount.projectId}`
    );
  }

  const options: AppOptions = {
    ...(expectedProjectId ? { projectId: expectedProjectId } : {}),
    ...(dbUrl ? { databaseURL: dbUrl } : {}),
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
  };

  return initializeApp(options, ADMIN_APP_NAME);
}

export function getFirebaseAdminApp(): App {
  const expectedProjectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

  if (global.__firebaseAdminApp) {
    const currentProject = global.__firebaseAdminApp.options.projectId;
    if (expectedProjectId && currentProject && currentProject !== expectedProjectId) {
      try {
        void deleteApp(global.__firebaseAdminApp);
      } catch {
        // best effort cleanup
      }
      global.__firebaseAdminApp = undefined;
    }
  }

  if (!global.__firebaseAdminApp) {
    global.__firebaseAdminApp = buildAdminApp();
  }
  return global.__firebaseAdminApp;
}

export function adminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function adminDb() {
  return getDatabase(getFirebaseAdminApp());
}

export function adminMessaging() {
  return getMessaging(getFirebaseAdminApp());
}
