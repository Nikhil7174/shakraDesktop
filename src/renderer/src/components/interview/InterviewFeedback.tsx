// src/components/interview/InterviewFeedback.tsx
import React, { useState } from 'react';
import { Modal, Typography, Space, Button, Rate, Input, Radio, App } from 'antd';
import { MessageOutlined, StarOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';
import { API_BASE_URL } from '../../constants/api';
import type { InterviewSession } from '../../types';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

interface InterviewFeedbackProps {
    visible: boolean;
    session: InterviewSession;
    onComplete: () => void;
    onSkip?: () => void;
}

export const InterviewFeedback: React.FC<InterviewFeedbackProps> = ({
    visible,
    session,
    onComplete,
    onSkip
}) => {
    const { notification } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [rating, setRating] = useState<number>(0);
    const [platformRating, setPlatformRating] = useState<number>(0);
    const [overallExperience, setOverallExperience] = useState<string>('');
    const [technicalQuestionsQuality, setTechnicalQuestionsQuality] = useState<string>('');
    const [suggestions, setSuggestions] = useState<string>('');
    const [wouldRecommend, setWouldRecommend] = useState<boolean | undefined>(undefined);

    const handleSubmit = async () => {
        if (!rating) {
            notification.warning({
                message: 'Rating Required',
                description: 'Please provide an overall rating for the interview experience.'
            });
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/interview/feedback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: session.sessionId,
                    rating,
                    overallExperience: overallExperience || undefined,
                    technicalQuestionsQuality: technicalQuestionsQuality || undefined,
                    interviewPlatformRating: platformRating || undefined,
                    suggestions: suggestions || undefined,
                    wouldRecommend: wouldRecommend !== undefined ? wouldRecommend : undefined,
                }),
            });

            const data = await response.json();

            if (data.success) {
                notification.success({
                    message: 'Thank You!',
                    description: 'Your feedback has been submitted successfully.'
                });
                onComplete();
            } else {
                throw new Error(data.error || 'Failed to submit feedback');
            }
        } catch (error) {
            console.error('Error submitting feedback:', error);
            notification.error({
                message: 'Submission Failed',
                description: error instanceof Error ? error.message : 'Failed to submit feedback. Please try again.'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSkip = () => {
        if (onSkip) {
            onSkip();
        } else {
            onComplete();
        }
    };

    return (
        <Modal
            open={visible}
            closable={false}
            maskClosable={false}
            footer={null}
            centered
            width={700}
            style={{ textAlign: 'center' }}
        >
            <Space direction="vertical" size="large" style={{ width: '100%', padding: spacing.lg, textAlign: 'left' }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: spacing.md }}>
                    <Title level={3} style={{ margin: 0 }}>
                        Share Your Feedback
                    </Title>
                    <Paragraph type="secondary" style={{ marginTop: spacing.xs }}>
                        Your feedback helps us improve the interview experience
                    </Paragraph>
                </div>

                {/* Overall Rating */}
                <div>
                    <Text strong style={{ fontSize: 16, display: 'block', marginBottom: spacing.sm }}>
                        Overall Interview Experience <Text type="danger">*</Text>
                    </Text>
                    <Rate
                        value={rating}
                        onChange={setRating}
                        style={{ fontSize: 28 }}
                        allowClear={false}
                    />
                    <div style={{ marginTop: spacing.xs }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {rating === 0 && 'Please rate your overall experience'}
                            {rating === 1 && 'Poor'}
                            {rating === 2 && 'Fair'}
                            {rating === 3 && 'Good'}
                            {rating === 4 && 'Very Good'}
                            {rating === 5 && 'Excellent'}
                        </Text>
                    </div>
                </div>

                {/* Overall Experience Text */}
                <div>
                    <Text strong style={{ fontSize: 14, display: 'block', marginBottom: spacing.sm }}>
                        Tell us about your experience
                    </Text>
                    <TextArea
                        value={overallExperience}
                        onChange={(e) => setOverallExperience(e.target.value)}
                        placeholder="How was your overall interview experience? What did you like or dislike?"
                        rows={4}
                        maxLength={500}
                        showCount
                    />
                </div>

                {/* Technical Questions Quality */}
                <div>
                    <Text strong style={{ fontSize: 14, display: 'block', marginBottom: spacing.sm }}>
                        Technical Questions Quality
                    </Text>
                    <TextArea
                        value={technicalQuestionsQuality}
                        onChange={(e) => setTechnicalQuestionsQuality(e.target.value)}
                        placeholder="How would you rate the quality and relevance of the technical questions?"
                        rows={3}
                        maxLength={300}
                        showCount
                    />
                </div>

                {/* Platform Rating */}
                <div>
                    <Text strong style={{ fontSize: 14, display: 'block', marginBottom: spacing.sm }}>
                        Interview Platform Rating
                    </Text>
                    <Space>
                        <Rate
                            value={platformRating}
                            onChange={setPlatformRating}
                            style={{ fontSize: 20 }}
                            allowClear={false}
                        />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {platformRating === 0 && 'Rate the platform'}
                            {platformRating > 0 && `${platformRating} out of 5`}
                        </Text>
                    </Space>
                </div>

                {/* Suggestions */}
                <div>
                    <Text strong style={{ fontSize: 14, display: 'block', marginBottom: spacing.sm }}>
                        Suggestions for Improvement
                    </Text>
                    <TextArea
                        value={suggestions}
                        onChange={(e) => setSuggestions(e.target.value)}
                        placeholder="Any suggestions or ideas to improve the interview process?"
                        rows={3}
                        maxLength={300}
                        showCount
                    />
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.lg }}>
                    <Button
                        onClick={handleSkip}
                        disabled={loading}
                    >
                        Skip
                    </Button>
                    <Button
                        type="primary"
                        size="large"
                        onClick={handleSubmit}
                        loading={loading}
                        icon={<StarOutlined />}
                        disabled={!rating}
                        style={{ minWidth: 150 }}
                    >
                        Submit Feedback
                    </Button>
                </div>
            </Space>
        </Modal>
    );
};

export default InterviewFeedback;








