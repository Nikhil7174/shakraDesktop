// src/components/interview/chat/ChatContainer.tsx
import React, { useEffect, useRef, useMemo } from 'react';
import { colors, spacing } from '../../../styles';
import { QuestionTimer } from './QuestionTimer';
import { InterviewProgress } from './InterviewProgress';
import { MultipleChoiceQuestion } from './MultipleChoiceQuestion';
import { CodingQuestion } from './CodingQuestion';
import { ChatMessage } from './ChatMessage';
import type { Question, ChatMessage as ChatMessageType } from '../../../types';

interface ChatContainerProps {
  currentQuestion?: Question | null;
  questionIndex: number;
  totalQuestions: number;
  onSubmitAnswer: (answer: string) => void;
  onTimerExpire: () => void;
  loading?: boolean;
  disabled?: boolean;
  currentSession?: any; // Add currentSession to access questions and answers
  chatMessages?: ChatMessageType[];
  isSummaryView?: boolean;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  currentQuestion,
  questionIndex,
  totalQuestions,
  onSubmitAnswer,
  onTimerExpire,
  loading = false,
  disabled = false,
  currentSession,
  chatMessages = [],
  isSummaryView = false
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Remove internal showResult state - now managed by parent


  // Auto-scroll to bottom when new questions arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      // Only scroll within the chat container, not the entire page
      messagesEndRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest'
      });
    }
  }, [questionIndex, chatMessages.length]);

  // Remove chat messages logic since we're showing questions directly

  // Memoize timer component with question ID as key to ensure reset
  const timerComponent = useMemo(() => {
    if (!currentQuestion) return null;

    return (
      <QuestionTimer
        key={currentQuestion.id} // Add key to force remount when question changes
        timeLimit={currentQuestion.timeLimit}
        onExpire={onTimerExpire}
        disabled={disabled}
      />
    );
  }, [currentQuestion?.id, currentQuestion?.timeLimit, onTimerExpire, disabled]);

  // Memoize progress component
  const progressComponent = useMemo(() => (
    <InterviewProgress
      currentQuestion={questionIndex + 1}
      totalQuestions={totalQuestions}
      currentQuestionData={currentQuestion}
    />
  ), [questionIndex, totalQuestions, currentQuestion]);

  // Memoize current question component
  const currentQuestionComponent = useMemo(() => {
    if (!currentQuestion) return null;

    // Check if this is a coding question
    if (currentQuestion.type === 'coding') {
      return (
        <CodingQuestion
          key={currentQuestion.id} // Force re-render when question changes
          question={currentQuestion}
          onSubmitAnswer={(code) => {
            onSubmitAnswer(code);
          }}
          loading={loading}
          disabled={disabled}
          showResult={false}
        />
      );
    }

    // Default to MCQ for other question types
    return (
      <MultipleChoiceQuestion
        question={currentQuestion}
        onSubmitAnswer={(selectedOptionId) => {
          onSubmitAnswer(selectedOptionId);
        }}
        loading={loading}
        disabled={disabled}
        showResult={false}
        correctAnswerId={currentQuestion?.correctAnswerId}
      />
    );
  }, [currentQuestion, onSubmitAnswer, loading, disabled]);

  // Render chat messages in summary view
  if (isSummaryView) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '400px',
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: 8,
        backgroundColor: colors.background.primary
      }}>
        <div style={{
          padding: spacing.md,
          borderBottom: `1px solid ${colors.neutral[200]}`,
          backgroundColor: colors.background.secondary
        }}>
          <h4 style={{ margin: 0, color: colors.neutral[900] }}>Interview Chat History</h4>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: spacing.md,
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.sm
        }}>
          {chatMessages.length > 0 ? (
            chatMessages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
              />
            ))
          ) : (
            <div style={{
              textAlign: 'center',
              color: colors.neutral[500],
              padding: spacing.xl
            }}>
              No chat messages available
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '80vh', // Use viewport height instead of fixed 600px
      minHeight: '600px', // Minimum height for smaller screens
      maxHeight: '900px', // Maximum height for very large screens
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: 8,
      backgroundColor: colors.background.primary,
      boxShadow: colors.shadows.md
    }}>
      {/* Progress Bar */}
      {progressComponent}

      {/* Timer */}
      {timerComponent}

      {/* Scrollable Questions Container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden', // Prevent horizontal scroll
        padding: spacing.lg, // Increased padding for better spacing
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center', // Center all content horizontally
        gap: spacing.lg // Increased gap between questions
      }}>
        {/* Previous Questions */}
        {currentSession?.questions && currentSession.questions.slice(0, questionIndex).map((question: any) => {
          const answer = currentSession.answers?.find((a: any) => a.questionId === question.id);

          // DEBUG: Add more console logging
          console.log('All answers in session:', currentSession.answers);
          console.log('Looking for questionId:', question.id);
          console.log('Question:', question.id, 'Answer:', answer);
          console.log('Question type:', question.type);
          console.log('selectedOptionId:', answer?.selectedOptionId);
          console.log('code:', answer?.code);
          console.log('correctAnswerId:', question.correctAnswerId);

          return (
            <div key={question.id} style={{
              marginBottom: spacing.lg,
              width: '85%',
              minWidth: '600px',
              margin: '0 auto',
              display: 'flex',
              justifyContent: 'center'
            }}>
              {question.type === 'coding' ? (
                <CodingQuestion
                  question={question}
                  onSubmitAnswer={() => { }} // Disabled for previous questions
                  loading={false}
                  disabled={true} // Disabled for previous questions
                  showResult={true} // Show results for previous questions
                  submittedCode={answer?.code}
                  testResults={answer?.testResults}
                />
              ) : (
                <MultipleChoiceQuestion
                  question={question}
                  onSubmitAnswer={() => { }} // Disabled for previous questions
                  loading={false}
                  disabled={true} // Disabled for previous questions
                  showResult={true} // Show results for previous questions
                  selectedOptionId={answer?.selectedOptionId}
                  correctAnswerId={question.correctAnswerId}
                />
              )}
            </div>
          );
        })}

        {/* Current Question */}
        {currentQuestion && (
          <div style={{
            marginBottom: spacing.lg,
            width: '85%',
            minWidth: '600px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'center'
          }}>
            {currentQuestionComponent}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
