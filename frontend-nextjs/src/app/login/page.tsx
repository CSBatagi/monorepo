"use client";

import React, { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

function LoginPageInner() {
  const { user, loading, emailSignIn, emailSignUp, signInWithGoogle } = useAuth();
  const { isDark } = useTheme();
  const params = useSearchParams();
  const router = useRouter();
  const nextParam = params.get("next") || "/";
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [signupEmail, setSignupEmail] = React.useState("");
  const [signupPassword, setSignupPassword] = React.useState("");

  useEffect(() => {
    let cancelled = false;

    async function finalizeLogin() {
      if (loading || !user) return;
      try {
        const idToken = await user.getIdToken();
        await fetch('/api/session/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
      } catch {}
      if (!cancelled) {
        router.replace(nextParam);
      }
    }

    void finalizeLogin();
    return () => {
      cancelled = true;
    };
  }, [user, loading, router, nextParam]);

  const handleEmailAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const form = e.currentTarget;
      const email = (form.elements.namedItem("email") as HTMLInputElement).value;
      const password = (form.elements.namedItem("password") as HTMLInputElement).value;
      await emailSignIn(email, password);
    } catch (err: any) {
      setError(err.message || "Email veya şifre hatalı");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await emailSignUp(signupEmail, signupPassword);
      alert("Kayıt başarılı! Lütfen email adresinizi doğrulayın.");
    } catch (err: any) {
      setError(err.message || "Kayıt başarısız");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Google ile giriş başarısız");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-6 ${isDark ? 'bg-dark-bg' : 'bg-gray-50'}`}>
      <div className={`w-full max-w-md rounded-xl shadow-md p-6 ${isDark ? 'bg-dark-surface border border-dark-border' : 'bg-white'}`}>
        <h1 className={`text-2xl font-semibold text-center mb-4 ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>CS Batağı – Giriş</h1>
        <p className={`text-center text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Giriş yapınca tüm sayfalara erişebileceksiniz.</p>

        <button
          onClick={handleGoogle}
          disabled={isSubmitting}
          className={`w-full mb-4 flex items-center justify-center gap-2 border rounded-md py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark ? 'border-dark-border hover:bg-dark-card text-gray-200' : 'border-gray-300 hover:bg-gray-100'
          }`}
        >
          <span className="text-xl">🔐</span>
          <span>Google ile Giriş Yap</span>
        </button>

        {error && (
          <div className={`mb-4 p-3 rounded-md text-sm ${isDark ? 'bg-red-900/30 border border-red-800/50 text-red-300' : 'bg-red-100 border border-red-400 text-red-700'}`}>
            {error}
          </div>
        )}

        <div className="relative flex items-center justify-center my-4">
          <span className={`absolute left-0 right-0 border-t ${isDark ? 'border-dark-border' : ''}`} />
          <span className={`relative px-3 text-xs ${isDark ? 'bg-dark-surface text-gray-500' : 'bg-white text-gray-500'}`}>veya</span>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-3">
          <div>
            <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Email</label>
            <input name="email" type="email" required disabled={isSubmitting} className={`mt-1 w-full border rounded-md px-3 py-2 disabled:opacity-50 ${
              isDark ? 'bg-dark-card border-dark-border text-gray-100' : 'text-black'
            }`} />
          </div>
          <div>
            <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Şifre</label>
            <input name="password" type="password" required disabled={isSubmitting} className={`mt-1 w-full border rounded-md px-3 py-2 disabled:opacity-50 ${
              isDark ? 'bg-dark-card border-dark-border text-gray-100' : 'text-black'
            }`} />
          </div>
          <button type="submit" disabled={isSubmitting} className={`w-full py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark ? 'bg-blue-600/80 hover:bg-blue-500 text-white border border-blue-500/30' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
            {isSubmitting ? "Giriş yapılıyor..." : "Email ile Giriş"}
          </button>
        </form>

        <div className={`my-4 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Hesabınız yok mu?</div>

        <form onSubmit={handleSignUp} className="space-y-3">
          <div>
            <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Email</label>
            <input 
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              type="email" 
              required 
              disabled={isSubmitting}
              className={`mt-1 w-full border rounded-md px-3 py-2 disabled:opacity-50 ${
                isDark ? 'bg-dark-card border-dark-border text-gray-100' : 'text-black'
              }`}
            />
          </div>
          <div>
            <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Şifre (en az 6 karakter)</label>
            <input 
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              type="password" 
              required 
              minLength={6}
              disabled={isSubmitting}
              className={`mt-1 w-full border rounded-md px-3 py-2 disabled:opacity-50 ${
                isDark ? 'bg-dark-card border-dark-border text-gray-100' : 'text-black'
              }`}
            />
          </div>
          <button type="submit" disabled={isSubmitting} className={`w-full py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark ? 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600/50' : 'bg-gray-800 text-white hover:bg-gray-900'
          }`}>
            {isSubmitting ? "Kayıt olunuyor..." : "Email ile Kayıt Ol"}
          </button>
        </form>

        <p className={`text-xs text-center mt-4 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Girişten sonra yönlendirileceğiniz yer: {nextParam}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6">Yukleniyor...</div>}>
      <LoginPageInner />
    </Suspense>
  );
}
