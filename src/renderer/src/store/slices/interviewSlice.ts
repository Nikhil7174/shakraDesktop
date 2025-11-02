// src/store/slices/interviewSlice.ts
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { ResumeData, DetailedResumeData, InterviewSession, ChatMessage } from '../../types';

interface InterviewState {
  // Resume Data
  resumeData: ResumeData | null;
  detailedResumeData: DetailedResumeData | null;
  resumeUploadTimestamp: number | null;

  // Interview Session
  currentSession: InterviewSession | null;
  sessionHistory: InterviewSession[];

  // Chat Messages
  chatMessages: ChatMessage[];

  // Loading States
  isLoading: boolean;
  isUploading: boolean;
  isStartingInterview: boolean;
  isSubmittingAnswer: boolean;

  // Error States
  error: string | null;

  // Cache Management
  lastDataFetch: number | null;
  cacheExpiry: number; // 30 minutes in milliseconds
}

const initialState: InterviewState = {
  // Resume Data
  resumeData: null,
  detailedResumeData: null,
  resumeUploadTimestamp: null,

  // Interview Session
  currentSession: null,
  sessionHistory: [],

  // Chat Messages
  chatMessages: [],

  // Loading States
  isLoading: false,
  isUploading: false,
  isStartingInterview: false,
  isSubmittingAnswer: false,

  // Error States
  error: null,

  // Cache Management
  lastDataFetch: null,
  cacheExpiry: 30 * 60 * 1000, // 30 minutes
};

const interviewSlice = createSlice({
  name: 'interview',
  initialState,
  reducers: {
    // Resume Data Actions
    setResumeData: (state, action: PayloadAction<ResumeData>) => {
      state.resumeData = action.payload;
      state.resumeUploadTimestamp = Date.now();
      state.lastDataFetch = Date.now();
    },

    setDetailedResumeData: (state, action: PayloadAction<DetailedResumeData>) => {
      state.detailedResumeData = action.payload;
    },

    // Loading States
    setUploading: (state, action: PayloadAction<boolean>) => {
      state.isUploading = action.payload;
    },

    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },

    setStartingInterview: (state, action: PayloadAction<boolean>) => {
      state.isStartingInterview = action.payload;
    },

    setSubmittingAnswer: (state, action: PayloadAction<boolean>) => {
      state.isSubmittingAnswer = action.payload;
    },

    // Interview Session Actions
    setCurrentSession: (state, action: PayloadAction<InterviewSession>) => {
      state.currentSession = action.payload;
      state.sessionHistory.push(action.payload);
    },

    updateSession: (state, action: PayloadAction<Partial<InterviewSession>>) => {
      if (state.currentSession) {
        state.currentSession = { ...state.currentSession, ...action.payload };
      }
    },

    // Chat Messages
    addChatMessage: (state, action: PayloadAction<ChatMessage>) => {
      state.chatMessages.push(action.payload);
    },

    setChatMessages: (state, action: PayloadAction<ChatMessage[]>) => {
      state.chatMessages = action.payload;
    },

    // Error Handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    // Cache Management
    clearCache: (state) => {
      state.resumeData = null;
      state.detailedResumeData = null;
      state.resumeUploadTimestamp = null;
      state.lastDataFetch = null;
      state.error = null; // Clear error when clearing cache
    },

    // Session Management Actions
    restoreSession: (state, action: PayloadAction<{
      currentSession: InterviewSession;
      resumeData?: ResumeData;
      detailedResumeData?: DetailedResumeData;
      chatMessages: ChatMessage[];
    }>) => {
      state.currentSession = action.payload.currentSession;
      if (action.payload.resumeData) {
        state.resumeData = action.payload.resumeData;
      }
      if (action.payload.detailedResumeData) {
        state.detailedResumeData = action.payload.detailedResumeData;
      }
      state.chatMessages = action.payload.chatMessages;
    },

    clearSession: (state) => {
      state.currentSession = null;
      state.chatMessages = [];
      state.sessionHistory = [];
    },

    clearAllSessions: (state) => {
      state.currentSession = null;
      state.chatMessages = [];
      state.sessionHistory = [];
      state.resumeData = null;
      state.detailedResumeData = null;
      state.resumeUploadTimestamp = null;
      state.error = null; // Clear error when clearing sessions
    },

    // Reset Actions
    resetInterview: () => initialState,

    resetSession: (state) => {
      state.currentSession = null;
      state.chatMessages = [];
      state.sessionHistory = [];
    }
  }
});

export const {
  setResumeData,
  setDetailedResumeData,
  setUploading,
  setLoading,
  setStartingInterview,
  setSubmittingAnswer,
  setCurrentSession,
  updateSession,
  addChatMessage,
  setChatMessages,
  setError,
  clearCache,
  restoreSession,
  clearSession,
  clearAllSessions,
  resetInterview,
  resetSession
} = interviewSlice.actions;

export default interviewSlice.reducer;

