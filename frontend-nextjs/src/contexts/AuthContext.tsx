'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onIdTokenChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Assuming your firebase.ts is in lib

interface AuthContextType {
  user: User | null;
  loading: boolean;
  emailSignUp: (email: string, pass: string) => Promise<any>;
  emailSignIn: (email: string, pass: string) => Promise<any>;
  resendVerificationEmail: () => Promise<void>;
  signInWithGoogle: () => Promise<any>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function syncServerSession(currentUser: User | null) {
  if (!currentUser) {
    await fetch('/api/session/logout', { method: 'POST' }).catch(() => {});
    return;
  }

  const idToken = await currentUser.getIdToken();
  await fetch('/api/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const emailSignUp = async (email: string, pass: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    if (userCredential.user) {
      await sendEmailVerification(userCredential.user);
      // You can also add actionCodeSettings here if needed
    }
    return userCredential;
  };
  
  const emailSignIn = (email: string, pass: string) => {
    return signInWithEmailAndPassword(auth, email, pass);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await Promise.allSettled([
      fetch('/api/session/logout', { method: 'POST' }),
      signOut(auth),
    ]);
  };

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
      alert('Verification email sent! Please check your inbox.');
    } else {
      throw new Error("No user is currently signed in to resend verification email.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    // onIdTokenChanged fires from cached auth state and again when Firebase refreshes the token.
    const unsubscribe = onIdTokenChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (!cancelled) {
        await syncServerSession(currentUser);
      }
    });
    if (auth.currentUser) {
      setUser(auth.currentUser);
      setLoading(false);
    }
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const value = {
    user,
    loading,
    emailSignUp,
    emailSignIn,
    resendVerificationEmail,
    signInWithGoogle,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 