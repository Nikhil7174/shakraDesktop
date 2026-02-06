import { useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { useClerk } from '@clerk/clerk-react';
import { useAppDispatch, useAppSelector } from '../store';
import { loginSuccess, registerSuccess, setUser, logout as logoutAction, setLoading, setError } from '../store/slices/authSlice';
import { API_BASE_URL } from '../constants/api';
import api from '../services/api'; // Use api instance with interceptors for token expiration handling

export const useAuth = () => {
  const dispatch = useAppDispatch();
  const { user, token, isAuthenticated, loading, error } = useAppSelector((state) => state.auth);
  const { signOut } = useClerk();
  const getCurrentUserInProgress = useRef(false);

  // Reset the ref when token is cleared
  useEffect(() => {
    if (!token) {
      getCurrentUserInProgress.current = false;
    }
  }, [token]);

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      fullName: string;
      userType: 'candidate' | 'interviewer';
      phone?: string;
      company?: string;
    }) => {
      try {
        dispatch(setLoading(true));
        dispatch(setError(null));

        const response = await axios.post(`${API_BASE_URL}/auth/register/candidate`, data);

        if (response.data.success) {
          dispatch(
            registerSuccess({
              user: response.data.user,
              token: response.data.token,
            })
          );

          // Send token to main process (triggers config fetch)
          if (window.electronAPI?.setAuthToken && response.data.token) {
            window.electronAPI.setAuthToken(response.data.token).catch(err => {
              console.warn('⚠️ [Auth] Failed to set auth token after registration:', err);
            });
          }

          return response.data;
        }
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Registration failed';
        dispatch(setError(errorMessage));
        throw new Error(errorMessage);
      } finally {
        dispatch(setLoading(false));
      }
    },
    [dispatch]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        dispatch(setLoading(true));
        dispatch(setError(null));

        const response = await axios.post(`${API_BASE_URL}/auth/login`, {
          email,
          password,
        });

        if (response.data.success) {
          dispatch(
            loginSuccess({
              user: response.data.user,
              token: response.data.token,
            })
          );

          // Send token to main process (triggers config fetch)
          if (window.electronAPI?.setAuthToken && response.data.token) {
            window.electronAPI.setAuthToken(response.data.token).catch(err => {
              console.warn('⚠️ [Auth] Failed to set auth token after login:', err);
            });
          }

          return response.data;
        }
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Login failed';
        dispatch(setError(errorMessage));
        throw new Error(errorMessage);
      } finally {
        dispatch(setLoading(false));
      }
    },
    [dispatch]
  );

  const logout = useCallback(async () => {
    try {
      dispatch(setLoading(true));
      // Sign out from Clerk (critical for session cleanup)
      await signOut();

      // Call logout endpoint if token exists
      if (token) {
        await axios.post(
          `${API_BASE_URL}/auth/logout`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      dispatch(logoutAction());
      // Clear token in main process
      if (window.electronAPI?.setAuthToken) {
        window.electronAPI.setAuthToken(null).catch(() => { });
      }
    }
  }, [dispatch, token, signOut]);

  const getCurrentUser = useCallback(async () => {
    // Prevent multiple simultaneous calls using ref instead of loading state
    if (getCurrentUserInProgress.current) {
      console.log('⏸️ [Auth] getCurrentUser already in progress, skipping...');
      return;
    }

    try {
      if (!token) {
        console.log('⏸️ [Auth] No token, skipping getCurrentUser');
        // Reset loading state if no token
        if (loading) {
          dispatch(setLoading(false));
        }
        return;
      }

      // Mark as in progress
      getCurrentUserInProgress.current = true;
      console.log('🔄 [Auth] Starting getCurrentUser...');
      dispatch(setLoading(true));

      // Use api instance which has interceptors for automatic 401 handling
      // Uses default timeout from api instance (30s)
      const response = await api.get('/auth/me');

      if (response.data.success) {
        console.log('✅ [Auth] getCurrentUser successful');
        dispatch(setUser(response.data.user));
      } else {
        console.warn('⚠️ [Auth] getCurrentUser returned unsuccessful response');
        // If response is not successful, logout
        dispatch(logoutAction());
      }
    } catch (error: any) {
      console.error('❌ [Auth] Get current user error:', error);
      console.error('❌ [Auth] Error status:', error.response?.status);
      console.error('❌ [Auth] Error message:', error.message);
      // Always logout on error to clear invalid token
      dispatch(logoutAction());
    } finally {
      getCurrentUserInProgress.current = false;
      dispatch(setLoading(false));
      console.log('🏁 [Auth] getCurrentUser completed');
    }
  }, [dispatch, token, loading]);

  return {
    user,
    token,
    isAuthenticated,
    loading,
    error,
    register,
    login,
    logout,
    getCurrentUser,
  };
};

