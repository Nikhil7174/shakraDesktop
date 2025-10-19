// src/components/interview/CollapsibleChat.tsx
import React, { useState } from 'react';
import { Card, Button, Collapse, Typography } from 'antd';
import { MessageOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';
import { ChatContainer } from './chat';
import type { InterviewSession, ChatMessage } from '../../types';

const { Title } = Typography;

interface CollapsibleChatProps {
    session: InterviewSession;
    chatMessages: ChatMessage[];
    onSubmitAnswer?: (sessionId: string, questionId: string, answer: string, timeTaken: number) => Promise<any>;
    onTimerExpire?: () => void;
    loading?: boolean;
    disabled?: boolean;
}

export const CollapsibleChat: React.FC<CollapsibleChatProps> = ({
    session,
    chatMessages,
    onSubmitAnswer,
    onTimerExpire,
    loading = false,
    disabled = false
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <Card style={{ marginTop: spacing.lg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                    <MessageOutlined style={{ fontSize: 20, color: colors.primary.main }} />
                    <Title level={4} style={{ margin: 0 }}>Interview Chat</Title>
                </div>
                <Button
                    type="text"
                    icon={isExpanded ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    onClick={handleToggle}
                    style={{
                        color: colors.primary.main,
                        border: `1px solid ${colors.primary.main}`,
                        borderRadius: 6
                    }}
                >
                    {isExpanded ? 'Hide Chat' : 'Show Chat'}
                </Button>
            </div>

            <Collapse
                activeKey={isExpanded ? ['chat'] : []}
                onChange={(keys) => setIsExpanded(keys.includes('chat'))}
                ghost
                items={[
                    {
                        key: 'chat',
                        label: null,
                        showArrow: false,
                        style: {
                            backgroundColor: colors.background.secondary,
                            borderRadius: 8,
                            border: `1px solid ${colors.neutral[200]}`
                        },
                        children: (
                            <div style={{ padding: spacing.md }}>
                                <ChatContainer
                                    currentQuestion={null} // No current question in summary view
                                    questionIndex={0}
                                    totalQuestions={session.questions?.length || 0}
                                    onSubmitAnswer={onSubmitAnswer ? (answer: string) => onSubmitAnswer(session.sessionId, '', answer, 0) : () => { }}
                                    onTimerExpire={onTimerExpire || (() => { })}
                                    loading={loading}
                                    disabled={disabled || true} // Disabled in summary view
                                    currentSession={session}
                                    chatMessages={chatMessages}
                                    isSummaryView={true}
                                />
                            </div>
                        )
                    }
                ]}
            />
        </Card>
    );
};

export default CollapsibleChat;
