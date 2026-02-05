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
import { useSignIn, useUser } from '@clerk/clerk-react';
import InterviewChat from './pages/InterviewChat';
import { PublicRoute } from './components/PublicRoute';
import { Login } from './pages/Login';
import { CandidateDashboard } from './pages/CandidateDashboard';
import { JoinInterview } from './pages/JoinInterview';
import { SessionCleanup } from './components/SessionCleanup';
import { ErrorBoundary } from './components/ErrorBoundary';

const App: React.FC = () => {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn } = useSignIn();

  // Hide splash screen based on auth state
  React.useEffect(() => {
    if (!isLoaded) return;

    const hideSplashScreen = () => {
      const splash = document.getElementById('app-loading')
      if (splash) {
        splash.classList.add('loaded')
        setTimeout(() => splash.remove(), 300)
      }
    }

    let timer: NodeJS.Timeout;

    if (isSignedIn) {
      // Keep splash screen visible for at least 1 second if signed in (to show loading/entering app feel)
      timer = setTimeout(hideSplashScreen, 1000)
    } else {
      // If not signed in, hide splash immediately so Login page (which looks like splash) takes over
      hideSplashScreen()
    }

    return () => {
      if (timer) clearTimeout(timer);
    }
  }, [isLoaded, isSignedIn])

  // Handle Deep Links for Auth

  React.useEffect(() => {
    if (!isLoaded || !signIn) return;

    // @ts-ignore
    if (window.electronAPI?.onDeepLink) {
      // @ts-ignore
      window.electronAPI.onDeepLink(async (url: string) => {
        try {
          console.log("Received deep link:", url);
          const u = new URL(url);
          // Check for ticket or token (Clerk flows)
          const ticket = u.searchParams.get("ticket");
          const token = u.searchParams.get("token");

          if (ticket) {
            console.log("Attempting sign in with ticket...");
            const result = await signIn.create({ strategy: "ticket", ticket });
            console.log("Sign in with ticket result:", result.status);
          } else if (token) {
            console.log("Attempting sign in with token as ticket...");
            // Try using token as ticket (sometimes works for transfer tokens)
            // or specific custom flow if supported
            const result = await signIn.create({ strategy: "ticket", ticket: token });
            console.log("Sign in with token result:", result.status);
          } else {
            console.warn("No ticket or token found in deep link");
          }
        } catch (err) {
          console.error("Deep link auth error:", err);
        }
      });
    }
  }, [isLoaded, signIn]);

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