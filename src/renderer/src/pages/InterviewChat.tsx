// src/pages/InterviewChat.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Space, Button } from 'antd';
import { LeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { colors, spacing } from '../styles';
import { ResumeUpload } from '../components/interview/ResumeUpload';
import { InfoCollection } from '../components/interview/InfoCollection';
import { InterviewSession } from '../components/interview/InterviewSession';
import { WelcomeBackModal } from '../components/interview/WelcomeBackModal';
import { useResumeUpload } from '../hooks/api/useResumeUpload';
import { useInterview } from '../hooks/api/useInterview';
import { useResumeData } from '../hooks/useResumeData';
import { useSession } from '../hooks/useSession';
import { useWebSocket } from '../hooks/useWebSocket';
import { resetInterview } from '../store/slices/interviewSlice';
import { SecurityWarning } from '../components/security/SecurityWarning';
// SESSION_CONFIG removed - using Redux-only session management

type Step = 'upload' | 'info' | 'interview';

export const InterviewChat: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [processingResume, setProcessingResume] = useState(false);
  const [collectingInfo, setCollectingInfo] = useState(false);
  const [userHasChosen, setUserHasChosen] = useState(false); // Track if user made a choice about session

  const handleBack = () => {
    const from = (location.state as any)?.from;
    if (from) {
      navigate(from, { replace: true });
    } else {
      navigate(-1);
    }
  };

  // Hooks
  const {
    resumeData,
    detailedResumeData,
    uploading,
    loading,
    error,
    uploadResume,
    collectMissingInfo
  } = useResumeUpload();

  const {
    chatMessages,
    submitAnswer,
    saveResults
  } = useInterview();

  const {
    resumeData: existingResumeData,
    hasResume
  } = useResumeData();

  // Redux-only session management
  const {
    currentSession,
    resumeData: sessionResumeData,
    shouldShowWelcomeBack,
    sessionSummary,
    clearAllSessions,
    resetPageVisibilityTracking
  } = useSession();

  // WebSocket connection for security monitoring (only connect during interview)
  useWebSocket(
    (currentStep === 'interview') ? currentSession?.sessionId : undefined
  );

  // Effect 1: Handle welcome back modal display
  useEffect(() => {
    console.log('=== WELCOME BACK MODAL CHECK ===');
    console.log('Should show welcome back:', shouldShowWelcomeBack);
    console.log('User has chosen:', userHasChosen);
    console.log('Current session exists:', !!currentSession);
    console.log('Session summary exists:', !!sessionSummary);

    // Don't show modal if user has already made a choice
    if (userHasChosen) {
      console.log('User has already made a choice, skipping modal check');
      return;
    }

    // Show welcome back modal for interrupted interviews
    if (shouldShowWelcomeBack && currentSession && sessionSummary) {
      console.log('Valid interrupted session found:', {
        answered: sessionSummary.questionsAnswered,
        total: sessionSummary.totalQuestions,
        timeAway: sessionSummary.timeAway
      });
      setShowWelcomeBack(true);
    } else {
      console.log('No interrupted session found - not showing modal');
      setShowWelcomeBack(false);
    }
  }, [shouldShowWelcomeBack, currentSession, sessionSummary, userHasChosen]);

  // Effect 2: Handle initial step determination (separate from modal logic)
  useEffect(() => {
    console.log('=== INITIAL STEP DETERMINATION ===');
    console.log('Current step:', currentStep);
    console.log('Has existing resume:', hasResume);
    console.log('Current session resume data:', !!sessionResumeData);

    // Only set initial step if we're still on upload (initial state)
    if (currentStep !== 'upload') {
      console.log('Already on step:', currentStep, '- not changing');
      return;
    }

    // Check if there's already a current session in progress
    if (currentSession && currentSession.sessionId) {
      console.log('Found existing session, starting with interview step');
      console.log('Session details:', currentSession);
      setCurrentStep('interview');
      return;
    }

    // Always start with upload page - enhanced to show existing resume with replace option
    console.log('Starting with upload page (enhanced for existing resumes)');
    setCurrentStep('upload');

    // ENHANCED: Resume Data Persistence with Better UX
    // Problem: When the same user gives multiple interviews, their previously provided resume data
    // is not being retrieved, causing them to upload a PDF every time they give an interview.
    // 
    // SOLUTION IMPLEMENTED:
    // 1. Session cleanup on logout/login to prevent data leakage between different users
    // 2. Resume data is now saved to user profile during info collection step
    // 3. useResumeData hook syncs data between backend and Redux state
    // 4. SessionCleanup component clears data when different users log in
    // 5. Each user now gets their own isolated resume data
    // 6. ENHANCED: Upload page now shows existing resume with option to replace

  }, [hasResume, existingResumeData, sessionResumeData, currentStep]);


  // Real-time tracking is now handled by useSessionManager hook

  // Auto-save session activity is now handled by useSessionManager

  // Effect to transition from upload to info step after resumeData is available
  useEffect(() => {
    if (resumeData && !uploading && !loading && currentStep === 'upload' && processingResume) {
      // Delay transition to allow success message to be visible
      const timer = setTimeout(() => {
        setCurrentStep('info');
        setProcessingResume(false); // Reset processing state
      }, 1500); // 1.5 seconds delay
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [resumeData, uploading, loading, currentStep, processingResume, collectingInfo]);

  const handleFileUpload = useCallback(async (file: File) => {
    setProcessingResume(true); // Start processing state
    try {
      await uploadResume(file);
      // Don't change step here - let useEffect handle it when resumeData is available
    } catch (error) {
      console.error(' InterviewChat: Upload failed:', error);
      setProcessingResume(false); // Reset processing state on error
    }
  }, [uploadResume]);

  const handleCollectInfo = useCallback(async (info: { name: string; email: string; phone: string }) => {
    setCollectingInfo(true);
    try {
      await collectMissingInfo(info);
      // Navigate to join interview page instead of starting interview directly
      navigate('/join');
    } catch (error) {
      console.error(' InterviewChat: Info collection failed:', error);
    } finally {
      setCollectingInfo(false);
    }
  }, [collectMissingInfo, navigate]);

  const handleStartNew = useCallback(() => {
    console.log('=== STARTING NEW INTERVIEW ===');

    try {
      // Clear all session data using unified method
      clearAllSessions();

      // Clear Redux state
      dispatch(resetInterview());

      // Reset local component state
      setCurrentStep('upload');
      setShowWelcomeBack(false); // Hide modal
      setProcessingResume(false);
      setCollectingInfo(false);
      setUserHasChosen(true); // Mark that user has made a choice

      // Reset page visibility tracking for new session
      resetPageVisibilityTracking();

      console.log('=== NEW INTERVIEW SETUP COMPLETE ===');
    } catch (error) {
      console.error('Failed to start new interview:', error);
    }
  }, [dispatch, clearAllSessions, resetPageVisibilityTracking]);

  const handleInterviewComplete = useCallback(() => {
    console.log('Interview completed - clearing all data and redirecting');

    try {
      // Clear all session data using unified method
      clearAllSessions();

      // Clear Redux state
      dispatch(resetInterview());

      // Redirect to home page
      navigate('/');
    } catch (error) {
      console.error('Failed to complete interview:', error);
    }
  }, [navigate, dispatch, clearAllSessions]);

  const handleContinueSession = useCallback(() => {
    console.log('User chose to continue session');
    setUserHasChosen(true); // Mark that user has made a choice
    setCurrentStep('interview');
    setShowWelcomeBack(false);

    // Reset page visibility tracking since user is continuing
    resetPageVisibilityTracking();

    // No need to restore - data is already in Redux
    console.log('Session data already available in Redux');
  }, [resetPageVisibilityTracking]);

  const handleWelcomeBackClose = useCallback(() => {
    console.log('User closed welcome back modal');
    setUserHasChosen(true); // Mark that user has made a choice (by closing)
    setShowWelcomeBack(false);

    // Reset page visibility tracking since user dismissed the modal
    resetPageVisibilityTracking();
  }, [resetPageVisibilityTracking]);


  const renderCurrentStep = useCallback(() => {
    switch (currentStep) {
      case 'upload':
        return (
          <ResumeUpload
            onUpload={handleFileUpload}
            loading={uploading || processingResume} // Use processingResume for overall loading
            error={error}
            onRemoveFile={() => {
              setProcessingResume(false);
              clearAllSessions(); // Clear session if file is removed
            }}
            isProcessing={processingResume} // Pass processing state
            resumeData={resumeData} // Pass resumeData to show file details
            existingResumeData={existingResumeData} // Pass existing resume data
            existingFileName={existingResumeData?.fileName || existingResumeData?.originalFileName || 'resume.pdf'} // Pass filename
            onUseExistingResume={() => {
              // Use existing resume data and move to next step
              if (existingResumeData) {
                // Set the resume data in the hook state
                // This will trigger the next step
                setCurrentStep('info');
              }
            }}
          />
        );

      case 'info':
        return (
          <InfoCollection
            resumeData={resumeData}
            detailedResumeData={detailedResumeData}
            onSubmit={handleCollectInfo}
            loading={collectingInfo}
            error={error}
          />
        );

      case 'interview':
        return (
          <InterviewSession
            onStartNew={handleStartNew}
            currentSession={currentSession}
            chatMessages={chatMessages}
            onSubmitAnswer={submitAnswer}
            onSaveResults={saveResults}
            onComplete={handleInterviewComplete}
          />
        );

      default:
        return null;
    }
  }, [currentStep, handleFileUpload, handleCollectInfo, handleStartNew, handleInterviewComplete, uploading, loading, error, resumeData, detailedResumeData, currentSession, chatMessages, submitAnswer, processingResume, collectingInfo]);


  return (
    <div style={{ padding: spacing.xl, minHeight: '100vh', backgroundColor: colors.background.secondary }}>
      <div style={{ marginBottom: spacing.md }}>
        <Button type="text" onClick={handleBack} icon={<LeftOutlined />} style={{ padding: 0 }}>
          Back
        </Button>
      </div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Security Warning */}
        <SecurityWarning />

        {/* Main Content */}
        {renderCurrentStep()}
      </Space>

      {/* Welcome Back Modal */}
      <WelcomeBackModal
        visible={showWelcomeBack}
        questionsAnswered={sessionSummary?.questionsAnswered || 0}
        totalQuestions={sessionSummary?.totalQuestions || 6}
        timeAway={sessionSummary?.timeAway || 0}
        onContinue={handleContinueSession}
        onStartNew={handleStartNew}
        onClose={handleWelcomeBackClose}
      />
    </div>
  );
};

export default InterviewChat;

