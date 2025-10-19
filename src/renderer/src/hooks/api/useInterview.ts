// src/hooks/api/useInterview.ts
import { useCallback } from 'react';
import axios from 'axios';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setStartingInterview,
  setSubmittingAnswer,
  setError,
  updateSession
} from '../../store/slices/interviewSlice';
import { useSession } from '../useSession';
import type { DetailedResumeData, ChatMessage } from '../../types';

import { API_BASE_URL } from '../../constants/api';

export const useInterview = () => {
  const dispatch = useAppDispatch();
  const { currentSession, chatMessages, isStartingInterview, isSubmittingAnswer, error } = useAppSelector(state => state.interview);
  const { resumeData, detailedResumeData } = useAppSelector(state => state.interview);
  const { token } = useAppSelector(state => state.auth);

  // Use the new unified session management
  const { saveSession, addChatMessage, markUserInteraction } = useSession();

  const startInterview = useCallback(async (candidateData: DetailedResumeData, linkToken: string) => {
    try {
      dispatch(setStartingInterview(true));
      dispatch(setError(null));

      if (!linkToken) {
        throw new Error('Interview link token is required');
      }

      const response = await axios.post(`${API_BASE_URL}/interview/start`, {
        candidateData,
        linkToken
      }, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.data.success) {
        const session = response.data;

        // Save new session using unified session management
        console.log('=== STARTING INTERVIEW - SAVING SESSION ===');
        console.log('Saving session to Redux:', session.sessionId);

        // Create complete session with resume data
        const completeSession = {
          sessionId: session.sessionId,
          resumeData: resumeData || undefined,
          detailedResumeData: detailedResumeData || undefined,
          currentSession: {
            ...session,
            interviewLinkId: session.interviewLinkId // Store the interview link ID
          },
          chatMessages: [],
          sessionType: 'new' as const
        };

        // Use Redux-only session management (automatically persisted via redux-persist)
        saveSession(completeSession);
        console.log('Session saved successfully with resume data');

        // Always add first question for new interview (don't check stored messages)
        if (session.questions && session.questions.length > 0) {
          const firstQuestion = session.questions[0];

          const questionMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            sessionId: session.sessionId,
            type: 'assistant',
            content: firstQuestion.question,
            timestamp: new Date().toISOString()
          };

          // Use unified session management for chat messages
          addChatMessage(questionMessage);
        }

        return session;
      }
    } catch (error: any) {
      console.error(' useInterview: Start interview error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to start interview';
      dispatch(setError(errorMessage));
      throw new Error(errorMessage);
    } finally {
      dispatch(setStartingInterview(false));
    }
  }, [dispatch, saveSession, addChatMessage]);

  const submitAnswer = useCallback(async (
    questionId: string,
    answer: string, // Changed from selectedOptionId to answer to handle both types
    timeTaken: number
  ) => {
    try {
      dispatch(setSubmittingAnswer(true));
      dispatch(setError(null));

      // Always update the session locally with frontend validation
      if (currentSession) {
        // Find the question to determine its type
        const question = currentSession.questions?.find(q => q.id === questionId);

        let newAnswer;

        if (question?.type === 'coding') {
          // Handle coding questions
          newAnswer = {
            questionId,
            answer: 'Code submitted', // Description
            code: answer, // The actual code
            answeredAt: new Date(),
            timeTaken: timeTaken || 0,
            isCorrect: undefined // Will be determined later by server evaluation
          };
        } else {
          // Handle MCQ questions
          const answerIsCorrect = question ? answer === question.correctAnswerId : false;
          newAnswer = {
            questionId,
            answer: answer === 'timeout' ? 'No answer selected (timeout)' : `Selected: ${answer}`,
            selectedOptionId: answer === 'timeout' ? 'timeout' : answer,
            answeredAt: new Date(),
            timeTaken: timeTaken || 0,
            isCorrect: answerIsCorrect
          };
        }

        console.log('Storing answer locally:', newAnswer);
        console.log('Question type:', question?.type);
        console.log('Answer is correct:', newAnswer.isCorrect);
        console.log('Answer structure:', {
          questionId: newAnswer.questionId,
          answer: newAnswer.answer,
          selectedOptionId: newAnswer.selectedOptionId,
          code: newAnswer.code,
          isCorrect: newAnswer.isCorrect
        });

        // Update session using unified session management
        const updatedAnswers = [...(currentSession.answers || []), newAnswer];
        
        // Use Redux-only session management (automatically persisted via redux-persist)
        dispatch(updateSession({
          answers: updatedAnswers
        }));

        // Mark user interaction to prevent welcome back modal during active session
        markUserInteraction();

        console.log('Updated session with answers:', updatedAnswers);
      }

      // Note: No backend call per question - only store locally until interview completion

      // Return success response
      const questionForResponse = currentSession?.questions?.find(q => q.id === questionId);
      return {
        success: true,
        isCorrect: questionForResponse?.type === 'coding' ? undefined :
          (questionForResponse ? questionForResponse.correctAnswerId === answer : false),
        message: 'Answer stored successfully'
      };
    } catch (error: any) {
      console.error('useInterview: Submit answer error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to submit answer';
      dispatch(setError(errorMessage));
      throw new Error(errorMessage);
    } finally {
      dispatch(setSubmittingAnswer(false));
    }
  }, [dispatch, currentSession]);

  const getCurrentSession = useCallback(() => {
    return currentSession;
  }, [currentSession]);

  const restoreSession = useCallback((_session: any) => {
    // This method is now handled by useSession
    // Keeping for backward compatibility but delegating to the new system
    console.log('restoreSession called - this should use useSession.restoreSession instead');
  }, []);

  const saveResults = useCallback(async (results: any) => {
    try {
      // DEBUG: Log API call details
      console.log('=== API CALL DEBUG ===');
      console.log('Making POST request to:', `${API_BASE_URL}/interview/save-results`);
      console.log('Request payload:', JSON.stringify(results, null, 2));
      console.log('About to send request...');

      const response = await axios.post(`${API_BASE_URL}/interview/save-results`, results, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      console.log('✅ API Response received:');
      console.log('Response status:', response.status);
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      console.log('=== END API CALL DEBUG ===');

      return response.data;
    } catch (error: any) {
      console.error('❌ useInterview: Save results error:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      const errorMessage = error.response?.data?.message || 'Failed to save results';
      throw new Error(errorMessage);
    }
  }, []);

  const validateCode = useCallback(async (questionId: string, code: string) => {
    try {
      console.log('=== CODE VALIDATION DEBUG ===');
      console.log('Validating code for question:', questionId);
      console.log('Code:', code);

      const response = await axios.post(`${API_BASE_URL}/interview/validate-code`, {
        questionId,
        code
      }, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      console.log('✅ Code validation response:', response.data);
      console.log('=== END CODE VALIDATION DEBUG ===');

      return response.data;
    } catch (error: any) {
      console.error('❌ useInterview: Code validation error:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.message || 'Failed to validate code';
      throw new Error(errorMessage);
    }
  }, []);

  return {
    currentSession,
    chatMessages,
    startingInterview: isStartingInterview,
    submittingAnswer: isSubmittingAnswer,
    error,
    startInterview,
    submitAnswer,
    getCurrentSession,
    restoreSession,
    saveResults,
    validateCode
  };
};
