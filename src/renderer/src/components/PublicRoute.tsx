import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';

interface PublicRouteProps {
  children: React.ReactNode;
}

export const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { isAuthenticated, user, loading, token } = useAuth();
  const [initializing, setInitializing] = useState(true);
  const [maxWaitReached, setMaxWaitReached] = useState(false);

  useEffect(() => {
    // Reset states when token changes
    setInitializing(true);
    setMaxWaitReached(false);

    // Maximum wait time: 5 seconds
    const maxWaitTimeout = setTimeout(() => {
      setMaxWaitReached(true);
      setInitializing(false);
    }, 5000);

    // If no token, don't wait
    if (!token) {
      setInitializing(false);
      setMaxWaitReached(false);
      clearTimeout(maxWaitTimeout);
      return;
    }

    // If we have a user, stop initializing
    if (user) {
      setInitializing(false);
      clearTimeout(maxWaitTimeout);
    }

    return () => clearTimeout(maxWaitTimeout);
  }, [token, user]); // Depend on both token and user

  // Show loader only if:
  // 1. Actively loading with a token AND haven't exceeded max wait, OR
  // 2. Initializing with token but no user yet AND haven't exceeded max wait
  const shouldShowLoader = token && !maxWaitReached && (
    (loading && !user) || 
    (initializing && !user)
  );

  if (shouldShowLoader) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    const redirectTo = '/candidate/dashboard';
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};