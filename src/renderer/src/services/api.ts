// src/services/api.ts
import axios from 'axios';
import { API_BASE_URL } from '../constants/api';
import { store } from '../store';
import { logout as logoutAction } from '../store/slices/authSlice';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Token getter function that can be injected from React/Clerk context
let getToken: (() => Promise<string | null>) | null = null;

export const setTokenGetter = (fn: () => Promise<string | null>) => {
  getToken = fn;
};

// Add request interceptor to include auth token
api.interceptors.request.use(
  async (config) => {
    let token: string | null = null;

    // 1. Try to get fresh token via injected getter (best practice for Clerk)
    if (getToken) {
      try {
        token = await getToken();
      } catch (err) {
        console.warn('Failed to refresh token via getter', err);
      }
    }



    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - dispatch logout to update Redux state
      store.dispatch(logoutAction());
      // Redirect to login page
      window.location.hash = '#/login';
    }
    return Promise.reject(error);
  }
);

export default api;

