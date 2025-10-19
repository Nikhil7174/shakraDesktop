// src/pages/Interview.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Typography, Space, Button, App } from 'antd';
import { ArrowLeftOutlined, RobotOutlined } from '@ant-design/icons';
import { colors, spacing } from '../styles';
import { useAppDispatch, useAppSelector } from '../store';
import { InterviewSession } from '../components/interview/InterviewSession';
import { ResumeUpload } from '../components/interview/ResumeUpload';
import { InfoCollection } from '../components/interview/InfoCollection';
import { addChatMessage, setResumeData, setDetailedResumeData, setCurrentSession } from '../store/slices/interviewSlice';
import { API_BASE_URL } from '../constants/api';
import axios from 'axios';

const { Title, Paragraph } = Typography;

type Step = 'upload' | 'info' | 'interview';

export const Interview: React.FC = () => {
  const { message } = App.useApp();
  const dispatch = useAppDispatch();
  const { currentSession, resumeData, detailedResumeData, chatMessages } = useAppSelector((state) => state.interview);
  const { user } = useAppSelector((state) => state.auth);
  
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [processingResume, setProcessingResume] = useState(false);
  const [collectingInfo, setCollectingInfo] = useState(false);
  const [, setSubmittingAnswer] = useState(false);

  // Check if we have an active session
  useEffect(() => {
    if (currentSession) {
      // If we have a session, determine the current step
      if (currentSession.questions && currentSession.questions.length > 0) {
        setCurrentStep('interview');
      } else if (detailedResumeData) {
        setCurrentStep('info');
      } else {
        setCurrentStep('upload');
      }
    }
  }, [currentSession, detailedResumeData]);

  const handleResumeUpload = useCallback(async (file: File) => {
    setProcessingResume(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);

      const response = await axios.post(`${API_BASE_URL}/resume/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (response.data.success) {
        // Update Redux state with resume data
        dispatch(setResumeData(response.data.resumeData));
        dispatch(setDetailedResumeData(response.data.detailedResumeData));
        
        message.success('Resume processed successfully!');
        setCurrentStep('info');
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || 'Failed to process resume');
    } finally {
      setProcessingResume(false);
    }
  }, [dispatch]);

  const handleInfoCollection = useCallback(async (info: { name: string; email: string; phone: string }) => {
    setCollectingInfo(true);
    try {
      // Update session with collected info
      const updatedDetailedData = {
        ...detailedResumeData,
        name: info.name,
        email: info.email,
        phone: info.phone,
      };
      dispatch(setDetailedResumeData(updatedDetailedData));

      // Start the interview session
      if (currentSession) {
        const response = await axios.post(`${API_BASE_URL}/interview/start`, {
          candidateData: {
            id: user?.id,
            email: info.email,
            name: info.name,
            phone: info.phone,
          },
          linkToken: currentSession.interviewLinkId
        }, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`
          }
        });

        if (response.data.success) {
          dispatch(setCurrentSession(response.data));
          
          // Add the first question to chat messages if available
          if (response.data.questions && response.data.questions.length > 0) {
            const firstQuestion = response.data.questions[0];
            const questionMessage = {
              id: `msg-${Date.now()}`,
              sessionId: response.data.sessionId,
              type: 'assistant' as const,
              content: firstQuestion.question,
              timestamp: new Date().toISOString()
            };
            dispatch(addChatMessage(questionMessage));
          }
          
          setCurrentStep('interview');
          message.success('Interview started!');
        }
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || 'Failed to start interview');
    } finally {
      setCollectingInfo(false);
    }
  }, [dispatch, detailedResumeData, currentSession, user]);

  const handleAnswerSubmit = useCallback(async (questionId: string, answer: string, timeTaken: number) => {
    if (!currentSession) return;

    setSubmittingAnswer(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/interview/submit-answer`, {
        sessionId: currentSession.sessionId,
        questionId,
        answer,
        timeTaken
      }, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (response.data.success) {
        // Add the user's answer to chat messages
        const userMessage = {
          id: `msg-${Date.now()}`,
          sessionId: currentSession.sessionId,
          type: 'user' as const,
          content: answer,
          timestamp: new Date().toISOString()
        };
        dispatch(addChatMessage(userMessage));

        // Add AI response if available
        if (response.data.nextQuestion) {
          const aiMessage = {
            id: `msg-${Date.now() + 1}`,
            sessionId: currentSession.sessionId,
            type: 'assistant' as const,
            content: response.data.nextQuestion.question,
            timestamp: new Date().toISOString()
          };
          dispatch(addChatMessage(aiMessage));
        }

        // Update the current session with new data
        if (response.data.session) {
          dispatch(setCurrentSession(response.data.session));
        }

        return response.data;
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || 'Failed to submit answer');
      throw error;
    } finally {
      setSubmittingAnswer(false);
    }
  }, [currentSession, dispatch]);

  const handleBackToJoin = () => {
    window.location.hash = '#/join';
  };

  if (!currentSession) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background.secondary,
        padding: spacing.lg
      }}>
        <Card style={{ maxWidth: 500, width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <RobotOutlined style={{ fontSize: 64, color: colors.neutral[400] }} />
            <Title level={3} style={{ color: colors.neutral[600] }}>
              No Active Interview Session
            </Title>
            <Paragraph>
              Please join an interview first.
            </Paragraph>
            <Button type="primary" onClick={handleBackToJoin}>
              Back to Join Interview
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.background.secondary,
      padding: spacing.lg
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
            <Button 
              icon={<ArrowLeftOutlined />} 
              onClick={handleBackToJoin}
              type="text"
            >
              Back
            </Button>
            <Title level={2} style={{ margin: 0 }}>
              AI Interview Session
            </Title>
          </div>

          {/* Step Content */}
          {currentStep === 'upload' && (
            <ResumeUpload
              onUpload={handleResumeUpload}
              loading={processingResume}
              onRemoveFile={() => {}}
              isProcessing={processingResume}
              resumeData={resumeData}
            />
          )}

          {currentStep === 'info' && (
            <InfoCollection
              resumeData={resumeData}
              detailedResumeData={detailedResumeData}
              onSubmit={handleInfoCollection}
              loading={collectingInfo}
            />
          )}

          {currentStep === 'interview' && (
            <InterviewSession
              onStartNew={() => {}}
              currentSession={currentSession}
              chatMessages={chatMessages}
              onSubmitAnswer={handleAnswerSubmit}
              onComplete={() => {
                message.success('Interview completed!');
                window.location.hash = '#/join';
              }}
            />
          )}
        </Space>
      </div>
    </div>
  );
};
