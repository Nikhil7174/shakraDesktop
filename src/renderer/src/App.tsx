// src/App.tsx
import React from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { store, persistor } from './store';
import { theme } from './styles/theme';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthInitializer } from './components/AuthInitializer';
import InterviewChat from './pages/InterviewChat';
import { PublicRoute } from './components/PublicRoute';
import { Login } from './pages/Login';
import { CandidateDashboard } from './pages/CandidateDashboard';
import { JoinInterview } from './pages/JoinInterview';
import { SessionCleanup } from './components/SessionCleanup';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Register } from './pages/Register';

const App: React.FC = () => {
  // Hide splash screen when app is ready (minimum 1 second display)
  React.useEffect(() => {
    const hideSplashScreen = () => {
      const splash = document.getElementById('app-loading')
      if (splash) {
        splash.classList.add('loaded')
        setTimeout(() => splash.remove(), 300)
      }
    }
    
    // Keep splash screen visible for at least 1 second
    const timer = setTimeout(hideSplashScreen, 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <ErrorBoundary>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <ConfigProvider theme={theme}>
            <AntApp>
              <AuthInitializer />
              <Router>
                <SessionCleanup />
                <Routes>
                  <Route path="/" element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  } />
                  <Route path="/login" element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  } />
                  <Route path="/register" element={
                    <PublicRoute>
                    <Register />
                  </PublicRoute>
                  } />
                  <Route path="/join" element={<JoinInterview />} />
                  <Route
                    path="/candidate/dashboard"
                    element={
                      <ProtectedRoute allowedUserTypes={['candidate']}>
                        <CandidateDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/interview/:sessionId"
                    element={
                      <ProtectedRoute allowedUserTypes={['candidate']}>
                        <InterviewChat />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/interview"
                    element={
                      <ProtectedRoute allowedUserTypes={['candidate']}>
                        <InterviewChat />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Router>
            </AntApp>
          </ConfigProvider>
        </PersistGate>
      </Provider>
    </ErrorBoundary>
  );
}

export default App;