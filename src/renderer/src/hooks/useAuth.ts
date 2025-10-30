import { useCallback } from 'react';
import axios from 'axios';
import { useAppDispatch, useAppSelector } from '../store';
import { loginSuccess, registerSuccess, setUser, logout as logoutAction, setLoading, setError } from '../store/slices/authSlice';
import { API_BASE_URL } from '../constants/api';

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
    try {
      if (!token) {
        return;
      }

      const response = await axios.get(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data.success) {
        dispatch(setUser(response.data.user));
      }
    } catch (error) {
      console.error('Get current user error:', error);
      // If token is invalid, logout
      dispatch(logoutAction());
    }
  }, [dispatch, token]);

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

