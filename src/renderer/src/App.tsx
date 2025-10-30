// src/App.tsx
import React from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { store, persistor } from './store';
import { theme } from './styles/theme';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthInitializer } from './components/AuthInitializer';
import Home from './pages/Home';
import InterviewChat from './pages/InterviewChat';
import { PublicRoute } from './components/PublicRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { CandidateDashboard } from './pages/CandidateDashboard';
import { JoinInterview } from './pages/JoinInterview';
import { SessionCleanup } from './components/SessionCleanup';

const App: React.FC = () => {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <ConfigProvider theme={theme}>
          <AntApp>
            <AuthInitializer />
            <Router>
              <SessionCleanup />
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Layout />}>
                  <Route index element={
                    <PublicRoute>
                      <Home />
                    </PublicRoute>
                  } />
                </Route>

                {/* Auth Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />

                {/* Join Interview - Public but requires validation */}
                <Route path="/join" element={<JoinInterview />} />

                {/* Candidate Routes */}
                <Route
                  path="/candidate/dashboard"
                  element={
                    <ProtectedRoute allowedUserTypes={['candidate']}>
                      <CandidateDashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Interview Routes - Protected */}
                <Route
                  path="/interview/:sessionId"
                  element={
                    <ProtectedRoute allowedUserTypes={['candidate']}>
                      <InterviewChat />
                    </ProtectedRoute>
                  }
                />

                {/* New Interview Route - For starting new interviews with resume upload */}
                <Route
                  path="/interview"
                  element={
                    <ProtectedRoute allowedUserTypes={['candidate']}>
                      <InterviewChat />
                    </ProtectedRoute>
                  }
                />

                {/* 404 Redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Router>
          </AntApp>
        </ConfigProvider>
      </PersistGate>
    </Provider>
  );
}

export default App;