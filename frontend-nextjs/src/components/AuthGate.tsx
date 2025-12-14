"use client";

import React, { useEffect, Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface AuthGateProps {
  children: React.ReactNode;
}

function AuthGateInner({ children }: AuthGateProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Allow unauthenticated access to the dedicated login page
      if (pathname === "/login") return;
      const currentPath = pathname + (typeof window !== 'undefined' ? window.location.search : "");
      const nextParam = encodeURIComponent(currentPath || "/");
      router.replace(`/login?next=${nextParam}`);
      return;
    }
    // If user is logged in and on /login, send to home or desired next
    if (pathname === "/login") {
      const next = params.get("next");
      // Only redirect if there's a next param and it's not /login itself
      if (next && next !== "/login" && !next.includes("%2Flogin")) {
        router.replace(decodeURIComponent(next));
      } else if (!next || next === "/login") {
        router.replace("/");
      }
    }
  }, [user, loading, router, params, pathname]);

  // While loading, show a minimal loader
  if (loading) {
    return <div className="text-center py-10">Loading authentication…</div>;
  }

  // Allow the login page to render even when unauthenticated
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Block all other pages if not authenticated (AuthGate will redirect)
  if (!user) {
    return <div className="text-center py-10">Redirecting to login…</div>;
  }

  return <>{children}</>;
}

// Wrap with Suspense to handle useSearchParams during SSR
export default function AuthGate({ children }: AuthGateProps) {
  return (
    <Suspense fallback={<div className="text-center py-10">Loading...</div>}>
      <AuthGateInner>{children}</AuthGateInner>
    </Suspense>
  );
}
