"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

// Cookie name must match authSession.ts (can't import it here — it uses Node crypto)
const SESSION_COOKIE = "csbatagi_session";

export type SessionUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

interface SessionContextType {
  /** Basic user info decoded from the session cookie, or null if not logged in */
  user: SessionUser | null;
  /** True once the cookie has been read on the client */
  ready: boolean;
  /** Sign out: clears server session + Firebase auth state, then redirects to /login */
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
function decodeCookie(): SessionUser | null {
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
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now())
      return null;
    return {
      uid: payload.uid,
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

  // Re-read the cookie on mount AND on every client-side navigation so the UI
  // stays in sync with cookie changes (e.g. set after auto-login, cleared on logout).
  useEffect(() => {
    setUser(decodeCookie());
    setReady(true);
  }, [pathname]);

  const logout = useCallback(async () => {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => {});
    // Clear Firebase auth state if SDK was loaded in this session
    try {
      const { auth } = await import("@/lib/firebase");
      const { signOut } = await import("firebase/auth");
      await signOut(auth);
    } catch {}
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
