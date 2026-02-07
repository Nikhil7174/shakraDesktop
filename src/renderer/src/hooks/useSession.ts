// src/hooks/useSession.ts
// Redux-only session management hook - replaces SessionManager
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import {
  updateSession,
  setChatMessages,
  setResumeData,
  setDetailedResumeData,
  restoreSession,
  clearSession,
  clearAllSessions,
  setError
} from '../store/slices/interviewSlice';
import type { StoredSession, InterviewSession, ResumeData, DetailedResumeData, ChatMessage } from '../types';

export const useSession = () => {
  const dispatch = useAppDispatch();
  const {
    currentSession,
    chatMessages,
    resumeData,
    detailedResumeData,
    sessionHistory
  } = useAppSelector(state => state.interview);







  // saveSession removed - use startInterviewAsync thunk instead

  /**
   * Restore session data (for welcome back modal)
   */
  const restoreSessionData = useCallback((sessionData: {
    currentSession: InterviewSession;
    resumeData?: ResumeData;
    detailedResumeData?: DetailedResumeData;
    chatMessages: ChatMessage[];
  }) => {
    try {
      dispatch(restoreSession(sessionData));
      console.log('Session restored successfully from Redux');
    } catch (error) {
      console.error('Failed to restore session:', error);
      dispatch(setError('Failed to restore session data'));
      throw error;
    }
  }, [dispatch]);

  /**
   * Update session data (Redux-only)
   */
  const updateSessionData = useCallback((updates: Partial<InterviewSession>) => {
    try {
      dispatch(updateSession(updates));
      console.log('Session updated successfully in Redux');
    } catch (error) {
      console.error('Failed to update session:', error);
      dispatch(setError('Failed to update session data'));
      throw error;
    }
  }, [dispatch]);


  /**
   * Add chat message
   */
  const addChatMessage = useCallback((message: ChatMessage) => {
    try {
      const updatedMessages = [...chatMessages, message];
      dispatch(setChatMessages(updatedMessages));
      console.log('Chat message added successfully');
    } catch (error) {
      console.error('Failed to add chat message:', error);
      dispatch(setError('Failed to add chat message'));
      throw error;
    }
  }, [dispatch, chatMessages]);

  /**
   * Clear current session
   */
  const clearCurrentSession = useCallback(() => {
    try {
      dispatch(clearSession());
      console.log('Current session cleared successfully');
    } catch (error) {
      console.error('Failed to clear session:', error);
      dispatch(setError('Failed to clear session'));
      throw error;
    }
  }, [dispatch]);

  /**
   * Clear all session data (for logout/login)
   */
  const clearAllSessionData = useCallback(() => {
    try {
      dispatch(clearAllSessions());
      console.log('All session data cleared successfully');
    } catch (error) {
      console.error('Failed to clear all sessions:', error);
      dispatch(setError('Failed to clear all sessions'));
      throw error;
    }
  }, [dispatch]);





  /**
   * Get stored session (for backward compatibility)
   */
  const getStoredSession = useCallback((): StoredSession | null => {
    if (!currentSession) return null;

    return {
      sessionId: currentSession.id || 'unknown',
      timestamp: Date.now(),
      lastActivity: Date.now(),
      sessionType: 'new',
      resumeData: resumeData || undefined,
      detailedResumeData: detailedResumeData || undefined,
      status: currentSession.status,
      questions: currentSession.questions,
      answers: currentSession.answers,
      startTime: currentSession.startTime,
      endTime: currentSession.endTime,
      duration: currentSession.duration,
      score: currentSession.score,
      summary: currentSession.summary,
      chatMessages,
      candidateId: currentSession.candidateId,
      success: currentSession.success,
      message: currentSession.message
    };
  }, [currentSession, resumeData, detailedResumeData, chatMessages]);

  return {
    // State
    currentSession,
    chatMessages,
    resumeData,
    detailedResumeData,
    sessionHistory,

    // Actions
    // saveSession removed - use startInterviewAsync thunk instead
    restoreSession: restoreSessionData,
    updateSession: updateSessionData,
    addChatMessage,
    clearSession: clearCurrentSession,
    clearAllSessions: clearAllSessionData,

    // Utilities
    getStoredSession
  };
};
