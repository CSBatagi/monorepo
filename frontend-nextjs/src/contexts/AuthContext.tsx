'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged, getRedirectResult, AuthError, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Assuming your firebase.ts is in lib

interface AuthContextType {
  user: User | null;
  loading: boolean;
  emailSignUp: (email: string, pass: string) => Promise<any>;
  emailSignIn: (email: string, pass: string) => Promise<any>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
      alert('Verification email sent! Please check your inbox.');
    } else {
      throw new Error("No user is currently signed in to resend verification email.");
    }
  };

  useEffect(() => {
    // Check for redirect result first
    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          // This gives you a Google Access Token. You can use it to access Google APIs.
          // const credential = GoogleAuthProvider.credentialFromResult(result);
          // const token = credential?.accessToken;
          // The signed-in user info.
          // const signedInUser = result.user;
          console.log('[AuthContext] Redirect result processed:', result.user?.displayName);
          // setUser(result.user); // onAuthStateChanged will also fire, so this might be redundant but can be useful
        } else {
          console.log('[AuthContext] No redirect result found on initial load.');
        }
      })
      .catch((error: AuthError) => {
        console.error('[AuthContext] Error processing redirect result:', error);
        // Handle specific errors here, e.g., error.code, error.message
      })
      .finally(() => {
        // Now set up the onAuthStateChanged listener
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
          setUser(currentUser);
          setLoading(false);
          console.log('[AuthContext] Auth state changed via onAuthStateChanged:', currentUser?.displayName);
        });
        // Cleanup subscription on unmount
        return () => unsubscribe();
      });
  }, []);

  const value = {
    user,
    loading,
    emailSignUp,
    emailSignIn,
    resendVerificationEmail,
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