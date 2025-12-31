// src/components/interview/InterviewCompletionModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Modal, Typography, Space, Progress, App } from 'antd';
import { CheckCircleOutlined, TrophyOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { colors, spacing, borderRadius, typography } from '../../styles';
import { useInterview } from '../../hooks/api/useInterview';
import type { InterviewSession } from '../../types';
import type { RootState } from '../../store';
// import SessionManager from '../../services/SessionManager'; // No longer needed

const { Title, Paragraph, Text } = Typography;

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
    const [hasAutoAdvanced, setHasAutoAdvanced] = useState(false);
    const autoAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const { validateCode } = useInterview();

    useEffect(() => {
        if (visible) {
            handleSaveAndComplete();
        }
    }, [visible]);

    // Auto-advance to feedback modal after 2 seconds when saving is complete
    useEffect(() => {
        // Check if we should auto-advance: visible, not saving, progress complete, and haven't advanced yet
        const shouldAdvance = visible && !isSaving && saveProgress === 100 && !hasAutoAdvanced;
        
        if (shouldAdvance) {
            console.log('🔄 [CompletionModal] Conditions met for auto-advance:', {
                visible,
                isSaving,
                saveProgress,
                hasAutoAdvanced
            });
            console.log('🔄 [CompletionModal] Auto-advancing to feedback form in 2 seconds...');
            setHasAutoAdvanced(true);
            const timer = setTimeout(() => {
                console.log('🔄 [CompletionModal] Auto-advancing now...');
                onComplete();
            }, 2000); // 2 seconds delay
            
            return () => {
                console.log('🔄 [CompletionModal] Cleaning up auto-advance timer');
                clearTimeout(timer);
            };
        }
        
        return undefined;
    }, [visible, isSaving, saveProgress, hasAutoAdvanced, onComplete]);

    // Reset auto-advance flag when modal closes
    useEffect(() => {
        if (!visible) {
            setHasAutoAdvanced(false);
            // Clear timer if modal closes
            if (autoAdvanceTimerRef.current) {
                clearTimeout(autoAdvanceTimerRef.current);
                autoAdvanceTimerRef.current = null;
            }
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

                // Set isSaving to false AFTER setting progress to 100
                setIsSaving(false);
                
                // Trigger auto-advance after 2 seconds
                console.log('🔄 [CompletionModal] Saving complete, will auto-advance in 2 seconds...');
                
                // Clear any existing timer
                if (autoAdvanceTimerRef.current) {
                    clearTimeout(autoAdvanceTimerRef.current);
                }
                
                autoAdvanceTimerRef.current = setTimeout(() => {
                    console.log('🔄 [CompletionModal] Auto-advancing to feedback form now...');
                    setHasAutoAdvanced(true);
                    autoAdvanceTimerRef.current = null;
                    onComplete();
                }, 2000);
            }
        } catch (error) {
            console.error('Error saving results:', error);
            notification.error({
                message: 'Save Failed',
                description: 'Failed to save your interview results. Please try again.'
            });
            setIsSaving(false);
        }
    };


    // Calculate score for display
    const calculateScore = () => {
        if (!session) return 0;
        const answers = session.answers || [];
        const correctAnswers = answers.filter(answer => {
            const question = session.questions?.find(q => q.id === answer.questionId);
            return question && answer.selectedOptionId === question.correctAnswerId;
        }).length;
        const totalQuestions = session.questions?.length || 0;
        return totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    };

    const score = calculateScore();
    const correctAnswers = session ? (session.answers || []).filter(answer => {
        const question = session.questions?.find(q => q.id === answer.questionId);
        return question && answer.selectedOptionId === question.correctAnswerId;
    }).length : 0;
    const totalQuestions = session?.questions?.length || 0;

    return (
        <Modal
            open={visible}
            closable={false}
            maskClosable={false}
            footer={null}
            centered
            width={560}
            styles={{
                body: {
                    padding: `${spacing.xl}px ${spacing.lg}px`,
                },
                content: {
                    borderRadius: borderRadius.xl,
                    overflow: 'hidden',
                }
            }}
        >
            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                textAlign: 'center',
                width: '100%'
            }}>
                {/* Icon Container with Animation */}
                <div style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: isSaving 
                        ? `linear-gradient(135deg, ${colors.primary.light} 0%, ${colors.primary.main} 100%)`
                        : `linear-gradient(135deg, ${colors.success.light} 0%, ${colors.success.main} 100%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: spacing.lg,
                    boxShadow: isSaving 
                        ? colors.shadows.primary 
                        : `0 8px 24px rgba(82, 196, 26, 0.2)`,
                    transition: 'all 0.3s ease',
                }}>
                    {isSaving ? (
                        <LoadingOutlined style={{ fontSize: 40, color: colors.primary.contrast }} spin />
                    ) : (
                        <CheckCircleOutlined style={{ fontSize: 40, color: colors.primary.contrast }} />
                    )}
                </div>

                {/* Title */}
                <Title 
                    level={2} 
                    style={{ 
                        margin: 0,
                        marginBottom: spacing.sm,
                        color: colors.neutral[900],
                        fontWeight: typography.fontWeight.semibold,
                        fontSize: typography.fontSize['3xl'],
                    }}
                >
                    {isSaving ? 'Saving Your Results' : 'Interview Completed!'}
                </Title>

                {/* Message */}
                <Paragraph 
                    style={{ 
                        fontSize: typography.fontSize.base,
                        color: colors.neutral[600],
                        margin: 0,
                        marginBottom: spacing.xl,
                        lineHeight: typography.lineHeight.relaxed,
                        maxWidth: 420,
                    }}
                >
                    {isSaving
                        ? 'Please wait while we save your interview results securely...'
                        : 'Your interview results have been saved successfully. Thank you for your participation!'
                    }
                </Paragraph>

                {/* Progress Bar */}
                {isSaving && (
                    <div style={{ 
                        width: '100%', 
                        maxWidth: 420,
                        marginBottom: spacing.lg 
                    }}>
                        <Progress
                            percent={saveProgress}
                            strokeColor={{
                                '0%': colors.primary.light,
                                '100%': colors.primary.main,
                            }}
                            trailColor={colors.neutral[100]}
                            showInfo={true}
                            format={(percent) => `${percent}%`}
                            strokeWidth={8}
                            style={{
                                marginBottom: spacing.sm,
                            }}
                        />
                        <Text 
                            type="secondary" 
                            style={{ 
                                fontSize: typography.fontSize.sm,
                                color: colors.neutral[500],
                            }}
                        >
                            Processing your responses...
                        </Text>
                    </div>
                )}

                {/* Stats Card */}
                {!isSaving && session && (
                    <div style={{
                        width: '100%',
                        maxWidth: 420,
                        background: `linear-gradient(135deg, ${colors.background.secondary} 0%, ${colors.background.primary} 100%)`,
                        padding: spacing.lg,
                        borderRadius: borderRadius.lg,
                        border: `1px solid ${colors.neutral[200]}`,
                        boxShadow: colors.shadows.sm,
                        marginBottom: spacing.md,
                    }}>
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                gap: spacing.sm,
                                marginBottom: spacing.xs,
                            }}>
                                <div style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: '50%',
                                    background: `linear-gradient(135deg, ${colors.warning.light} 0%, ${colors.warning.main} 100%)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 4px 12px rgba(250, 173, 20, 0.2)`,
                                }}>
                                    <TrophyOutlined style={{ 
                                        fontSize: 20, 
                                        color: colors.primary.contrast 
                                    }} />
                                </div>
                                <div>
                                    <Text style={{ 
                                        fontSize: typography.fontSize['2xl'],
                                        fontWeight: typography.fontWeight.bold,
                                        color: colors.neutral[900],
                                    }}>
                                        {score}%
                                    </Text>
                                </div>
                            </div>
                            <Text style={{ 
                                fontSize: typography.fontSize.sm,
                                color: colors.neutral[600],
                                fontWeight: typography.fontWeight.medium,
                            }}>
                                {correctAnswers} of {totalQuestions} questions answered correctly
                            </Text>
                        </Space>
                    </div>
                )}

                {/* Auto-advancing indicator */}
                {!isSaving && saveProgress === 100 && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing.sm,
                        marginTop: spacing.md,
                    }}>
                        <div style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: colors.primary.main,
                            animation: 'pulse 1.5s ease-in-out infinite',
                        }} />
                        <Text 
                            type="secondary" 
                            style={{ 
                                fontSize: typography.fontSize.sm,
                                color: colors.neutral[500],
                            }}
                        >
                            Redirecting to feedback form...
                        </Text>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% {
                        opacity: 1;
                        transform: scale(1);
                    }
                    50% {
                        opacity: 0.5;
                        transform: scale(0.9);
                    }
                }
            `}</style>
        </Modal>
    );
};

export default InterviewCompletionModal;
