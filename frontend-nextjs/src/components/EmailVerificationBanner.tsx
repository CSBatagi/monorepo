"use client";

import React from 'react';
import { useAuth } from '@/contexts/AuthContext';

const EmailVerificationBanner = () => {
  const { user, resendVerificationEmail, loading } = useAuth();
  
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
    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 w-full" role="alert">
      <div className="container mx-auto flex items-center justify-between">
        <div>
            <p className="font-bold">Verify your email</p>
            <p className="text-sm">Your email address has not been verified. Please check your inbox for the verification link.</p>
        </div>
        <button 
          onClick={handleResend}
          className="px-4 py-2 bg-yellow-500 text-white font-bold rounded hover:bg-yellow-600 transition-colors"
        >
          Resend Email
        </button>
      </div>
    </div>
  );
};

export default EmailVerificationBanner; 