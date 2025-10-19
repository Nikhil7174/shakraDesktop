// src/components/SessionCleanup.tsx
// Component to handle session cleanup on auth changes
import { useEffect, useRef } from 'react';
import { useAppSelector } from '../store';
import { useSession } from '../hooks/useSession';

export const SessionCleanup: React.FC = () => {
  const { isAuthenticated, user } = useAppSelector(state => state.auth);
  const { clearAllSessions } = useSession();

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
