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

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['user', 'interview', 'auth'], // Persist user data, interview data, and auth
};

const rootReducer = combineReducers({
  ui: uiReducer,
  user: userReducer,
  session: sessionReducer,
  interview: interviewReducer,
  auth: authReducer,
  security: securityReducer,
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
