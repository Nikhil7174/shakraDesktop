// src/components/interview/InterviewSession.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Typography, Space, App } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';
import { ChatContainer } from './chat';
import { InterviewCompletionModal } from './InterviewCompletionModal';
import { InterviewFeedback } from './InterviewFeedback';
import { SecurityStatus } from '../security/SecurityStatus';
// import SessionManager from '../../services/SessionManager'; // No longer needed
import type { InterviewSession as InterviewSessionType, ChatMessage } from '../../types';

const { Title, Paragraph } = Typography;

interface InterviewSessionProps {
  onStartNew: () => void;
  currentSession?: InterviewSessionType | null;
  chatMessages?: ChatMessage[];
  onSubmitAnswer?: (questionId: string, answer: string, timeTaken: number) => Promise<any>;
  onSaveResults?: (results: any) => Promise<void>;
  onComplete?: () => void;
}

export const InterviewSession: React.FC<InterviewSessionProps> = ({
  currentSession,
  onSubmitAnswer,
  onSaveResults,
  onComplete
}) => {
  const { notification } = App.useApp();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isSubmitting] = useState(false);
  const [isInterviewCompleted, setIsInterviewCompleted] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // Add a state to track user answers locally
  // Memoize current question to avoid recalculation
  const currentQuestion = useMemo(() => {
    const question = currentSession?.questions?.[currentQuestionIndex];
    console.log('Current question memoized:', {
      index: currentQuestionIndex,
      questionId: question?.id,
      totalQuestions: currentSession?.questions?.length
    });
    return question;
  }, [currentSession?.questions, currentQuestionIndex]);

  // Restore current question index when session is loaded
  useEffect(() => {
    if (currentSession && currentSession.answers && !sessionRestored) {
      // Set current question index to the next unanswered question
      const answeredCount = currentSession.answers.length;
      const totalQuestions = currentSession.questions?.length || 0;

      // Ensure we don't go beyond available questions
      const nextQuestionIndex = Math.min(answeredCount, totalQuestions - 1);

      console.log('Restoring session - answered count:', answeredCount);
      console.log('Total questions:', totalQuestions);
      console.log('Setting current question index to:', nextQuestionIndex);

      setCurrentQuestionIndex(nextQuestionIndex);
      setSessionRestored(true);
    }
  }, [currentSession?.sessionId, sessionRestored]); // Only run when session ID changes

  // Reset states when session changes
  useEffect(() => {
    if (currentSession?.sessionId) {
      setSessionRestored(false);
      setIsInterviewCompleted(false);
    }
  }, [currentSession?.sessionId]);

  // Note: Auto-start interview logic removed - interviews can only be started via interview links

  const handleAnswerSubmit = useCallback(async (answer: string) => {
    if (!currentQuestion || !onSubmitAnswer || !currentSession) {
      return;
    }

    console.log('=== ANSWER SUBMISSION DEBUG ===');
    console.log('Current question index:', currentQuestionIndex);
    console.log('Current question:', currentQuestion.id);
    console.log('Question type:', currentQuestion.type);
    console.log('Answer:', answer);
    console.log('Total questions:', currentSession.questions?.length);
    console.log('Current answers count:', currentSession.answers?.length);

    // Submit to backend first
    try {
      const result = await onSubmitAnswer(currentQuestion.id, answer, 0);
      console.log('Backend submission result:', result);
    } catch (error) {
      console.error('Backend submission failed:', error);
      // Continue with frontend logic even if backend fails
    }

    // Check if this was the 6th question (index 5, since we're 0-indexed)
    const isLastQuestion = currentQuestionIndex >= 5; // 6th question (0-indexed)
    console.log('Is last question (index >= 5):', isLastQuestion);

    if (isLastQuestion) {
      // Mark interview as completed and show completion modal
      console.log('Interview completed! Showing completion modal.');
      setIsInterviewCompleted(true);
      setShowCompletionModal(true);
    } else {
      // Move to next question
      const nextIndex = currentQuestionIndex + 1;
      const totalQuestions = currentSession.questions?.length || 0;

      // Ensure we don't go beyond available questions
      if (nextIndex < totalQuestions) {
        console.log('Moving to next question. From index:', currentQuestionIndex, 'to:', nextIndex);
        setCurrentQuestionIndex(nextIndex);
      } else {
        console.log('No more questions available. Interview should be complete.');
        setIsInterviewCompleted(true);
        setShowCompletionModal(true);
      }
    }
    console.log('=== END ANSWER SUBMISSION DEBUG ===');
  }, [currentQuestion, currentSession, currentQuestionIndex, onSubmitAnswer]);

  const handleTimerExpire = useCallback(() => {
    if (currentQuestion && !isSubmitting) {
      notification.warning({
        message: 'Time\'s up!',
        description: 'Moving to next question...'
      });

      // FRONTEND LOGIC: Submit timeout answer and move to next question
      handleAnswerSubmit('timeout');
    }
  }, [currentQuestion, isSubmitting, handleAnswerSubmit]);

  const renderInterviewContent = useCallback(() => {
    if (!currentSession) {
      return (
        <div style={{ textAlign: 'center', padding: spacing.xl }}>
          <RobotOutlined style={{ fontSize: 64, color: colors.primary.main, marginBottom: spacing.md }} />
          <Title level={3}>Starting Your Interview</Title>
          <Paragraph>
            Preparing your personalized interview questions based on your resume...
          </Paragraph>
        </div>
      );
    }

    // Show completion message if interview is completed
    if (isInterviewCompleted) {
      return (
        <div style={{ textAlign: 'center', padding: spacing.xl }}>
          <Title level={3}>Interview Completed!</Title>
          <Paragraph>
            Thank you for completing the interview. Your results are being processed...
          </Paragraph>
        </div>
      );
    }

    return (
      <ChatContainer
        currentQuestion={currentQuestion}
        questionIndex={currentQuestionIndex}
        totalQuestions={6} // Fixed to 6 questions
        onSubmitAnswer={handleAnswerSubmit}
        onTimerExpire={handleTimerExpire}
        loading={isSubmitting}
        disabled={isSubmitting}
        currentSession={currentSession}
      />
    );
  }, [currentSession, currentQuestion, currentQuestionIndex, handleAnswerSubmit, handleTimerExpire, isSubmitting, isInterviewCompleted]);

  const [hasShownCompletionToast, setHasShownCompletionToast] = useState(false);

  const handleSaveSuccess = useCallback(() => {
    if (!hasShownCompletionToast) {
      setHasShownCompletionToast(true);
      notification.success({
        message: 'Interview Completed!',
        description: 'Your results have been saved successfully. Thank you for taking the interview!'
      });
    }
  }, [notification, hasShownCompletionToast]);

  const handleCompletion = useCallback(() => {
    // Close completion modal and show feedback modal
    setShowCompletionModal(false);
    setShowFeedbackModal(true);
  }, []);

  const handleFeedbackComplete = useCallback(() => {
    // Session clearing should be handled by useSessionManager
    // This component should not directly manage sessions
    
    // Close feedback modal and call the onComplete callback to redirect to home
    setShowFeedbackModal(false);
    if (onComplete) {
      onComplete();
    } else {
      // Fallback: redirect to home page
      window.location.href = '/';
    }
  }, [onComplete]);

  const handleFeedbackSkip = useCallback(() => {
    // Skip feedback and complete
    setShowFeedbackModal(false);
    if (onComplete) {
      onComplete();
    } else {
      // Fallback: redirect to home page
      window.location.href = '/';
    }
  }, [onComplete]);

  return (
    <Card style={{
      maxWidth: 1200, // Increased max width
      margin: '0 auto',
      minHeight: '90vh' // Ensure card takes most of viewport height
    }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {!isInterviewCompleted && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <div></div>
              <Title level={3} style={{ margin: 0 }}>AI Interview Session</Title>
              <SecurityStatus />
            </div>
            <Paragraph>
              {currentSession ?
                'Answer the questions below based on your resume and experience.' :
                'Starting your AI interview session...'
              }
            </Paragraph>
          </div>
        )}

        {/* Chat Interface or Summary */}
        {renderInterviewContent()}

      </Space>

      {/* Completion Modal */}
      {showCompletionModal && currentSession && onSaveResults && (
        <InterviewCompletionModal
          visible={showCompletionModal}
          session={currentSession}
          onComplete={handleCompletion}
          onSaveResults={onSaveResults}
          onSaveSuccess={handleSaveSuccess}
        />
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && currentSession && (
        <InterviewFeedback
          visible={showFeedbackModal}
          session={currentSession}
          onComplete={handleFeedbackComplete}
          onSkip={handleFeedbackSkip}
        />
      )}
    </Card>
  );
};

export default InterviewSession;
