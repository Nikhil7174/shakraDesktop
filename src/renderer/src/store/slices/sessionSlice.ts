// src/store/slices/sessionSlice.ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

const initialState = {
  visitTimestamp: Date.now(),
  userJourney: [] as string[],
  selectedFeatures: [] as string[],
};

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    addToJourney: (state, action: PayloadAction<string>) => {
      state.userJourney.push(action.payload);
    },
    addSelectedFeature: (state, action: PayloadAction<string>) => {
      if (!state.selectedFeatures.includes(action.payload)) {
        state.selectedFeatures.push(action.payload);
      }
    },
    resetSession: () => initialState,
  },
});

export const { addToJourney, addSelectedFeature, resetSession } = sessionSlice.actions;
export default sessionSlice.reducer;