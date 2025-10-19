// src/components/interview/chat/InterviewProgress.tsx
import React, { useCallback, useMemo } from 'react';
import { Progress, Typography, Tag } from 'antd';
import { colors, spacing } from '../../../styles';
import type { Question } from '../../../types';

const { Text } = Typography;

interface InterviewProgressProps {
  currentQuestion: number;
  totalQuestions: number;
  currentQuestionData?: Question | null;
}

export const InterviewProgress: React.FC<InterviewProgressProps> = ({
  currentQuestion,
  totalQuestions,
  currentQuestionData
}) => {

  const getDifficultyColor = useCallback((difficulty: string) => {
    switch (difficulty) {
      case 'easy': return colors.success.main;
      case 'medium': return colors.warning.main;
      case 'hard': return colors.error.main;
      default: return colors.neutral[500];
    }
  }, []);

  const getDifficultyTag = useCallback((difficulty: string) => {
    const color = getDifficultyColor(difficulty);
    return (
      <Tag color={color} style={{ fontSize: 11 }}>
        {difficulty.toUpperCase()}
      </Tag>
    );
  }, [getDifficultyColor]);

  // Memoize progress percentage
  const progressPercentage = useMemo(() =>
    Math.round((currentQuestion / totalQuestions) * 100),
    [currentQuestion, totalQuestions]
  );

  // Memoize progress styles
  const progressStyles = useMemo(() => ({
    container: {
      padding: spacing.md,
      backgroundColor: colors.neutral[50],
      borderBottom: `1px solid ${colors.neutral[200]}`,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: spacing.sm
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    progress: {
      marginTop: spacing.xs
    }
  }), []);

  // Memoize question info
  const questionInfo = useMemo(() => {
    if (!currentQuestionData) return null;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        {getDifficultyTag(currentQuestionData.difficulty)}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {currentQuestionData.timeLimit}s
        </Text>
      </div>
    );
  }, [currentQuestionData, getDifficultyTag]);

  return (
    <div style={progressStyles.container}>
      <div style={progressStyles.header}>
        <Text strong>
          Question {currentQuestion} of {totalQuestions}
        </Text>
        {questionInfo}
      </div>

      <Progress
        percent={progressPercentage}
        strokeColor={colors.primary.main}
        trailColor={colors.neutral[200]}
        showInfo={false}
        style={progressStyles.progress}
      />
    </div>
  );
};

export default InterviewProgress;
