// src/components/SessionCleanup.tsx
// Component to handle session cleanup on auth changes
import { useEffect, useRef } from 'react';
import { useAppSelector } from '../store';
import { useSession } from '../hooks/useSession';
import { useAuth } from '../hooks/useAuth';

export const SessionCleanup: React.FC = () => {
  const { isAuthenticated, user, token } = useAppSelector(state => state.auth);
  const { logout } = useAuth();
  const { clearAllSessions } = useSession();

  // Safety Check: Detect corrupt auth state (Token exists but no user data)
  useEffect(() => {
    // If we have a token but no user data, and we are seemingly "authenticated",
    // this is a corrupt state. We should force a logout to clear the token and reset.
    // We add a small delay to allow for initial user fetching.
    let timeoutId: NodeJS.Timeout;

    if (token && !user) {
      console.log('⚠️ [SessionCleanup] Detected token without user data. Waiting for data load...');
      timeoutId = setTimeout(() => {
        // Double check state after delay
        if (!user) {
          console.error('❌ [SessionCleanup] Corrupt state detected (Token without User). Forcing logout...');
          logout();
          clearAllSessions();
        }
      }, 3000); // 3 seconds grace period for fetchUser to complete
    }

    return () => clearTimeout(timeoutId);
  }, [token, user, logout, clearAllSessions]);

  useEffect(() => {
    // Clear all sessions when user logs out
    if (!isAuthenticated) {
      clearAllSessions();
    }
  }, [isAuthenticated, clearAllSessions]);

  // Clear sessions when user changes (different user logs in)
  // Use a ref to track the previous user ID
  const prevUserIdRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (isAuthenticated && user) {
      // If this is a different user than before, clear sessions
      if (prevUserIdRef.current !== null && prevUserIdRef.current !== user.id) {
        console.log('Different user logged in, clearing previous user\'s session data');
        clearAllSessions();
      }
      prevUserIdRef.current = user.id;
    } else {
      prevUserIdRef.current = null;
    }
  }, [user?.id, isAuthenticated, clearAllSessions]);

  return null; // This component doesn't render anything
};
