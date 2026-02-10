import React, { useEffect } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { useAppDispatch } from '../store';
import { loginSuccess, logout, setAuthSynced } from '../store/slices/authSlice';
import api, { setTokenGetter } from '../services/api';

export const AuthInitializer: React.FC = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const { getToken } = useClerkAuth();
  const dispatch = useAppDispatch();

  // Inject getToken into API service for just-in-time refresh
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  useEffect(() => {
    const syncAuth = async () => {
      if (isLoaded && isSignedIn && user) {
        try {
          // Get JWT token from Clerk
          const token = await getToken();

          if (token) {
            // 1. Send token to Electron Main process
            if (window.electronAPI?.setAuthToken) {
              window.electronAPI.setAuthToken(token).catch(err => {
                console.warn('Failed to send token to main process:', err);
              });
            }

            // 2. Fetch backend user details (syncs user to DB if needed)
            // The api interceptor will pick up the token from getToken
            const response = await api.get('/auth/me');

            // 3. Update Redux State
            dispatch(loginSuccess({
              user: response.data.user,
              token: token
            }));
          }
        } catch (err) {
          console.error("Auth Sync Error:", err);
          // If backend sync fails (e.g. 500), consider what to do.
          // For now, allow retry or keep logged in (Clerk is valid).
          // But if we can't get backend user, app might break.
        } finally {
          dispatch(setAuthSynced(true));
        }
      } else if (isLoaded && !isSignedIn) {
        // Handle Logout
        dispatch(logout());
        if (window.electronAPI?.setAuthToken) {
          window.electronAPI.setAuthToken(null).catch(() => { });
        }
        dispatch(setAuthSynced(true));
      }
    };

    syncAuth();
  }, [isLoaded, isSignedIn, user, getToken, dispatch]);

  return null;
};

