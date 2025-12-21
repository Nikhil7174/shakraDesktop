// src/components/interview/InterviewCompletionModal.tsx
import React, { useState, useEffect } from 'react';
import { Modal, Typography, Space, Button, Progress, App } from 'antd';
import { CheckCircleOutlined, TrophyOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { colors, spacing } from '../../styles';
import { useInterview } from '../../hooks/api/useInterview';
import type { InterviewSession } from '../../types';
import type { RootState } from '../../store';
// import SessionManager from '../../services/SessionManager'; // No longer needed

const { Title, Paragraph } = Typography;

interface InterviewCompletionModalProps {
    visible: boolean;
    session: InterviewSession;
    onComplete: () => void;
    onSaveResults: (summary: any) => Promise<void>;
    onSaveSuccess?: () => void; // Callback when save is successful
}

export const InterviewCompletionModal: React.FC<InterviewCompletionModalProps> = ({
    visible,
    session,
    onComplete,
    onSaveResults,
    onSaveSuccess
}) => {
    const { notification } = App.useApp();
    const [isSaving, setIsSaving] = useState(false);
    const resumeData = useSelector((state: RootState) => state.interview.resumeData);
    const { user } = useSelector((state: RootState) => state.auth);
    const [saveProgress, setSaveProgress] = useState(0);
    const [hasTriggeredCallback, setHasTriggeredCallback] = useState(false);
    const { validateCode } = useInterview();

    useEffect(() => {
        if (visible) {
            handleSaveAndComplete();
        }
    }, [visible]);

    const createCompleteSummary = async () => {
        if (!session) return null;

        const answers = session.answers || [];
        const totalQuestions = session.questions?.length || 0;

        // Validate coding questions before calculating correct answers
        const validatedAnswers = await Promise.all(answers.map(async (answer) => {
            const question = session.questions?.find(q => q.id === answer.questionId);
            if (!question || question.type !== 'coding') {
                return answer; // Return as-is for non-coding questions
            }

            // For coding questions, validate the code
            if (answer.code && answer.code.trim().length > 0 && answer.code !== 'timeout') {
                try {
                    const validationResult = await validateCode(question.id, answer.code);

                    // Update the answer with validation results
                    return {
                        ...answer,
                        isCorrect: validationResult.isCorrect,
                        testResults: validationResult.testResults
                    };
                } catch (error) {
                    console.error('Code validation failed:', error);
                    return {
                        ...answer,
                        isCorrect: false,
                        testResults: []
                    };
                }
            } else {
                // No code submitted or timeout
                return {
                    ...answer,
                    isCorrect: false,
                    testResults: []
                };
            }
        }));

        // Calculate correct answers using validated results
        const correctAnswers = validatedAnswers.filter(answer => {
            const question = session.questions?.find(q => q.id === answer.questionId);
            if (!question) return false;

            if (question.type === 'coding') {
                // For coding questions, use the validated isCorrect value
                return answer.isCorrect === true;
            } else {
                // For MCQ questions, compare selectedOptionId with correctAnswerId
                return answer.selectedOptionId === question.correctAnswerId;
            }
        }).length;

        const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
        const totalTimeSpent = answers.reduce((total, answer) => total + (answer.timeTaken || 0), 0);
        const averageTimePerQuestion = answers.length > 0 ? Math.round(totalTimeSpent / answers.length) : 0;

        // Generate feedback
        const strengths = score >= 80 ? ['Excellent technical knowledge', 'Strong problem-solving skills'] :
            score >= 60 ? ['Good understanding of core concepts', 'Solid technical foundation'] :
                ['Willingness to learn and improve'];

        const areasForImprovement = score < 60 ? ['Review fundamental concepts', 'Practice more technical questions'] :
            score < 80 ? ['Focus on advanced topics', 'Improve time management'] :
                ['Continue practicing to maintain skills'];

        const overallFeedback = score >= 90 ?
            `Outstanding performance! You answered ${correctAnswers} out of ${totalQuestions} questions correctly, demonstrating excellent technical knowledge.` :
            score >= 80 ?
                `Great job! You scored ${score}% with ${correctAnswers} correct answers out of ${totalQuestions}.` :
                score >= 60 ?
                    `Good effort! You scored ${score}% with ${correctAnswers} correct answers out of ${totalQuestions}.` :
                    `You completed the interview with ${correctAnswers} correct answers out of ${totalQuestions} (${score}%).`;

        // Create detailed answers array using validated answers
        const detailedAnswers = session.questions?.map((question) => {
            const answer = validatedAnswers.find(a => a.questionId === question.id);

            let isCorrect;
            let userAnswer;
            let correctAnswer;

            if (question.type === 'coding') {
                // Handle coding questions with validated results
                isCorrect = answer?.isCorrect === true;
                userAnswer = answer?.code || 'No code submitted';
                correctAnswer = 'Code solution';
            } else {
                // Handle MCQ questions
                isCorrect = answer?.selectedOptionId === question.correctAnswerId;
                userAnswer = answer?.answer || 'No answer';
                correctAnswer = question.correctAnswerId || 'Not specified';
            }

            return {
                questionId: question.id,
                question: question.question,
                userAnswer: userAnswer,
                correctAnswer: correctAnswer,
                isCorrect: isCorrect,
                timeTaken: answer?.timeTaken || 0
            };
        }) || [];

        const summary = {
            // Session Information
            sessionId: session.sessionId,
            interviewLinkId: session.interviewLinkId, // Include the interview link ID
            candidateId: session.candidateId,
            candidateName: resumeData?.name || 'Unknown',
            candidateEmail: user?.email || resumeData?.email || 'unknown@example.com',
            candidatePhone: resumeData?.phone || '',
            completedAt: new Date().toISOString(),
            startTime: session.startTime || new Date().toISOString(),
            endTime: new Date(),
            duration: Date.now() - new Date(session.startTime).getTime(),

            // Performance Metrics
            totalQuestions: totalQuestions,
            correctAnswers: correctAnswers,
            incorrectAnswers: totalQuestions - correctAnswers,
            score: score,
            timeSpent: totalTimeSpent,
            averageTimePerQuestion: averageTimePerQuestion,

            // Analysis
            strengths: strengths,
            areasForImprovement: areasForImprovement,
            overallFeedback: overallFeedback,

            // Detailed Results
            detailedAnswers: detailedAnswers,

            // Question Analysis
            questionAnalysis: {
                easyQuestions: session.questions?.filter(q => q.difficulty === 'easy').length || 0,
                mediumQuestions: session.questions?.filter(q => q.difficulty === 'medium').length || 0,
                hardQuestions: session.questions?.filter(q => q.difficulty === 'hard').length || 0,
                correctByDifficulty: {
                    easy: detailedAnswers.filter(a => {
                        const q = session.questions?.find(q => q.id === a.questionId);
                        return q?.difficulty === 'easy' && a.isCorrect;
                    }).length,
                    medium: detailedAnswers.filter(a => {
                        const q = session.questions?.find(q => q.id === a.questionId);
                        return q?.difficulty === 'medium' && a.isCorrect;
                    }).length,
                    hard: detailedAnswers.filter(a => {
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

    const handleSaveAndComplete = async () => {
        setIsSaving(true);
        setSaveProgress(0);

        try {
            // Simulate progress
            const progressInterval = setInterval(() => {
                setSaveProgress(prev => {
                    if (prev >= 90) {
                        clearInterval(progressInterval);
                        return 90;
                    }
                    return prev + 10;
                });
            }, 200);

            // Create and save summary
            const summary = await createCompleteSummary();
            if (summary) {
                // DEBUG: Log client-side data being sent
                console.log('=== CLIENT SIDE DEBUG ===');
                console.log('About to send interview summary to server:');
                console.log('Summary data:', JSON.stringify(summary, null, 2));
                console.log('Candidate Name:', summary.candidateName);
                console.log('Candidate Email:', summary.candidateEmail);
                console.log('Session ID:', summary.sessionId);
                console.log('Score:', summary.score);
                console.log('=== END CLIENT SIDE DEBUG ===');

                await onSaveResults(summary);

                // Complete progress
                setSaveProgress(100);
                clearInterval(progressInterval);

                window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                localStorage.setItem('dashboard-needs-refresh', Date.now().toString());

                // Success notification will be handled by the calling component
                // No need to show notification here to avoid duplicates
                
                // Call the success callback if provided (only once)
                if (onSaveSuccess && !hasTriggeredCallback) {
                    setHasTriggeredCallback(true);
                    onSaveSuccess();
                }

                // Mark interview as inactive - this should be handled by useSessionManager
                // SessionManager.setInterviewActive(false);

                // Don't auto-close - wait for user to click button
            }
        } catch (error) {
            console.error('Error saving results:', error);
            notification.error({
                message: 'Save Failed',
                description: 'Failed to save your interview results. Please try again.'
            });
        } finally {
            setIsSaving(false);
        }
    };


    return (
        <Modal
            open={visible}
            closable={false}
            maskClosable={false}
            footer={null}
            centered
            width={600}
            style={{ textAlign: 'center' }}
        >
            <Space direction="vertical" size="large" style={{ width: '100%', padding: spacing.lg }}>
                {/* Success Icon */}
                <div style={{ fontSize: 64, color: colors.success.main }}>
                    {isSaving ? <LoadingOutlined spin /> : <CheckCircleOutlined />}
                </div>

                {/* Title */}
                <Title level={2} style={{ margin: 0, color: colors.success.main }}>
                    {isSaving ? 'Saving Your Results...' : 'Interview Completed!'}
                </Title>

                {/* Message */}
                <Paragraph style={{ fontSize: 16, margin: 0 }}>
                    {isSaving ?
                        'Thank you for completing the interview. We are saving your results...' :
                        'Thank you for completing the interview! Your results have been saved successfully. Click the button below to return to the home page.'
                    }
                </Paragraph>

                {/* Progress Bar */}
                {isSaving && (
                    <div style={{ width: '100%' }}>
                        <Progress
                            percent={saveProgress}
                            strokeColor={colors.success.main}
                            showInfo={true}
                            format={(percent) => `${percent}%`}
                        />
                        <Paragraph type="secondary" style={{ marginTop: spacing.sm }}>
                            Saving your interview results...
                        </Paragraph>
                    </div>
                )}

                {/* Quick Stats */}
                {!isSaving && session && (
                    <div style={{
                        backgroundColor: colors.background.secondary,
                        padding: spacing.md,
                        borderRadius: 8,
                        border: `1px solid ${colors.neutral[200]}`
                    }}>
                        <Space direction="vertical" size="small">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
                                <TrophyOutlined style={{ color: colors.warning.main }} />
                                <span style={{ fontWeight: 'bold' }}>
                                    Score: {(() => {
                                        const answers = session.answers || [];
                                        const correctAnswers = answers.filter(answer => {
                                            const question = session.questions?.find(q => q.id === answer.questionId);
                                            return question && answer.selectedOptionId === question.correctAnswerId;
                                        }).length;
                                        const totalQuestions = session.questions?.length || 0;
                                        return totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
                                    })()}%
                                </span>
                            </div>
                            <div style={{ fontSize: 14, color: colors.neutral[600] }}>
                                {(() => {
                                    const answers = session.answers || [];
                                    const correctAnswers = answers.filter(answer => {
                                        const question = session.questions?.find(q => q.id === answer.questionId);
                                        return question && answer.selectedOptionId === question.correctAnswerId;
                                    }).length;
                                    const totalQuestions = session.questions?.length || 0;
                                    return `${correctAnswers} out of ${totalQuestions} questions correct`;
                                })()}
                            </div>
                        </Space>
                    </div>
                )}

                {/* Action Button */}
                <Button
                    type="primary"
                    size="large"
                    onClick={onComplete}
                    style={{ minWidth: 200 }}
                    disabled={isSaving}
                >
                    {isSaving ? 'Saving...' : 'Return to Home'}
                </Button>
            </Space>
        </Modal>
    );
};

export default InterviewCompletionModal;
