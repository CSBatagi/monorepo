const admin = require('firebase-admin');
const path = require('path');

function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    return null;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (serviceAccountPath) {
    const resolvedPath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(__dirname, serviceAccountPath);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const serviceAccount = require(resolvedPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });

    return admin.app();
  }

  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!adcPath) {
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL
  });

  return admin.app();
}

function getDb() {
  const app = initFirebaseAdmin();
  if (!app) return null;
  return admin.database();
}

async function verifyIdToken(idToken) {
  const app = initFirebaseAdmin();
  if (!app) {
    throw new Error('Firebase Admin not initialized (missing FIREBASE_DATABASE_URL and credentials)');
  }
  return admin.auth().verifyIdToken(idToken);
}

module.exports = {
  initFirebaseAdmin,
  getDb,
  verifyIdToken
};
