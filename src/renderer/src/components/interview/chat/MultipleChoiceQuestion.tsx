// src/components/interview/chat/MultipleChoiceQuestion.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Card, Radio, Button, Space, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../../styles';
import type { Question } from '../../../types';

const { Title, Text } = Typography;

interface MultipleChoiceQuestionProps {
    question: Question;
    onSubmitAnswer: (selectedOptionId: string) => void;
    loading?: boolean;
    disabled?: boolean;
    showResult?: boolean;
    selectedOptionId?: string;
    correctAnswerId?: string;
}

export const MultipleChoiceQuestion: React.FC<MultipleChoiceQuestionProps> = ({
    question,
    onSubmitAnswer,
    loading = false,
    disabled = false,
    showResult = false,
    selectedOptionId,
    correctAnswerId
}) => {
    const [selectedOption, setSelectedOption] = useState<string>('');

    // Reset selected option when question changes
    useEffect(() => {
        setSelectedOption('');
    }, [question.id]);

    const handleOptionChange = useCallback((e: any) => {
        setSelectedOption(e.target.value);
    }, []);

    const handleSubmit = useCallback(() => {
        if (selectedOption && !loading && !disabled) {
            onSubmitAnswer(selectedOption);
        }
    }, [selectedOption, loading, disabled, onSubmitAnswer]);

    const getOptionStyle = useCallback((optionId: string) => {
        if (!showResult) return {};

        if (optionId === correctAnswerId) {
            return {
                backgroundColor: colors.success.light,
                borderColor: colors.success.main,
                color: colors.success.dark
            };
        }

        if (optionId === selectedOptionId && optionId !== correctAnswerId) {
            return {
                backgroundColor: colors.error.light,
                borderColor: colors.error.main,
                color: colors.error.dark
            };
        }

        return {};
    }, [showResult, correctAnswerId, selectedOptionId]);

    const getOptionIcon = useCallback((optionId: string) => {
        if (!showResult) return null;

        if (optionId === correctAnswerId) {
            return <CheckCircleOutlined style={{ color: colors.success.main }} />;
        }

        if (optionId === selectedOptionId && optionId !== correctAnswerId) {
            return <CloseCircleOutlined style={{ color: colors.error.main }} />;
        }

        return null;
    }, [showResult, correctAnswerId, selectedOptionId]);

    // If no question, don't render anything
    if (!question) {
        return <div>No question provided</div>;
    }

    // If no options, show a clear message
    if (!question.options || question.options.length === 0) {
        // Temporary hardcoded options for testing
        const tempOptions = [
            { id: 'a', text: 'let and const are block-scoped, var is function-scoped', isCorrect: true },
            { id: 'b', text: 'All three are function-scoped', isCorrect: false },
            { id: 'c', text: 'let and var are block-scoped, const is function-scoped', isCorrect: false },
            { id: 'd', text: 'All three are block-scoped', isCorrect: false }
        ];

        // Override the question with temp options
        const tempQuestion = { ...question, options: tempOptions, correctAnswerId: 'a' };

        return (
            <Card style={{
                marginBottom: spacing.lg,
                border: '2px solid orange',
                width: '100%',
                maxWidth: '700px',
                minWidth: '600px',
                minHeight: '180px',
                height: 'auto'
            }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                        <Title level={4}>{tempQuestion.question}</Title>
                        <Text type="secondary">
                            {tempQuestion.type} • {tempQuestion.difficulty} • {tempQuestion.timeLimit}s
                        </Text>
                        <div style={{ fontSize: '12px', color: 'orange' }}>
                            <strong>TEMPORARY: Using hardcoded options (original options missing)</strong>
                        </div>
                    </div>

                    <Radio.Group
                        onChange={handleOptionChange}
                        value={selectedOption}
                        disabled={disabled || loading}
                        style={{ width: '100%' }}
                    >
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {tempOptions.map((option) => (
                                <Radio
                                    key={option.id}
                                    value={option.id}
                                    style={{
                                        width: '100%',
                                        minHeight: '48px',
                                        padding: spacing.sm,
                                        borderRadius: 8,
                                        border: `1px solid ${colors.neutral[200]}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        minWidth: '300px' // Fixed minimum width for consistency
                                    }}
                                >
                                    <Space style={{ width: '100%' }}>
                                        <span style={{ flex: 1, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                                            {option.text}
                                        </span>
                                    </Space>
                                </Radio>
                            ))}
                        </Space>
                    </Radio.Group>

                    {!showResult && (
                        <Button
                            type="primary"
                            size="large"
                            onClick={handleSubmit}
                            loading={loading}
                            disabled={disabled || !selectedOption}
                            style={{ width: '100%' }}
                        >
                            Submit Answer (TEMP)
                        </Button>
                    )}
                </Space>
            </Card>
        );
    }

    return (
        <Card style={{
            marginBottom: spacing.lg,
            width: '100%',
            maxWidth: '700px',
            minWidth: '600px',
            minHeight: '180px',
            height: 'auto'
        }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                    <Title level={4}>{question.question}</Title>
                    <Text type="secondary">
                        {question.type} • {question.difficulty} • {question.timeLimit}s
                    </Text>
                </div>

                {/* Debug info */}
                <div style={{ fontSize: '12px', color: colors.neutral[500] }}>
                    Debug: Options count: {question.options?.length || 0}
                </div>

                <Radio.Group
                    onChange={handleOptionChange}
                    value={selectedOption}
                    disabled={disabled || loading}
                    style={{ width: '100%' }}
                >
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        {question.options && question.options.length > 0 ? question.options.map((option) => (
                            <Radio
                                key={option.id}
                                value={option.id}
                                style={{
                                    width: '100%',
                                    minHeight: '48px',
                                    padding: spacing.sm,
                                    borderRadius: 8,
                                    border: `1px solid ${colors.neutral[200]}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    minWidth: '300px', // Fixed minimum width for consistency
                                    ...getOptionStyle(option.id)
                                }}
                            >
                                <Space style={{ width: '100%' }}>
                                    {getOptionIcon(option.id)}
                                    <span style={{ flex: 1, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
                                        {option.text}
                                    </span>
                                </Space>
                            </Radio>
                        )) : (
                            <div style={{ padding: spacing.md, textAlign: 'center', color: colors.neutral[500] }}>
                                No options available for this question
                                <br />
                                <small>Question ID: {question.id}</small>
                                <br />
                                <small>Options: {JSON.stringify(question.options)}</small>
                            </div>
                        )}
                    </Space>
                </Radio.Group>

                {!showResult && (
                    <Button
                        type="primary"
                        size="large"
                        onClick={handleSubmit}
                        loading={loading}
                        disabled={disabled || !selectedOption}
                        style={{ width: '100%' }}
                    >
                        Submit Answer
                    </Button>
                )}
            </Space>
        </Card>
    );
};

export default MultipleChoiceQuestion;
