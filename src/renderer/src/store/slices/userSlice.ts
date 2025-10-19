// src/store/slices/userSlice.ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UserType } from '../../types';

interface UserState {
  userType: UserType | null;
  preferences: Record<string, any>;
  onboardingStep: number;
  isFirstTimeUser: boolean;
}

const initialState: UserState = {
  userType: null,
  preferences: {},
  onboardingStep: 0,
  isFirstTimeUser: true,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserType: (state, action: PayloadAction<UserType | null>) => {
      state.userType = action.payload;
    },
    updatePreferences: (state, action: PayloadAction<Record<string, any>>) => {
      state.preferences = { ...state.preferences, ...action.payload };
    },
    incrementOnboardingStep: (state) => {
      state.onboardingStep += 1;
    },
    setFirstTimeUser: (state, action: PayloadAction<boolean>) => {
      state.isFirstTimeUser = action.payload;
    },
    resetUser: () => initialState,
  },
});

export const {
  setUserType,
  updatePreferences,
  incrementOnboardingStep,
  setFirstTimeUser,
  resetUser
} = userSlice.actions;
export default userSlice.reducer;