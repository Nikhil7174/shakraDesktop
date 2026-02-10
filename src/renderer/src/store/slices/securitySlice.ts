// src/store/slices/securitySlice.ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

// Simplified types (no longer dependent on WebSocket)
interface CheatingIncident {
  id: string;
  processName: string;
  timestamp: number;
  reason?: string;
}

interface SecurityStatus {
  totalProcesses: number;
  blockedAppsDetected: Array<{ name: string; pid: number; reason?: string }>;
  timestamp: number;
}

export interface SecurityState {
  // Connection status
  isSecurityAgentConnected: boolean;

  // Cheating detection
  cheatingDetected: boolean;
  cheatingIncidents: CheatingIncident[];

  // Security status
  securityStatus: SecurityStatus | null;

  // UI state
  showWarning: boolean;
  warningMessage: string;
}

const initialState: SecurityState = {
  isSecurityAgentConnected: false,
  cheatingDetected: false,
  cheatingIncidents: [],
  securityStatus: null,
  showWarning: false,
  warningMessage: ''
};

const securitySlice = createSlice({
  name: 'security',
  initialState,
  reducers: {
    setSecurityAgentConnected: (state, action: PayloadAction<boolean>) => {
      state.isSecurityAgentConnected = action.payload;
    },

    setCheatingDetected: (state, action: PayloadAction<boolean>) => {
      state.cheatingDetected = action.payload;

      // Show warning when cheating is detected
      if (action.payload) {
        state.showWarning = true;
        state.warningMessage = 'Suspicious activity detected! Please close any unauthorized applications and continue with your interview.';
      }
    },

    addCheatingIncident: (state, action: PayloadAction<CheatingIncident>) => {
      state.cheatingIncidents.push(action.payload);
      state.cheatingDetected = true;
    },

    setSecurityStatus: (state, action: PayloadAction<SecurityStatus>) => {
      state.securityStatus = action.payload;
    },

    dismissWarning: (state) => {
      state.showWarning = false;
      state.warningMessage = '';
    },

    clearCheatingIncidents: (state) => {
      state.cheatingIncidents = [];
      state.cheatingDetected = false;
      state.showWarning = false;
      state.warningMessage = '';
    },

    resetSecurityState: () => {
      return { ...initialState };
    }
  }
});

export const {
  setSecurityAgentConnected,
  setCheatingDetected,
  addCheatingIncident,
  setSecurityStatus,
  dismissWarning,
  clearCheatingIncidents,
  resetSecurityState
} = securitySlice.actions;

export default securitySlice.reducer;


