import React, { useState } from 'react';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import icon from '../assets/icon.png';
import { useAuth } from '../hooks/useAuth';

export const Login: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { loading: authLoading, isAuthenticated } = useAuth();

  // If auth is loading or we are authenticated (waiting for redirect), show loader
  const isLoading = isLoggingIn || authLoading || isAuthenticated;

  const handleLogin = () => {
    setIsLoggingIn(true);
    // Redirect to local web client's dedicated desktop login page
    // This page enforces candidate role and redirects to deep link
    const webClientUrl = 'https://shakra.io/auth/desktop-login';

    // @ts-ignore
    if (window.electronAPI?.openExternal) {
      // @ts-ignore
      window.electronAPI.openExternal(webClientUrl);
    } else {
      console.warn('openExternal not available');
      window.location.href = webClientUrl;
    }

    // Reset button state after a delay if user cancels/fails to login, 
    // but keep it loading long enough for the browser flow to start
    setTimeout(() => {
      // We generally want to keep showing loading if the user is actually logging in via browser
      // But if they just close the browser, we might want to reset?
      // For now, let's keep it 'loading' to indicate "Check your browser"
    }, 5000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999, // Ensure it sits on top if needed
        overflow: 'hidden' // Remove any scrolling
      }}
    >
      <div
        style={{
          marginBottom: '32px',
          width: '120px',
          height: '120px',
          flexShrink: 0,
          animation: 'fadeInScale 0.6s ease-out'
        }}
      >
        <img
          src={icon}
          alt="Shakra AI Interview"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.5))',
            display: 'block'
          }}
        />
      </div>

      <div
        style={{
          color: '#ffffff',
          fontSize: '28px',
          fontWeight: 600,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
          lineHeight: 1.2,
          marginBottom: '12px',
          textAlign: 'center',
          whiteSpace: 'nowrap'
        }}
      >
        Shakra AI Interview
      </div>

      <style>
        {`
          @keyframes fadeInScale {
            from {
              opacity: 0;
              transform: scale(0.8);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>

      {isLoading ? (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: '#fff' }} spin />} />
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>
            {isAuthenticated ? 'Redirecting...' : 'Signing you in...'}
          </span>
        </div>
      ) : (
        <button
          onClick={handleLogin}
          style={{
            marginTop: '2rem',
            backgroundColor: '#2d333b',
            color: 'white',
            fontWeight: '600',
            height: '36px',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 20px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontSize: '14px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#373e47';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#2d333b';
          }}
        >
          Sign In
        </button>
      )}
    </div>
  );
};
