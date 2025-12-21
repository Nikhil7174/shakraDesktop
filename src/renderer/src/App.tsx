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