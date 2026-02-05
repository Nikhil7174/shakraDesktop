import React from 'react';
import icon from '../assets/icon.png';

export const Login: React.FC = () => {
  const handleLogin = () => {
    // Redirect to local web client's dedicated desktop login page
    // This page enforces candidate role and redirects to deep link
    const webClientUrl = 'http://localhost:5173/auth/desktop-login';

    // @ts-ignore
    if (window.electronAPI?.openExternal) {
      // @ts-ignore
      window.electronAPI.openExternal(webClientUrl);
    } else {
      console.warn('openExternal not available');
      window.location.href = webClientUrl;
    }
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
    </div>
  );
};
