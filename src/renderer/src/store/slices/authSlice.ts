import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AuthState, User } from '../../types';
// clearAllSessions import removed - handled by SessionCleanup component

const initialState: AuthState = {
  user: null,
  token: localStorage.getItem('authToken'),
  isAuthenticated: false, // Always start as false, will be validated by getCurrentUser
  loading: false,
  error: null,
  isSynced: false, // Indicates if auth state has been synced with backend/Clerk on startup
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setAuthSynced: (state, action: PayloadAction<boolean>) => {
      state.isSynced = action.payload;
    },
    loginSuccess: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
      state.isSynced = true; // Auth state is now synced after successful login
      // Store token in localStorage
      localStorage.setItem('authToken', action.payload.token);
      // Clear any existing session data to ensure fresh start for new user
      // Note: clearAllSessions will be dispatched by the component using useSession
    },
    registerSuccess: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
      state.isSynced = true; // Auth state is now synced after successful registration
      // Store token in localStorage
      localStorage.setItem('authToken', action.payload.token);
      // Clear any existing session data to ensure fresh start for new user
      // Note: clearAllSessions will be dispatched by the component using useSession
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isSynced = true; // User data has been set, state is synced
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.loading = false;
      state.error = null;
      state.isSynced = true; // Logout is a definitive state, so it's synced
      // Remove token from localStorage
      localStorage.removeItem('authToken');
      // Clear all interview session data to prevent data leakage between users
      // Note: clearAllSessions will be dispatched by the component using useSession
    },
  },
});

export const {
  setLoading,
  setError,
  loginSuccess,
  registerSuccess,
  setUser,
  logout,
  setAuthSynced
} = authSlice.actions;

export default authSlice.reducer;


