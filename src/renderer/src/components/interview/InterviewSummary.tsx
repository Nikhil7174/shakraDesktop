// src/components/interview/InterviewSummary.tsx
import React, { useState, useEffect } from 'react';
import { Card, Typography, Space, Button, Progress, Collapse, Statistic, Row, Col, Tag, App } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, TrophyOutlined, FileTextOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { colors, spacing } from '../../styles';
import { CollapsibleChat } from './CollapsibleChat';
import type { InterviewSession, ChatMessage } from '../../types';
import type { RootState } from '../../store';

const { Title, Paragraph, Text } = Typography;

interface InterviewSummaryProps {
    session: InterviewSession;
    onStartNew: () => void;
    onSaveResults?: (results: any) => Promise<void>;
    chatMessages?: ChatMessage[];
}

interface InterviewResults {
    totalQuestions: number;
    correctAnswers: number;
    score: number;
    timeSpent: number;
    averageTimePerQuestion: number;
    strengths: string[];
    areasForImprovement: string[];
    overallFeedback: string;
    detailedAnswers: Array<{
        questionId: string;
        question: string;
        userAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
        timeTaken: number;
    }>;
}

export const InterviewSummary: React.FC<InterviewSummaryProps> = ({
    session,
    onStartNew,
    onSaveResults,
    chatMessages = []
}) => {
    const { notification } = App.useApp();
    const [results, setResults] = useState<InterviewResults | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isChatExpanded, setIsChatExpanded] = useState(false);
    const [showSummaryJson, setShowSummaryJson] = useState(false);
    const resumeData = useSelector((state: RootState) => state.interview.resumeData);
    const { user } = useSelector((state: RootState) => state.auth);

    useEffect(() => {
        if (session) {
            calculateResults();
        }
    }, [session]);

    const calculateResults = () => {
        const totalQuestions = session.questions?.length || 0;
        const answers = session.answers || [];

        // Calculate correct answers by comparing selectedOptionId with correctAnswerId
        const correctAnswers = answers.filter(answer => {
            const question = session.questions?.find(q => q.id === answer.questionId);
            return question && answer.selectedOptionId === question.correctAnswerId;
        }).length;

        const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
        const totalTimeSpent = answers.reduce((total, answer) => total + (answer.timeTaken || 0), 0);
        const averageTimePerQuestion = answers.length > 0 ? Math.round(totalTimeSpent / answers.length) : 0;

        // Generate strengths and areas for improvement based on performance
        const strengths = generateStrengths(score, answers);
        const areasForImprovement = generateAreasForImprovement(score, answers);
        const overallFeedback = generateOverallFeedback(score, totalQuestions, correctAnswers);

        // Create detailed answers array with proper validation
        const detailedAnswers = session.questions?.map((question, index) => {
            const answer = answers[index];
            const isCorrect = answer?.selectedOptionId === question.correctAnswerId;

            return {
                questionId: question.id,
                question: question.question,
                userAnswer: answer?.answer || 'No answer',
                correctAnswer: question.correctAnswerId || 'Not specified',
                isCorrect: isCorrect,
                timeTaken: answer?.timeTaken || 0
            };
        }) || [];

        setResults({
            totalQuestions,
            correctAnswers,
            score,
            timeSpent: totalTimeSpent,
            averageTimePerQuestion,
            strengths,
            areasForImprovement,
            overallFeedback,
            detailedAnswers
        });
    };

    const generateStrengths = (score: number, answers: any[]): string[] => {
        const strengths: string[] = [];

        if (score >= 80) {
            strengths.push('Excellent technical knowledge');
            strengths.push('Strong problem-solving skills');
        } else if (score >= 60) {
            strengths.push('Good understanding of core concepts');
            strengths.push('Solid technical foundation');
        } else {
            strengths.push('Willingness to learn and improve');
        }

        const fastAnswers = answers.filter(answer => answer.timeTaken < 30).length;
        if (fastAnswers > answers.length / 2) {
            strengths.push('Quick decision-making ability');
        }

        return strengths;
    };

    const generateAreasForImprovement = (score: number, answers: any[]): string[] => {
        const areas: string[] = [];

        if (score < 60) {
            areas.push('Review fundamental concepts');
            areas.push('Practice more technical questions');
        } else if (score < 80) {
            areas.push('Focus on advanced topics');
            areas.push('Improve time management');
        }

        const slowAnswers = answers.filter(answer => answer.timeTaken > 60).length;
        if (slowAnswers > answers.length / 2) {
            areas.push('Work on response time');
        }

        return areas;
    };

    const generateOverallFeedback = (score: number, totalQuestions: number, correctAnswers: number): string => {
        if (score >= 90) {
            return `Outstanding performance! You answered ${correctAnswers} out of ${totalQuestions} questions correctly, demonstrating excellent technical knowledge and problem-solving skills. You're well-prepared for technical interviews.`;
        } else if (score >= 80) {
            return `Great job! You scored ${score}% with ${correctAnswers} correct answers out of ${totalQuestions}. You show strong technical understanding with room for minor improvements.`;
        } else if (score >= 60) {
            return `Good effort! You scored ${score}% with ${correctAnswers} correct answers out of ${totalQuestions}. Focus on strengthening your technical knowledge and practice more.`;
        } else {
            return `You completed the interview with ${correctAnswers} correct answers out of ${totalQuestions} (${score}%). Consider reviewing fundamental concepts and practicing more technical questions to improve your performance.`;
        }
    };

    const createCompleteSummary = () => {
        if (!results || !session) return null;

        const summary = {
            // Session Information
            sessionId: session.sessionId,
            interviewLinkId: session.interviewLinkId, // Include the interview link ID
            candidateId: session.candidateId,
            candidateName: resumeData?.name || 'Unknown',
            candidateEmail: user?.email || resumeData?.email || 'unknown@example.com',
            candidatePhone: resumeData?.phone || '',
            completedAt: new Date().toISOString(),
            startTime: session.startTime,
            endTime: new Date(),
            duration: Date.now() - new Date(session.startTime).getTime(),

            // Performance Metrics
            totalQuestions: results.totalQuestions,
            correctAnswers: results.correctAnswers,
            incorrectAnswers: results.totalQuestions - results.correctAnswers,
            score: results.score,
            timeSpent: results.timeSpent,
            averageTimePerQuestion: results.averageTimePerQuestion,

            // Analysis
            strengths: results.strengths,
            areasForImprovement: results.areasForImprovement,
            overallFeedback: results.overallFeedback,

            // Detailed Results
            detailedAnswers: results.detailedAnswers,

            // Question Analysis
            questionAnalysis: {
                easyQuestions: session.questions?.filter(q => q.difficulty === 'easy').length || 0,
                mediumQuestions: session.questions?.filter(q => q.difficulty === 'medium').length || 0,
                hardQuestions: session.questions?.filter(q => q.difficulty === 'hard').length || 0,
                correctByDifficulty: {
                    easy: results.detailedAnswers.filter(a => {
                        const q = session.questions?.find(q => q.id === a.questionId);
                        return q?.difficulty === 'easy' && a.isCorrect;
                    }).length,
                    medium: results.detailedAnswers.filter(a => {
                        const q = session.questions?.find(q => q.id === a.questionId);
                        return q?.difficulty === 'medium' && a.isCorrect;
                    }).length,
                    hard: results.detailedAnswers.filter(a => {
                        const q = session.questions?.find(q => q.id === a.questionId);
                        return q?.difficulty === 'hard' && a.isCorrect;
                    }).length
                }
            },

            // Candidate Information
            candidateInfo: {
                name: session.candidateId || 'Unknown',
                email: session.candidateId || 'Unknown'
            }
        };

        return summary;
    };

    const handleSaveResults = async () => {
        if (!results || !onSaveResults) return;

        setIsSaving(true);
        try {
            const completeSummary = createCompleteSummary();
            if (completeSummary) {
                await onSaveResults(completeSummary);

                notification.success({
                    message: 'Results Saved',
                    description: 'Your interview results have been saved successfully!'
                });
            }
        } catch (error) {
            notification.error({
                message: 'Save Failed',
                description: 'Failed to save your interview results. Please try again.'
            });
        } finally {
            setIsSaving(false);
        }
    };

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
    };

    if (!results) {
        return (
            <Card style={{ textAlign: 'center', padding: spacing.xl }}>
                <Text>Calculating your results...</Text>
            </Card>
        );
    }

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                {/* Header */}
                <Card>
                    <div style={{ textAlign: 'center' }}>
                        <TrophyOutlined style={{ fontSize: 48, color: colors.primary.main, marginBottom: spacing.md }} />
                        <Title level={2}>Interview Complete!</Title>
                        <Paragraph style={{ fontSize: 16 }}>
                            Congratulations on completing your AI interview session. Here's your detailed performance summary.
                        </Paragraph>
                    </div>
                </Card>

                {/* Score Overview */}
                <Card>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12} md={6}>
                            <Statistic
                                title="Overall Score"
                                value={results.score}
                                suffix="%"
                                valueStyle={{ color: results.score >= 80 ? colors.success.main : results.score >= 60 ? colors.warning.main : colors.error.main }}
                                prefix={<TrophyOutlined />}
                            />
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <Statistic
                                title="Correct Answers"
                                value={results.correctAnswers}
                                suffix={`/ ${results.totalQuestions}`}
                                prefix={<CheckCircleOutlined />}
                            />
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <Statistic
                                title="Total Time"
                                value={formatTime(results.timeSpent)}
                                prefix={<ClockCircleOutlined />}
                            />
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                            <Statistic
                                title="Avg. Time/Question"
                                value={formatTime(results.averageTimePerQuestion)}
                                prefix={<ClockCircleOutlined />}
                            />
                        </Col>
                    </Row>
                </Card>

                {/* Progress Bar */}
                <Card>
                    <Title level={4}>Performance Breakdown</Title>
                    <Progress
                        percent={results.score}
                        strokeColor={{
                            '0%': colors.error.main,
                            '50%': colors.warning.main,
                            '100%': colors.success.main,
                        }}
                        format={(percent) => `${percent}%`}
                    />
                </Card>

                {/* Feedback Section */}
                <Card>
                    <Title level={4}>Overall Feedback</Title>
                    <Paragraph style={{ fontSize: 16, lineHeight: 1.6 }}>
                        {results.overallFeedback}
                    </Paragraph>
                </Card>

                {/* Strengths and Areas for Improvement */}
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                        <Card>
                            <Title level={4} style={{ color: colors.success.main }}>Strengths</Title>
                            <Space direction="vertical" style={{ width: '100%' }}>
                                {results.strengths.map((strength, index) => (
                                    <Tag key={index} color="green" style={{ marginBottom: spacing.xs }}>
                                        <CheckCircleOutlined /> {strength}
                                    </Tag>
                                ))}
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} md={12}>
                        <Card>
                            <Title level={4} style={{ color: colors.warning.main }}>Areas for Improvement</Title>
                            <Space direction="vertical" style={{ width: '100%' }}>
                                {results.areasForImprovement.map((area, index) => (
                                    <Tag key={index} color="orange" style={{ marginBottom: spacing.xs }}>
                                        {area}
                                    </Tag>
                                ))}
                            </Space>
                        </Card>
                    </Col>
                </Row>

                {/* Detailed Answers */}
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
                        <Title level={4}>Detailed Answers</Title>
                        <Button
                            type="text"
                            icon={isChatExpanded ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            onClick={() => setIsChatExpanded(!isChatExpanded)}
                        >
                            {isChatExpanded ? 'Hide Details' : 'Show Details'}
                        </Button>
                    </div>

                    <Collapse
                        activeKey={isChatExpanded ? ['1'] : []}
                        items={[
                            {
                                key: '1',
                                label: 'Question-by-Question Breakdown',
                                children: (
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        {results.detailedAnswers.map((item, index) => (
                                            <Card key={item.questionId} size="small">
                                                <div style={{ marginBottom: spacing.sm }}>
                                                    <Text strong>Question {index + 1}:</Text>
                                                    <Paragraph style={{ margin: 0, marginTop: spacing.xs }}>
                                                        {item.question}
                                                    </Paragraph>
                                                </div>
                                                <Row gutter={[16, 8]}>
                                                    <Col xs={24} sm={12}>
                                                        <Text type="secondary">Your Answer:</Text>
                                                        <div style={{ marginTop: spacing.xs }}>
                                                            <Tag color={item.isCorrect ? 'green' : 'red'}>
                                                                {item.userAnswer}
                                                            </Tag>
                                                        </div>
                                                    </Col>
                                                    <Col xs={24} sm={12}>
                                                        <Text type="secondary">Time Taken:</Text>
                                                        <div style={{ marginTop: spacing.xs }}>
                                                            <Text>{formatTime(item.timeTaken)}</Text>
                                                        </div>
                                                    </Col>
                                                </Row>
                                            </Card>
                                        ))}
                                    </Space>
                                )
                            }
                        ]}
                    />
                </Card>

                {/* Collapsible Chat */}
                <CollapsibleChat
                    session={session}
                    chatMessages={chatMessages}
                />

                {/* Summary JSON Debug View */}
                {showSummaryJson && (
                    <Card>
                        <Title level={4}>Complete Summary JSON</Title>
                        <pre style={{
                            backgroundColor: colors.background.secondary,
                            padding: spacing.md,
                            borderRadius: 8,
                            overflow: 'auto',
                            maxHeight: '400px',
                            fontSize: '12px'
                        }}>
                            {JSON.stringify(createCompleteSummary(), null, 2)}
                        </pre>
                    </Card>
                )}

                {/* Action Buttons */}
                <Card>
                    <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Button
                            type="primary"
                            size="large"
                            onClick={onStartNew}
                            style={{ minWidth: 200 }}
                        >
                            Start New Interview
                        </Button>
                        {onSaveResults && (
                            <Button
                                type="default"
                                size="large"
                                loading={isSaving}
                                onClick={handleSaveResults}
                                style={{ minWidth: 200 }}
                                icon={<FileTextOutlined />}
                            >
                                {isSaving ? 'Saving...' : 'Save Results'}
                            </Button>
                        )}
                        <Button
                            type="dashed"
                            size="large"
                            onClick={() => setShowSummaryJson(!showSummaryJson)}
                            style={{ minWidth: 200 }}
                        >
                            {showSummaryJson ? 'Hide JSON' : 'Show JSON'}
                        </Button>
                    </div>
                </Card>
            </Space>
        </div>
    );
};

export default InterviewSummary;
