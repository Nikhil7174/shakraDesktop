// src/hooks/useSession.ts
// Redux-only session management hook - replaces SessionManager
import { useCallback, useMemo, useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { 
  setCurrentSession, 
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

  // Page visibility tracking
  const [pageVisibility, setPageVisibility] = useState(!document.hidden);
  const [wasPageHidden, setWasPageHidden] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isActivelyInInterview, setIsActivelyInInterview] = useState(false);
  
  // More accurate page reload detection
  const isPageReload = useMemo(() => {
    // Check if page was reloaded using Performance Navigation API
    if (typeof performance !== 'undefined' && performance.navigation) {
      const navType = performance.navigation.type;
      console.log('Performance navigation type:', navType);
      return navType === 1; // TYPE_RELOAD
    }
    // Fallback for modern browsers
    if (typeof performance !== 'undefined' && performance.getEntriesByType) {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        const navType = navEntries[0].type;
        console.log('Navigation timing type:', navType);
        return navType === 'reload';
      }
    }
    console.log('No page reload detected');
    return false;
  }, []);

  // Track page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setPageVisibility(isVisible);
      
      // Track if page was hidden (for welcome back modal logic)
      if (!isVisible) {
        setWasPageHidden(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Track when user is actively in interview
  useEffect(() => {
    if (currentSession && currentSession.answers && currentSession.answers.length > 0) {
      setIsActivelyInInterview(true);
    } else {
      setIsActivelyInInterview(false);
    }
  }, [currentSession?.answers?.length]);



  // Check if there's an interrupted session that should show welcome back modal
  const shouldShowWelcomeBack = useMemo(() => {
    console.log('=== WELCOME BACK MODAL LOGIC ===');
    console.log('Current session:', !!currentSession);
    console.log('Has answers:', currentSession?.answers?.length || 0);
    console.log('Page visibility:', pageVisibility);
    console.log('Was page hidden:', wasPageHidden);
    console.log('Is page reload:', isPageReload);
    console.log('Has user interacted:', hasUserInteracted);
    
    if (!currentSession || !currentSession.answers || currentSession.answers.length === 0) {
      console.log('No session or no answers - not showing modal');
      return false;
    }
    
    // Don't show modal if user is actively in interview and hasn't left the page
    if (isActivelyInInterview && !wasPageHidden && !isPageReload) {
      console.log('User is actively in interview - not showing modal');
      return false;
    }
    
    // Show welcome back if:
    // 1. Session has answers (interrupted)
    // 2. AND either:
    //    - Page was previously hidden (user left and came back)
    //    - Page was reloaded (refresh scenario)
    const shouldShow = currentSession.answers.length > 0 && (wasPageHidden || isPageReload);
    console.log('Should show welcome back modal:', shouldShow);
    return shouldShow;
  }, [currentSession?.answers?.length, wasPageHidden, isPageReload, pageVisibility, hasUserInteracted, isActivelyInInterview]);

  // Get session summary for welcome back modal
  const sessionSummary = useMemo(() => {
    if (!currentSession) return null;
    
    const questionsAnswered = currentSession.answers?.length || 0;
    const totalQuestions = currentSession.questions?.length || 6;
    const timeAway = currentSession.startTime ? 
      Math.floor((Date.now() - new Date(currentSession.startTime).getTime()) / 1000 / 60) : 0;
    
    return {
      questionsAnswered,
      totalQuestions,
      timeAway,
      sessionDuration: timeAway,
      startTime: currentSession.startTime
    };
  }, [currentSession?.answers?.length, currentSession?.questions?.length, currentSession?.startTime]);

  /**
   * Save session data to Redux (automatically persisted by redux-persist)
   */
  const saveSession = useCallback((sessionData: {
    sessionId: string;
    resumeData?: ResumeData;
    detailedResumeData?: DetailedResumeData;
    currentSession: InterviewSession;
    chatMessages?: ChatMessage[];
  }) => {
    try {
      // Save to Redux (automatically persisted)
      dispatch(setCurrentSession(sessionData.currentSession));
      
      if (sessionData.resumeData) {
        dispatch(setResumeData(sessionData.resumeData));
      }
      
      if (sessionData.detailedResumeData) {
        dispatch(setDetailedResumeData(sessionData.detailedResumeData));
      }
      
      if (sessionData.chatMessages) {
        dispatch(setChatMessages(sessionData.chatMessages));
      }
      
      console.log('Session saved successfully to Redux:', sessionData.sessionId);
    } catch (error) {
      console.error('Failed to save session:', error);
      dispatch(setError('Failed to save session data'));
      throw error;
    }
  }, [dispatch]);

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
   * Mark user interaction (call when user submits answers or interacts with interview)
   */
  const markUserInteraction = useCallback(() => {
    setHasUserInteracted(true);
    console.log('User interaction marked');
  }, []);

  /**
   * Reset page visibility tracking (call when user interacts with welcome back modal)
   */
  const resetPageVisibilityTracking = useCallback(() => {
    setWasPageHidden(false);
    setHasUserInteracted(false);
    setIsActivelyInInterview(false);
    console.log('Page visibility tracking reset');
  }, []);

  /**
   * Check if interview is active
   */
  const isInterviewActive = useMemo(() => {
    return !!currentSession && currentSession.status === 'in_progress';
  }, [currentSession]);

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
    
    // Computed values
    shouldShowWelcomeBack,
    sessionSummary,
    isInterviewActive,
    
    // Actions
    saveSession,
    restoreSession: restoreSessionData,
    updateSession: updateSessionData,
    addChatMessage,
    clearSession: clearCurrentSession,
    clearAllSessions: clearAllSessionData,
    
    // Page visibility tracking
    resetPageVisibilityTracking,
    markUserInteraction,
    
    // Utilities
    getStoredSession
  };
};
