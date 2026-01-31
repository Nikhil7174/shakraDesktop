import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedUserTypes?: Array<'candidate'>;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  allowedUserTypes 
}) => {
  const { isAuthenticated, user, loading, token, getCurrentUser } = useAuth();
  const location = useLocation();
  const [maxWaitReached, setMaxWaitReached] = useState(false);

  useEffect(() => {
    // Call getCurrentUser if:
    // 1. We have a token but no user (initialization case)
    // 2. Or isAuthenticated is true but user is missing (shouldn't happen, but handle it)
    if (token && !user) {
      getCurrentUser();
    }
  }, [token, user]); // Removed getCurrentUser from dependencies to prevent infinite loop

  // Timeout mechanism: Redirect to login if data takes too long
  useEffect(() => {
    if (!token || user) {
      setMaxWaitReached(false);
      return;
    }

    // If we have a token but no user after 3 seconds, show login
    const timeout = setTimeout(() => {
      console.warn('⚠️ [ProtectedRoute] User data fetch timed out. Redirecting to login...');
      setMaxWaitReached(true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [token, user]);

  // If timeout reached, or if we are not loading but still have no user despite having a token
  if ((maxWaitReached && token && !user) || (!loading && isAuthenticated && !user)) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (loading || (isAuthenticated && !user)) {
    return (
      <div 
        style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh' 
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (allowedUserTypes && user && !allowedUserTypes.includes(user.userType)) {
    // Redirect to candidate dashboard
    return <Navigate to="/candidate/dashboard" replace />;
  }

  return <>{children}</>;
};


