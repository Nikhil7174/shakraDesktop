// src/components/layout/Header.tsx
import React from 'react';
import { Layout, Button, Space } from 'antd';
import { LoginOutlined, LogoutOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { colors, spacing } from '../../styles';
import crispLogo from '../../assets/images/crisp.png';
import { useAuth } from '../../hooks/useAuth';

const { Header: AntHeader } = Layout;

export const Header: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();

  const handleTitleClick = () => {
    navigate('/');
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  const handleLogoutClick = async () => {
    await logout();
    navigate('/');
  };

  return (
    <AntHeader
      style={{
        background: colors.background.primary,
        boxShadow: colors.shadows.sm,
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        padding: `0 ${spacing.lg}px`,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxWidth: 1200,
        margin: '0 auto',
        height: '100%',
      }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            cursor: 'pointer'
          }}
          onClick={handleTitleClick}
        >
          <img
            src={crispLogo}
            alt="Crisp Logo"
            style={{
              height: 32,
              width: 'auto'
            }}
          />
          <span style={{
            fontSize: 20,
            fontWeight: 600,
            color: colors.neutral[900]
          }}>
            Crisp
          </span>
        </div>

        <Space>
          {isAuthenticated ? (
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogoutClick}
              style={{ color: colors.error.main }}
            >
              Logout
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<LoginOutlined />}
              onClick={handleLoginClick}
            >
              Login
            </Button>
          )}
        </Space>
      </div>
    </AntHeader>
  );
};
