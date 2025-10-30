import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export const AuthInitializer: React.FC = () => {
  const { token, getCurrentUser } = useAuth();

  useEffect(() => {
    // If there's a token, validate it by calling getCurrentUser
    if (token) {
      getCurrentUser();
    }
  }, [token, getCurrentUser]);

  return null; // This component doesn't render anything
};

