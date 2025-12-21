import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('❌ [ErrorBoundary] React error caught:', error);
    console.error('❌ [ErrorBoundary] Error info:', errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          color: '#fff',
          backgroundColor: '#1a1a1a',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <h1 style={{ color: '#e53e3e', marginBottom: '20px' }}>Something went wrong</h1>
          <pre style={{
            backgroundColor: '#2d3748',
            padding: '20px',
            borderRadius: '8px',
            color: '#e2e8f0',
            maxWidth: '800px',
            overflow: 'auto',
            textAlign: 'left'
          }}>
            {this.state.error?.toString()}
            {this.state.error?.stack && (
              <div style={{ marginTop: '10px', fontSize: '12px' }}>
                {this.state.error.stack}
              </div>
            )}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}






