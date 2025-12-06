import { useCallback } from 'react';
import axios from 'axios';
import { useAppDispatch, useAppSelector } from '../store';
import { loginSuccess, registerSuccess, setUser, logout as logoutAction, setLoading, setError } from '../store/slices/authSlice';
import { API_BASE_URL } from '../constants/api';
import api from '../services/api'; // Use api instance with interceptors for token expiration handling

export const useAuth = () => {
  const dispatch = useAppDispatch();
  const { user, token, isAuthenticated, loading, error } = useAppSelector((state) => state.auth);

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
    }
  }, [dispatch, token]);

  const getCurrentUser = useCallback(async () => {
    // Prevent multiple simultaneous calls
    if (loading) {
      console.log('⏸️ [Auth] getCurrentUser already in progress, skipping...');
      return;
    }

    try {
      if (!token) {
        console.log('⏸️ [Auth] No token, skipping getCurrentUser');
        return;
      }

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

