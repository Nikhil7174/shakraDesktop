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
    console.log('🔍 [PublicRoute] Auth state:', { isAuthenticated, hasUser: !!user, hasToken: !!token, loading });
    
    // Reset states when token changes
    setInitializing(true);
    setMaxWaitReached(false);

    // Maximum wait time: 3 seconds (reduced from 5 for faster UX)
    const maxWaitTimeout = setTimeout(() => {
      console.log('⏰ [PublicRoute] Max wait reached, showing login page');
      setMaxWaitReached(true);
      setInitializing(false);
    }, 3000);

    // If no token, don't wait - show login immediately
    if (!token) {
      console.log('✅ [PublicRoute] No token, showing login immediately');
      setInitializing(false);
      setMaxWaitReached(false);
      clearTimeout(maxWaitTimeout);
      return;
    }

    // If we have a user, stop initializing
    if (user) {
      console.log('✅ [PublicRoute] User found, redirecting to dashboard');
      setInitializing(false);
      clearTimeout(maxWaitTimeout);
    }

    return () => clearTimeout(maxWaitTimeout);
  }, [token, user, isAuthenticated, loading]); // Depend on all auth state

  // Show loader only if:
  // 1. Actively loading with a token AND haven't exceeded max wait, OR
  // 2. Initializing with token but no user yet AND haven't exceeded max wait
  const shouldShowLoader = token && !maxWaitReached && (
    (loading && !user) || 
    (initializing && !user)
  );

  console.log('🎨 [PublicRoute] Render decision:', { shouldShowLoader, isAuthenticated, hasUser: !!user });

  if (shouldShowLoader) {
    console.log('⏳ [PublicRoute] Showing loader');
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f0f0',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    console.log('🔄 [PublicRoute] Redirecting authenticated user to dashboard');
    const redirectTo = '/candidate/dashboard';
    return <Navigate to={redirectTo} replace />;
  }

  console.log('✅ [PublicRoute] Rendering public content (login page)');
  return <>{children}</>;
};