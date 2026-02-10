// src/hooks/api/useInterview.ts
import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setSubmittingAnswer,
  setError,
  updateSession
} from '../../store/slices/interviewSlice';

import api from '../../services/api';

export const useInterview = () => {
  const dispatch = useAppDispatch();
  const { currentSession, chatMessages, isStartingInterview, isSubmittingAnswer, error } = useAppSelector(state => state.interview);

  // Note: startInterview is now handled by startInterviewAsync thunk in interviewSlice
  // This hook only handles submitAnswer and saveResults

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
        try {
          // @ts-ignore
          if (typeof markUserInteraction === 'function') {
            // @ts-ignore
            markUserInteraction();
          }
        } catch (e) {
          // Ignore
        }

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
      console.log('Making POST request to:', `/interview/save-results`);
      console.log('Request payload:', JSON.stringify(results, null, 2));
      console.log('About to send request...');

      // Use centralized api service which handles auth token injection via interceptor
      const response = await api.post('/interview/save-results', results);

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

      // Use centralized api service
      const response = await api.post('/interview/validate-code', {
        questionId,
        code
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
    // startInterview removed - use startInterviewAsync from interviewSlice instead
    submitAnswer,
    getCurrentSession,
    restoreSession,
    saveResults,
    validateCode
  };
};
