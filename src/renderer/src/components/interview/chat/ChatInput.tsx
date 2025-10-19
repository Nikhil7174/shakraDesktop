// src/components/interview/chat/ChatInput.tsx
import React, { useState, useCallback, useMemo } from 'react';
import { Input, Button } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../../styles';

interface ChatInputProps {
  onSubmit: (message: string) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit,
  loading = false,
  disabled = false,
  placeholder = "Type your message..."
}) => {
  const [message, setMessage] = useState('');

  const handleSubmit = useCallback(() => {
    if (message.trim() && !loading && !disabled) {
      onSubmit(message.trim());
      setMessage('');
    }
  }, [message, loading, disabled, onSubmit]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  // Memoize input styles
  const inputStyles = useMemo(() => ({
    container: {
      display: 'flex',
      gap: spacing.sm,
      alignItems: 'center'
    },
    input: {
      flex: 1
    },
    button: {
      backgroundColor: colors.primary.main,
      borderColor: colors.primary.main,
      color: colors.neutral[0]
    }
  }), []);

  // Memoize button props
  const buttonProps = useMemo(() => ({
    type: 'primary' as const,
    icon: <SendOutlined />,
    onClick: handleSubmit,
    loading,
    disabled: disabled || loading || !message.trim()
  }), [handleSubmit, loading, disabled, message]);

  return (
    <div style={inputStyles.container}>
      <Input.TextArea
        value={message}
        onChange={handleMessageChange}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        disabled={disabled || loading}
        autoSize={{ minRows: 1, maxRows: 4 }}
        style={inputStyles.input}
      />
      <Button {...buttonProps} style={inputStyles.button}>
        Send
      </Button>
    </div>
  );
};

export default ChatInput;

