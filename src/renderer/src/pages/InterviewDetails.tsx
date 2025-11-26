// src/pages/InterviewDetails.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Card,
    Button,
    Typography,
    Row,
    Col,
    Tag,
    Space,
    Descriptions,
    message,
    Spin,
    Collapse
} from 'antd';
import {
    ArrowLeftOutlined,
    TrophyOutlined,
    WarningOutlined,
    SafetyCertificateOutlined,
    SafetyOutlined,
    CheckCircleOutlined
} from '@ant-design/icons';
import { spacing } from '../styles';
import { API_BASE_URL } from '../constants/api';
import { useAuth } from '../hooks/useAuth';

const { Title, Text } = Typography;

interface Interview {
    id: number;
    session_id: string;
    candidate_name: string;
    candidate_email: string;
    candidate_phone: string;
    start_time: string;
    end_time: string;
    duration: number;
    score: number;
    total_questions: number;
    correct_answers: number;
    time_spent: number;
    strengths: string[];
    areasForImprovement: string[];
    overall_feedback: string;
    detailed_answers: any[];
    question_analysis: any[];
    cheating_detected: boolean;
    cheating_incidents: any[];
    security_agent_connected: boolean;
    created_at: string;
}

export const InterviewDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const [interview, setInterview] = useState<Interview | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInterviewDetails = async () => {
            try {
                if (!token) {
                    message.error('Authentication token not found. Please log in.');
                    navigate('/login');
                    return;
                }

                const response = await fetch(`${API_BASE_URL}/admin/interview/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });

                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        message.error('Unauthorized access. Please log in again.');
                        localStorage.removeItem('adminToken');
                        navigate('/admin');
                    } else {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                }

                const result = await response.json();
                if (result.success) {
                    setInterview(result.data);
                } else {
                    message.error('Failed to fetch interview details');
                }
            } catch (error) {
                console.error('Error fetching interview details:', error);
                message.error('Error fetching interview details');
            } finally {
                setLoading(false);
            }
        };

        if (id && token) {
            fetchInterviewDetails();
        }
    }, [id, token, navigate]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Spin size="large" />
            </div>
        );
    }

    if (!interview) {
        return (
            <div style={{ padding: spacing.xl, textAlign: 'center' }}>
                <Title level={3}>Interview not found</Title>
                <Button onClick={() => navigate(-1)}>Back to Dashboard</Button>
            </div>
        );
    }

    // Safely parse detailed_answers
    let answers: any[] = [];
    try {
        if (typeof interview.detailed_answers === 'string') {
            answers = JSON.parse(interview.detailed_answers);
        } else if (Array.isArray(interview.detailed_answers)) {
            answers = interview.detailed_answers;
        }
    } catch (error) {
        console.error('Error parsing detailed_answers:', error);
        answers = [] as any[];
    }

    return (
        <div style={{ padding: spacing.xl, background: '#fafafa', minHeight: '100vh' }}>
            {/* Header */}
            <div style={{ marginBottom: spacing.xl }}>
                <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate(-1)}
                    style={{ marginBottom: spacing.md }}
                >
                    Back
                </Button>

                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: spacing.md
                }}>
                    <div>
                        <Title level={2} style={{ margin: 0 }}>
                            {interview.candidate_name}
                        </Title>
                        <Text type="secondary">{interview.candidate_email}</Text>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
                        <Tag
                            color={interview.score >= 70 ? 'green' : interview.score >= 50 ? 'orange' : 'red'}
                            style={{ fontSize: '1.2em', padding: '5px 10px' }}
                        >
                            <TrophyOutlined style={{ marginRight: '4px' }} />
                            {interview.score}%
                        </Tag>
                        <Text type="secondary">
                            {new Date(interview.created_at).toLocaleDateString()}
                        </Text>
                    </div>
                </div>
            </div>

            {/* Candidate Information & Performance Metrics */}
            <Row gutter={[spacing.xl, spacing.xl]} style={{ marginBottom: spacing.xl }}>
                <Col xs={24} md={12}>
                    <Card title="Candidate Information" style={{ height: '100%' }}>
                        <Descriptions column={1} bordered>
                            <Descriptions.Item label="Name">{interview.candidate_name}</Descriptions.Item>
                            <Descriptions.Item label="Email">{interview.candidate_email}</Descriptions.Item>
                            <Descriptions.Item label="Phone">{interview.candidate_phone || 'N/A'}</Descriptions.Item>
                            <Descriptions.Item label="Session ID">{interview.session_id}</Descriptions.Item>
                            <Descriptions.Item label="Interview Date">{new Date(interview.created_at).toLocaleDateString()}</Descriptions.Item>
                        </Descriptions>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card title="Performance Metrics" style={{ height: '100%' }}>
                        <Descriptions column={1} bordered>
                            <Descriptions.Item label="Score">
                                <Tag color={interview.score >= 70 ? 'green' : interview.score >= 50 ? 'orange' : 'red'}>
                                    {interview.score}%
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Correct Answers">
                                {interview.correct_answers}/{interview.total_questions}
                            </Descriptions.Item>
                            <Descriptions.Item label="Time Spent">
                                {Math.round(interview.time_spent / 60)} minutes
                            </Descriptions.Item>
                            <Descriptions.Item label="Total Duration">
                                {Math.round(interview.duration / 1000 / 60)} minutes
                            </Descriptions.Item>
                        </Descriptions>
                    </Card>
                </Col>
            </Row>

            {/* Security Information */}
            <Row gutter={[spacing.xl, spacing.xl]} style={{ marginBottom: spacing.xl }}>
                <Col xs={24}>
                    <Card title="Security Information" style={{ height: '100%' }}>
                        <Row gutter={[spacing.lg, spacing.lg]}>
                            <Col xs={24} md={8}>
                                <div style={{ textAlign: 'center', padding: spacing.md }}>
                                    <div style={{ marginBottom: spacing.sm }}>
                                        {interview.security_agent_connected ? (
                                            <SafetyCertificateOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                                        ) : (
                                            <SafetyOutlined style={{ fontSize: 32, color: '#faad14' }} />
                                        )}
                                    </div>
                                    <Text strong>Security Agent</Text>
                                    <br />
                                    <Tag color={interview.security_agent_connected ? 'green' : 'orange'}>
                                        {interview.security_agent_connected ? 'Connected' : 'Not Connected'}
                                    </Tag>
                                </div>
                            </Col>
                            <Col xs={24} md={8}>
                                <div style={{ textAlign: 'center', padding: spacing.md }}>
                                    <div style={{ marginBottom: spacing.sm }}>
                                        {interview.cheating_detected ? (
                                            <WarningOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />
                                        ) : (
                                            <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                                        )}
                                    </div>
                                    <Text strong>Cheating Detection</Text>
                                    <br />
                                    <Tag color={interview.cheating_detected ? 'red' : 'green'}>
                                        {interview.cheating_detected ? 'Detected' : 'Clean'}
                                    </Tag>
                                </div>
                            </Col>
                            <Col xs={24} md={8}>
                                <div style={{ textAlign: 'center', padding: spacing.md }}>
                                    <div style={{ marginBottom: spacing.sm }}>
                                        <WarningOutlined style={{ fontSize: 32, color: '#1890ff' }} />
                                    </div>
                                    <Text strong>Incidents</Text>
                                    <br />
                                    <Tag color="blue">
                                        {interview.cheating_incidents?.length || 0} Detected
                                    </Tag>
                                </div>
                            </Col>
                        </Row>
                        
                        {/* Show cheating incidents if any */}
                        {interview.cheating_detected && interview.cheating_incidents && interview.cheating_incidents.length > 0 && (
                            <div style={{ marginTop: spacing.lg, padding: spacing.md, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6 }}>
                                <Text strong style={{ color: '#ff4d4f', marginBottom: spacing.sm, display: 'block' }}>
                                    Detected Cheating Incidents:
                                </Text>
                                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                    {interview.cheating_incidents.map((incident: any, index: number) => (
                                        <div key={index} style={{ 
                                            padding: spacing.sm, 
                                            background: '#fff', 
                                            border: '1px solid #ffccc7', 
                                            borderRadius: 4 
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <Text strong>{incident.processName}</Text>
                                                    <br />
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {incident.reason} • PID: {incident.pid}
                                                    </Text>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <Tag color={incident.killed ? 'red' : 'orange'}>
                                                        {incident.killed ? 'Terminated' : 'Detected'}
                                                    </Tag>
                                                    <br />
                                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                                        {new Date(incident.timestamp).toLocaleString()}
                                                    </Text>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </Space>
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>

            {/* Strengths & Areas for Improvement */}
            <Row gutter={[spacing.xl, spacing.xl]} style={{ marginBottom: spacing.xl }}>
                <Col xs={24} md={12}>
                    <Card title="Strengths" style={{ height: '100%' }}>
                        <Space wrap>
                            {interview.strengths && interview.strengths.length > 0 ? (
                                interview.strengths.map((strength, index) => (
                                    <Tag key={index} color="green" style={{ marginBottom: 8 }}>
                                        {strength}
                                    </Tag>
                                ))
                            ) : (
                                <Text type="secondary">No strengths identified.</Text>
                            )}
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card title="Areas for Improvement" style={{ height: '100%' }}>
                        <Space wrap>
                            {interview.areasForImprovement && interview.areasForImprovement.length > 0 ? (
                                interview.areasForImprovement.map((area, index) => (
                                    <Tag key={index} color="orange" style={{ marginBottom: 8 }}>
                                        {area}
                                    </Tag>
                                ))
                            ) : (
                                <Text type="secondary">No areas for improvement identified.</Text>
                            )}
                        </Space>
                    </Card>
                </Col>
            </Row>

            {/* Overall Feedback */}
            <Card title="Overall Feedback" style={{ marginBottom: spacing.xl }}>
                <Text>{interview.overall_feedback}</Text>
            </Card>

            {/* Chat History Section */}
            <Card title="Chat History Section">
                {answers && answers.length > 0 ? (
                    <Collapse
                        items={[{
                            key: 'chat-history',
                            label: (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <Space>
                                        <Text strong>View Chat History ({answers.length} questions)</Text>
                                    </Space>
                                    <Space>
                                        <Text type="secondary">Click to expand</Text>
                                    </Space>
                                </div>
                            ),
                            children: (
                                <div style={{ padding: '16px 0' }}>
                                    <div style={{
                                        maxHeight: '600px',
                                        overflowY: 'auto',
                                        border: '1px solid #d9d9d9',
                                        borderRadius: '8px',
                                        background: '#fafafa',
                                        padding: '16px'
                                    }}>
                                        <Space direction="vertical" size="large" style={{ width: '100%' }}>
                                            {answers.map((answer: any, index: number) => {
                                                const isCorrect = answer.isCorrect;
                                                const userAnswerId = answer.userAnswer?.replace('Selected: ', '');
                                                const correctAnswerId = answer.correctAnswer;
                                                const isCodingQuestion = answer.questionId === 'q5' || answer.questionId === 'q6';

                                                return (
                                                    <div key={index}>
                                                        {/* AI Question Message */}
                                                        <div style={{
                                                            display: 'flex',
                                                            justifyContent: 'flex-start',
                                                            marginBottom: '12px'
                                                        }}>
                                                            <div style={{
                                                                background: '#e6f7ff',
                                                                border: '1px solid #91d5ff',
                                                                borderRadius: '12px',
                                                                padding: '12px 16px',
                                                                width: '100%',
                                                                maxWidth: '100%',
                                                                position: 'relative'
                                                            }}>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    marginBottom: '8px'
                                                                }}>
                                                                    <div style={{
                                                                        width: '8px',
                                                                        height: '8px',
                                                                        borderRadius: '50%',
                                                                        background: '#1890ff',
                                                                        marginRight: '8px'
                                                                    }}></div>
                                                                    <Text strong style={{ color: '#1890ff' }}>AI Interviewer</Text>
                                                                    <Text type="secondary" style={{ marginLeft: '8px', fontSize: '12px' }}>
                                                                        Question {index + 1}
                                                                    </Text>
                                                                    {isCodingQuestion && (
                                                                        <Tag color="blue" style={{ marginLeft: '8px' }}>
                                                                            Coding Question
                                                                        </Tag>
                                                                    )}
                                                                </div>
                                                                <Text style={{ fontSize: '16px', marginBottom: '12px' }}>
                                                                    {answer.question}
                                                                </Text>

                                                                {/* Show code editor for coding questions (q5 and q6) */}
                                                                {isCodingQuestion ? (
                                                                    <div style={{ marginTop: '12px' }}>
                                                                        <div style={{
                                                                            border: '1px solid #d9d9d9',
                                                                            borderRadius: '6px',
                                                                            background: '#fafafa',
                                                                            padding: '12px',
                                                                            marginBottom: '8px'
                                                                        }}>
                                                                            <Text strong style={{ display: 'block', marginBottom: '8px' }}>
                                                                                Your Code Solution:
                                                                            </Text>
                                                                            <pre style={{
                                                                                background: '#fafafa',
                                                                                padding: '12px',
                                                                                borderRadius: '4px',
                                                                                border: '1px solid #e8e8e8',
                                                                                fontSize: '14px',
                                                                                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                                                                whiteSpace: 'pre-wrap',
                                                                                wordWrap: 'break-word',
                                                                                margin: 0,
                                                                                maxHeight: '300px',
                                                                                overflowY: 'auto'
                                                                            }}>
                                                                                {answer.userAnswer && answer.userAnswer !== 'No code submitted'
                                                                                    ? answer.userAnswer
                                                                                    : '// No code was submitted for this question'}
                                                                            </pre>
                                                                        </div>
                                                                        <div style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px'
                                                                        }}>
                                                                            <Tag color={isCorrect ? 'success' : 'error'}>
                                                                                {isCorrect ? '✓ Correct' : '✗ Incorrect'}
                                                                            </Tag>
                                                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                                Time taken: {answer.timeTaken || 0}s
                                                                            </Text>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    /* MCQ Options for non-coding questions */
                                                                    <div style={{ marginTop: '12px' }}>
                                                                        {['a', 'b', 'c', 'd'].map((optionId) => {
                                                                            const isUserAnswer = optionId === userAnswerId;
                                                                            const isCorrectAnswer = optionId === correctAnswerId;
                                                                            const optionText = answer[`option${optionId.toUpperCase()}`] || `Option ${optionId.toUpperCase()}`;

                                                                            return (
                                                                                <div
                                                                                    key={optionId}
                                                                                    style={{
                                                                                        padding: '8px 12px',
                                                                                        margin: '4px 0',
                                                                                        border: '1px solid #d9d9d9',
                                                                                        borderRadius: '6px',
                                                                                        background: isCorrectAnswer ? '#f6ffed' : isUserAnswer ? '#fff2e8' : '#fff',
                                                                                        borderColor: isCorrectAnswer ? '#52c41a' : isUserAnswer ? '#ff7875' : '#d9d9d9',
                                                                                        position: 'relative',
                                                                                        width: '100%',
                                                                                        minHeight: '48px',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center'
                                                                                    }}
                                                                                >
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '8px',
                                                                                        width: '100%'
                                                                                    }}>
                                                                                        <div style={{
                                                                                            width: '20px',
                                                                                            height: '20px',
                                                                                            borderRadius: '50%',
                                                                                            border: '2px solid',
                                                                                            borderColor: isCorrectAnswer ? '#52c41a' : isUserAnswer ? '#ff7875' : '#d9d9d9',
                                                                                            background: isCorrectAnswer ? '#52c41a' : isUserAnswer ? '#ff7875' : 'transparent',
                                                                                            display: 'flex',
                                                                                            alignItems: 'center',
                                                                                            justifyContent: 'center',
                                                                                            fontSize: '12px',
                                                                                            fontWeight: 'bold',
                                                                                            color: 'white',
                                                                                            flexShrink: 0
                                                                                        }}>
                                                                                            {optionId.toUpperCase()}
                                                                                        </div>
                                                                                        <Text style={{
                                                                                            flex: 1,
                                                                                            wordWrap: 'break-word',
                                                                                            overflowWrap: 'break-word'
                                                                                        }}>
                                                                                            {optionText}
                                                                                        </Text>
                                                                                        <div style={{ flexShrink: 0 }}>
                                                                                            {isCorrectAnswer && (
                                                                                                <Tag color="success">
                                                                                                    ✓ Correct
                                                                                                </Tag>
                                                                                            )}
                                                                                            {isUserAnswer && !isCorrectAnswer && (
                                                                                                <Tag color="error">
                                                                                                    ✗ Your Answer
                                                                                                </Tag>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </Space>
                                    </div>
                                </div>
                            )
                        }]}
                    />
                ) : (
                    <Text type="secondary">No detailed answers available</Text>
                )}
            </Card>
        </div>
    );
};