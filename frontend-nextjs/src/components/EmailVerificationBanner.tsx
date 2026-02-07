"use client";

import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

const EmailVerificationBanner = () => {
  const { user, resendVerificationEmail, loading } = useAuth();
  const { isDark } = useTheme();
  
  if (loading || !user || user.emailVerified) {
    return null;
  }

  const handleResend = async () => {
    try {
      await resendVerificationEmail();
    } catch (error) {
      console.error("Error resending verification email:", error);
      alert("Failed to send verification email. Please try again.");
    }
  };

  return (
    <div className={`border-l-4 p-4 w-full ${isDark ? 'bg-yellow-900/20 border-yellow-500/50 text-yellow-300' : 'bg-yellow-100 border-yellow-500 text-yellow-700'}`} role="alert">
      <div className="container mx-auto flex items-center justify-between">
        <div>
            <p className="font-bold">Verify your email</p>
            <p className="text-sm">Your email address has not been verified. Please check your inbox for the verification link.</p>
        </div>
        <button 
          onClick={handleResend}
          className={`px-4 py-2 font-bold rounded transition-colors ${isDark ? 'bg-yellow-600 text-white hover:bg-yellow-500' : 'bg-yellow-500 text-white hover:bg-yellow-600'}`}
        >
          Resend Email
        </button>
      </div>
    </div>
  );
};

export default EmailVerificationBanner; 