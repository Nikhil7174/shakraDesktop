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
  const { signIn, setActive } = useSignIn();

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
      const cleanup = window.electronAPI.onDeepLink(async (url: string) => {
        try {
          console.log("📢 [Renderer] Received deep link:", url);

          if (isSignedIn) {
            console.log("📢 [Renderer] User already signed in. Ignoring deep link auth.");
            // Focus window? 
            return;
          }

          const u = new URL(url);
          // Check for ticket or token (Clerk flows)
          const ticket = u.searchParams.get("ticket");
          const token = u.searchParams.get("token");

          if (ticket) {
            console.log("📢 [Renderer] Attempting sign in with ticket...");
            try {
              const result = await signIn.create({ strategy: "ticket", ticket });
              console.log("📢 [Renderer] Sign in with ticket result:", result.status);
              if (result.status === "complete") {
                await setActive({ session: result.createdSessionId });
              }
            } catch (ticketErr: any) {
              // Handle specific case where user is technically already signed in (race condition)
              if (ticketErr?.errors?.[0]?.code === 'session_exists' ||
                ticketErr?.message?.toLowerCase()?.includes("signed in")) {
                console.log("📢 [Renderer] Clerk reports already signed in (race condition). Proceeding.");
                // We assume we are good. useUser hook should update soon.
              } else {
                throw ticketErr;
              }
            }
          } else if (token) {
            console.error("📢 [Renderer] Attempting sign in with token as ticket...");
            try {
              const result = await signIn.create({ strategy: "ticket", ticket: token });
              console.log("📢 [Renderer] Sign in with token result:", result.status);
              if (result.status === "complete") {
                await setActive({ session: result.createdSessionId });
              }
            } catch (innerErr: any) {
              if (innerErr?.errors?.[0]?.code === 'session_exists' ||
                innerErr?.message?.toLowerCase()?.includes("signed in")) {
                console.log("📢 [Renderer] Clerk reports already signed in (race condition). Proceeding.");
              } else {
                console.error("📢 [Renderer] signIn.create failed with token:", innerErr);
              }
            }
          } else {
            console.warn("📢 [Renderer] No ticket or token found in deep link");
          }
        } catch (err) {
          console.error("📢 [Renderer] Deep link auth error:", err);
        }
      });

      return () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      };
    }
  }, [isLoaded, signIn, isSignedIn]);

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