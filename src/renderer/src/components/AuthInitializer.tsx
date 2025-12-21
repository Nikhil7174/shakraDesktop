import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';

export const AuthInitializer: React.FC = () => {
  const { token, getCurrentUser } = useAuth();
  const hasInitialized = useRef(false);
  const tokenSent = useRef(false);

  useEffect(() => {
    // Only initialize once on mount if there's a token
    if (token && !hasInitialized.current) {
      hasInitialized.current = true;
      getCurrentUser();
    } else if (!token) {
      // Reset flag when token is cleared
      hasInitialized.current = false;
      tokenSent.current = false;
    }
  }, [token]); // Only depend on token, not getCurrentUser

  // Send token to main process on startup (if user is already logged in)
  useEffect(() => {
    if (token && !tokenSent.current && window.electronAPI?.setAuthToken) {
      tokenSent.current = true;
      window.electronAPI.setAuthToken(token).catch(err => {
        console.warn('⚠️ [Auth] Failed to set auth token on startup:', err);
        tokenSent.current = false; // Allow retry
      });
    } else if (!token && window.electronAPI?.setAuthToken) {
      // Clear token on logout
      window.electronAPI.setAuthToken(null).catch(() => {});
      tokenSent.current = false;
    }
  }, [token]);

  return null; // This component doesn't render anything
};

