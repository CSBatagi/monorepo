"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { createSessionRenewal } from "@/lib/sessionRenewal";

// Cookie name must match authSession.ts (can't import it here — it uses Node crypto)
const SESSION_COOKIE = "csbatagi_session";

export type SessionUser = {
  uid: string;
  steamId: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

interface SessionContextType {
  /** Basic user info decoded from the session cookie, or null if not logged in */
  user: SessionUser | null;
  /** True once the cookie has been read on the client */
  ready: boolean;
  /** Sign out: clears server session, then redirects to /login */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType>({
  user: null,
  ready: false,
  logout: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

/** Decode the HMAC session cookie payload (no verification — middleware already checked the signature). */
function decodeCookie(): (SessionUser & { exp: number }) | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.split("=").slice(1).join("=");
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → standard base64 for atob
    const payload = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)))
    );
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now() || payload.provider !== 'steam' || !/^7656119\d{10}$/.test(payload.steamId))
      return null;
    return {
      exp: payload.exp,
      uid: payload.uid,
      steamId: payload.steamId,
      email: payload.email || null,
      name: payload.name || null,
      picture: payload.picture || null,
    };
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Start null to match SSR (document not available) — avoids hydration mismatch
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const renewal = useRef<ReturnType<typeof createSessionRenewal> | null>(null);

  useEffect(() => {
    const controller = createSessionRenewal({
      readExpiry: () => decodeCookie()?.exp ?? null,
      isVisible: () => document.visibilityState === 'visible',
      renew: async () => (await fetch('/api/session/refresh', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000) })).status,
      onRenewed: () => setUser(decodeCookie()),
      onRejected: () => {
        document.cookie = `${SESSION_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
        setUser(null);
        window.location.href = '/login';
      },
    });
    renewal.current = controller;
    const activity = () => controller.activity();
    const focus = () => { setUser(decodeCookie()); activity(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    for (const event of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(event, activity, { passive: true, capture: true });
    return () => {
      void controller.stop();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      for (const event of ['pointerdown', 'keydown', 'scroll']) document.removeEventListener(event, activity, true);
    };
  }, []);

  // Re-read the cookie on mount AND on every client-side navigation so the UI
  // stays in sync with cookie changes (e.g. set after auto-login, cleared on logout).
  useEffect(() => {
    setUser(decodeCookie());
    setReady(true);
    renewal.current?.activity();
  }, [pathname]);

  const logout = useCallback(async () => {
    await renewal.current?.stop();
    await fetch("/api/session/logout", { method: "POST" }).catch(() => {});
    document.cookie = `${SESSION_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    setUser(null);
    window.location.href = "/login";
  }, []);

  const value = useMemo(
    () => ({ user, ready, logout }),
    [user, ready, logout]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
