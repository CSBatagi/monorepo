"use client";

import React, { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const { user, loading, emailSignIn, emailSignUp, signInWithGoogle } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const nextParam = params.get("next") || "/";
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [signupEmail, setSignupEmail] = React.useState("");
  const [signupPassword, setSignupPassword] = React.useState("");

  useEffect(() => {
    if (!loading && user) {
      router.replace(nextParam);
    }
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6">
        <h1 className="text-2xl font-semibold text-center text-gray-800 mb-4">CS Batağı – Giriş</h1>
        <p className="text-center text-sm text-gray-600 mb-6">Giriş yapınca tüm sayfalara erişebileceksiniz.</p>

        <button
          onClick={handleGoogle}
          disabled={isSubmitting}
          className="w-full mb-4 flex items-center justify-center gap-2 border border-gray-300 rounded-md py-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-xl">🔐</span>
          <span>Google ile Giriş Yap</span>
        </button>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="relative flex items-center justify-center my-4">
          <span className="absolute left-0 right-0 border-t" />
          <span className="relative bg-white px-3 text-xs text-gray-500">veya</span>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700">Email</label>
            <input name="email" type="email" required disabled={isSubmitting} className="mt-1 w-full border rounded-md px-3 py-2 text-black disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-sm text-gray-700">Şifre</label>
            <input name="password" type="password" required disabled={isSubmitting} className="mt-1 w-full border rounded-md px-3 py-2 text-black disabled:opacity-50" />
          </div>
          <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? "Giriş yapılıyor..." : "Email ile Giriş"}
          </button>
        </form>

        <div className="my-4 text-center text-sm text-gray-500">Hesabınız yok mu?</div>

        <form onSubmit={handleSignUp} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700">Email</label>
            <input 
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              type="email" 
              required 
              disabled={isSubmitting}
              className="mt-1 w-full border rounded-md px-3 py-2 text-black disabled:opacity-50" 
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700">Şifre (en az 6 karakter)</label>
            <input 
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              type="password" 
              required 
              minLength={6}
              disabled={isSubmitting}
              className="mt-1 w-full border rounded-md px-3 py-2 text-black disabled:opacity-50" 
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="w-full bg-gray-800 text-white py-2 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? "Kayıt olunuyor..." : "Email ile Kayıt Ol"}
          </button>
        </form>

        <p className="text-xs text-center text-gray-500 mt-4">Girişten sonra yönlendirileceğiniz yer: {nextParam}</p>
      </div>
    </div>
  );
}
