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

  // Timeout mechanism: After 10 seconds, redirect to login
  useEffect(() => {
    if (!token || user) {
      setMaxWaitReached(false);
      return;
    }

    // If we have a token but no user after 10 seconds, show login
    const timeout = setTimeout(() => {
      setMaxWaitReached(true);
    }, 10000);

    return () => clearTimeout(timeout);
  }, [token, user]);

  // If timeout reached, redirect to login
  if (maxWaitReached && token && !user) {
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


