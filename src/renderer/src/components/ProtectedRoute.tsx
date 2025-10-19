import React, { useEffect } from 'react';
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
  const { isAuthenticated, user, loading, getCurrentUser } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated && !user) {
      getCurrentUser();
    }
  }, [isAuthenticated, user]); // Removed getCurrentUser from dependencies to prevent infinite loop

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


