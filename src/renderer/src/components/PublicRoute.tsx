import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';

interface PublicRouteProps {
  children: React.ReactNode;
}

export const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
  const { isAuthenticated, user, loading, getCurrentUser } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !user) {
      getCurrentUser();
    }
  }, [isAuthenticated, user]); // Removed getCurrentUser from dependencies to prevent infinite loop

  if (loading || (isAuthenticated && !user)) {
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