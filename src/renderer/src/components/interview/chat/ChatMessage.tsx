// src/components/interview/chat/ChatMessage.tsx
import React, { useCallback, useMemo } from 'react';
import { Avatar, Typography } from 'antd';
import { UserOutlined, RobotOutlined, MessageOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../../styles';
import type { ChatMessage as ChatMessageType } from '../../../types';

const { Text } = Typography;

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  // Memoize message properties
  const messageProps = useMemo(() => ({
    isUser: message.type === 'user',
    isAssistant: message.type === 'assistant',
    isSystem: message.type === 'system',
    isAnswered: message.metadata?.isAnswered,
    isCorrect: message.metadata?.isCorrect,
    correctAnswer: message.metadata?.correctAnswer,
    userAnswer: message.metadata?.userAnswer
  }), [message.type, message.metadata]);

  const { isUser, isAssistant, isAnswered, isCorrect } = messageProps;

  const getBackgroundColor = useCallback(() => {
    if (isUser) {
      // Show different colors for correct/incorrect answers
      if (isAnswered !== undefined) {
        return isCorrect ? colors.success.main : colors.error.main;
      }
      return colors.primary.main;
    }
    if (isAssistant) return colors.neutral[100];
    return colors.info.light + '20'; // System messages
  }, [isUser, isAssistant, isAnswered, isCorrect]);

  const getTextColor = useCallback(() => {
    if (isUser) return colors.neutral[0];
    if (isAssistant) return colors.neutral[800];
    return colors.info.dark; // System messages
  }, [isUser, isAssistant]);

  const getAvatar = useCallback(() => {
    if (isUser) {
      // Show checkmark or X for answered questions
      if (isAnswered !== undefined) {
        return isCorrect ? <CheckCircleOutlined /> : <CloseCircleOutlined />;
      }
      return <UserOutlined />;
    }
    if (isAssistant) return <RobotOutlined />;
    return <MessageOutlined />; // System messages
  }, [isUser, isAssistant, isAnswered, isCorrect]);

  const getAvatarColor = useCallback(() => {
    if (isUser) {
      // Show different colors for correct/incorrect answers
      if (isAnswered !== undefined) {
        return isCorrect ? colors.success.main : colors.error.main;
      }
      return colors.primary.main;
    }
    if (isAssistant) return colors.info.main;
    return colors.neutral[500]; // System messages
  }, [isUser, isAssistant, isAnswered, isCorrect]);

  const formatTimestamp = useCallback((timestamp: string | Date) => {
    try {
      // Handle both Date objects and ISO strings
      const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      console.error('Error formatting timestamp:', e);
      return 'Invalid time';
    }
  }, []);

  // Memoize message styles
  const messageStyles = useMemo(() => ({
    container: {
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: spacing.md,
      gap: spacing.sm,
      alignItems: 'flex-start',
      width: '100%'
    },
    content: {
      maxWidth: '70%',
      minWidth: '200px'
    },
    bubble: {
      padding: spacing.md,
      borderRadius: 12,
      backgroundColor: getBackgroundColor(),
      color: getTextColor(),
      wordWrap: 'break-word' as const,
      whiteSpace: 'pre-wrap' as const
    },
    timestamp: {
      fontSize: 11,
      color: colors.neutral[500],
      marginTop: spacing.xs,
      textAlign: isUser ? 'right' : 'left'
    } as React.CSSProperties,
    avatar: {
      backgroundColor: getAvatarColor(),
      flexShrink: 0
    }
  }), [isUser, getBackgroundColor, getTextColor, getAvatarColor]);

  // Memoize formatted timestamp
  const formattedTimestamp = useMemo(() =>
    formatTimestamp(message.timestamp),
    [message.timestamp, formatTimestamp]
  );

  return (
    <div style={messageStyles.container}>
      {!isUser && (
        <Avatar
          size={32}
          icon={getAvatar()}
          style={messageStyles.avatar}
        />
      )}

      <div style={messageStyles.content}>
        <div style={messageStyles.bubble}>
          <Text style={{ color: getTextColor() }}>
            {message.content}
          </Text>
        </div>

        <div style={messageStyles.timestamp}>
          {formattedTimestamp}
        </div>
      </div>

      {isUser && (
        <Avatar
          size={32}
          icon={getAvatar()}
          style={messageStyles.avatar}
        />
      )}
    </div>
  );
};

export default ChatMessage;

