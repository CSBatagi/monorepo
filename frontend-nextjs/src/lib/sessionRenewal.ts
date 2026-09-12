// Browser activity drives renewal; background polling and idle timers do not.
const LIFETIME_SECONDS = 30 * 24 * 60 * 60; // Must match authSession.ts (Node-only).
const RENEW_INTERVAL_MS = 30 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

export function createSessionRenewal(options: {
  readExpiry: () => number | null;
  isVisible: () => boolean;
  renew: () => Promise<number>;
  onRenewed: () => void;
  onRejected: () => void;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  let stopped = false;
  let pending: Promise<void> | null = null;
  let lastAttempt = -Infinity;

  function activity() {
    if (stopped || pending || !options.isVisible()) return;
    const time = now();
    const exp = options.readExpiry();
    if (exp === null || exp * 1000 <= time || exp * 1000 - time > LIFETIME_SECONDS * 1000 - RENEW_INTERVAL_MS || time - lastAttempt < RETRY_INTERVAL_MS) return;
    lastAttempt = time;
    pending = (async () => {
      try {
        const status = await options.renew();
        if (stopped) return;
        if (status === 200) options.onRenewed();
        else if (status === 401 || status === 403) {
          stopped = true;
          options.onRejected();
        }
      } catch { /* Retry on later activity; keep the valid cookie during outages. */ }
    })().finally(() => { pending = null; });
  }

  async function stop() {
    stopped = true;
    // Let any Set-Cookie finish before logout clears it, avoiding a response race.
    await pending;
  }

  return { activity, stop };
}
