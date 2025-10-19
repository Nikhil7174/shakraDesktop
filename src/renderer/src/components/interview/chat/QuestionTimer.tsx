// src/components/interview/chat/QuestionTimer.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Progress, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../../styles';

const { Text } = Typography;

interface QuestionTimerProps {
  timeLimit: number; // in seconds
  onExpire: () => void;
  disabled?: boolean;
}

export const QuestionTimer: React.FC<QuestionTimerProps> = ({
  timeLimit,
  onExpire,
  disabled = false
}) => {
  const [timeLeft, setTimeLeft] = useState(timeLimit);

  useEffect(() => {
    if (disabled || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          console.log('QuestionTimer: Time expired!');
          // Use setTimeout to avoid setState during render
          setTimeout(() => onExpire(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onExpire, disabled]); // Removed timeLeft from dependencies to prevent timer restart

  // Reset timer when timeLimit changes
  useEffect(() => {
    setTimeLeft(timeLimit);
  }, [timeLimit]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Memoize formatted time
  const formattedTime = useMemo(() => formatTime(timeLeft), [timeLeft, formatTime]);

  // Memoize progress color based on time left
  const progressColor = useMemo(() => {
    const percentage = (timeLeft / timeLimit) * 100;
    if (percentage > 50) return colors.success.main;
    if (percentage > 25) return colors.warning.main;
    return colors.error.main;
  }, [timeLeft, timeLimit]);

  // Memoize timer styles
  const timerStyles = useMemo(() => ({
    container: {
      padding: spacing.sm,
      backgroundColor: colors.neutral[50],
      borderBottom: `1px solid ${colors.neutral[200]}`,
      display: 'flex',
      alignItems: 'center',
      gap: spacing.sm
    },
    icon: {
      color: colors.primary.main,
      fontSize: 16
    },
    text: {
      fontSize: 14,
      fontWeight: 500,
      color: colors.neutral[700]
    },
    progress: {
      flex: 1,
      maxWidth: 200
    }
  }), []);

  if (disabled) return null;

  return (
    <div style={timerStyles.container}>
      <ClockCircleOutlined style={timerStyles.icon} />
      <Text style={timerStyles.text}>
        {formattedTime}
      </Text>
      <Progress
        percent={Math.round((timeLeft / timeLimit) * 100)}
        strokeColor={progressColor}
        trailColor={colors.neutral[200]}
        showInfo={false}
        size="small"
        style={timerStyles.progress}
      />
    </div>
  );
};

export default QuestionTimer;
