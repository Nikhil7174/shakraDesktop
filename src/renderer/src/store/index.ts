// src/store/index.ts
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import type { TypedUseSelectorHook } from 'react-redux';
import { useDispatch, useSelector } from 'react-redux';

import uiReducer from './slices/uiSlice';
import userReducer from './slices/userSlice';
import sessionReducer from './slices/sessionSlice';
import interviewReducer from './slices/interviewSlice';
import authReducer from './slices/authSlice';
import securityReducer from './slices/securitySlice';
import dashboardReducer from './slices/dashboardSlice';

const authPersistConfig = {
  key: 'auth',
  storage,
  whitelist: ['user', 'token', 'isAuthenticated'],
};

const persistConfig = {
  key: 'root',
  version: 2, // Increment this to invalidate old persisted state
  storage,
  whitelist: ['user', 'interview', 'dashboard'],
  transforms: [
    // Create a transform to whitelist specific fields within the interview slice
    {
      in: (state: any, key: string) => {
        if (key === 'interview') {
          return {
            ...state,
            currentSession: state.currentSession,
            sessionHistory: state.sessionHistory,
            resumeData: state.resumeData,
            detailedResumeData: state.detailedResumeData,
            resumeUploadTimestamp: state.resumeUploadTimestamp
          };
        }
        return state;
      },
      out: (state: any) => state,
    }
  ],
  migrate: (state: any) => {
    // Migrate function must return a Promise
    return Promise.resolve(state).then((resolvedState) => {
      // Clear old interview state that doesn't have LiveKit credentials
      if (resolvedState && resolvedState.interview && resolvedState.interview.currentSession) {
        const session = resolvedState.interview.currentSession;
        // If session exists but doesn't have token/wsUrl/roomName, clear it
        if (!session.token || !session.wsUrl || !session.roomName) {
          console.log('🔄 [Redux-Persist] Migrating: Clearing old session without LiveKit credentials');
          return {
            ...resolvedState,
            interview: {
              ...resolvedState.interview,
              currentSession: null,
              chatMessages: [],
            }
          };
        }
      }
      return resolvedState;
    });
  }
};

const rootReducer = combineReducers({
  ui: uiReducer,
  user: userReducer,
  session: sessionReducer,
  interview: interviewReducer,
  auth: persistReducer(authPersistConfig, authReducer),
  security: securityReducer,
  dashboard: dashboardReducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
