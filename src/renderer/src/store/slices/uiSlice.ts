// src/store/slices/uiSlice.ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UserType } from '../../types';

export interface UIState {
  activeUserType: UserType | null;
  isLoading: boolean;
  selectedColumn: 'left' | 'right' | null;
}

const initialState: UIState = {
  activeUserType: null,
  isLoading: false,
  selectedColumn: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveUserType: (state, action: PayloadAction<UserType | null>) => {
      state.activeUserType = action.payload;
      state.selectedColumn = action.payload === 'interviewee' ? 'left' :
        action.payload === 'candidate' ? 'right' : null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    resetUI: () => initialState,
  },
});

export const { setActiveUserType, setLoading, resetUI } = uiSlice.actions;
export default uiSlice.reducer;