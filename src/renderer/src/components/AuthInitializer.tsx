import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';

export const AuthInitializer: React.FC = () => {
  const { token, getCurrentUser } = useAuth();
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Only initialize once on mount if there's a token
    if (token && !hasInitialized.current) {
      hasInitialized.current = true;
      getCurrentUser();
    } else if (!token) {
      // Reset flag when token is cleared
      hasInitialized.current = false;
    }
  }, [token]); // Only depend on token, not getCurrentUser

  return null; // This component doesn't render anything
};

