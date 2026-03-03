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
import VoiceInterviewSession from './VoiceInterviewSession';
import { ConfirmationModal } from '../components/interview/ConfirmationModal';
import { useResumeUpload } from '../hooks/api/useResumeUpload';
import { useInterview } from '../hooks/api/useInterview';
import { useResumeData } from '../hooks/useResumeData';
import { useSession } from '../hooks/useSession';
import { resetInterview, setResumeData, setDetailedResumeData, setError } from '../store/slices/interviewSlice';
// SESSION_CONFIG removed - using Redux-only session management

type Step = 'upload' | 'info' | 'interview';

export const InterviewChat: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [processingResume, setProcessingResume] = useState(false);
  const [collectingInfo, setCollectingInfo] = useState(false);
  const [resumeRequested, setResumeRequested] = useState(false); // Track if user chose to resume

  const [showQuitConfirm, setShowQuitConfirm] = useState(false); // Confirm before quitting interview

  // Enable strict app blocking only while the structured interview step is active
  useEffect(() => {
    const api = (window as any)?.electronAPI
    if (!api?.setAppBlockingEnabled) {
      return
    }

    const shouldEnableBlocking = currentStep === 'interview'
    api.setAppBlockingEnabled(shouldEnableBlocking).catch(() => { })

    return () => {
      api.setAppBlockingEnabled(false).catch(() => { })
    }
  }, [currentStep])

  const handleBack = () => {
    const from = (location.state as any)?.from;
    if (from) {
      navigate(from, { replace: true });
    } else {
      navigate(-1);
    }
  };

  const handleQuit = async () => {
    try {
      // Stop orchestrator/listeners in Electron (no-op on web)
      await (window as any)?.electronAPI?.stopInterview?.();
    } catch (err) {
      console.error('Failed to stop interview:', err);
    } finally {
      navigate('/candidate/dashboard', { replace: true });
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

  // Clear error on component mount
  useEffect(() => {
    // Clear any persisted errors when component mounts (fresh start)
    dispatch(setError(null));
  }, [dispatch]); // Only run once on mount

  // Clear error when navigating to upload step
  useEffect(() => {
    // Clear error when navigating to upload step (fresh start)
    if (currentStep === 'upload') {
      dispatch(setError(null));
    }
  }, [currentStep, dispatch]); // Clear when step changes to upload

  const {
    chatMessages,
    submitAnswer,
    saveResults
  } = useInterview();

  const {
    resumeData: existingResumeData,
  } = useResumeData();

  // Redux-only session management
  const {
    currentSession,
    clearAllSessions,
  } = useSession();

  // Effect to set initial step
  useEffect(() => {
    // Check if we are coming from JoinInterview with a fresh session
    const fromLink = (location.state as any)?.fromLink;
    const sessionId = (location.state as any)?.sessionId;

    console.log('=== INITIAL STEP DETERMINATION ===');
    console.log('Current step:', currentStep);
    console.log('From link:', fromLink);
    console.log('Session ID from nav:', sessionId);
    console.log('Current session in Redux:', currentSession?.sessionId);

    // If we have a current session (just started or restored)
    if (currentSession && currentSession.sessionId) {
      // If we just came from JoinInterview (fresh start), go straight to interview
      if (fromLink && currentSession.sessionId === sessionId) {
        console.log('🚀 Fresh interview started from link - going to interview step');
        setCurrentStep('interview');
        return;
      }


    }

    // Only set initial step if we're still on upload (initial state)
    if (currentStep !== 'upload') {
      return;
    }

    // Always start with upload page - enhanced to show existing resume with replace option
    console.log('Starting with upload page (enhanced for existing resumes)');
    setCurrentStep('upload');

  }, [currentStep, currentSession, location.state]);


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
      setProcessingResume(false);
      setCollectingInfo(false);
      setResumeRequested(false);


      console.log('=== NEW INTERVIEW SETUP COMPLETE ===');
    } catch (error) {
      console.error('Failed to start new interview:', error);
    }
  }, [dispatch, clearAllSessions]);

  const handleInterviewComplete = useCallback(async (result?: { cancelled?: boolean }) => {
    console.log('Interview completed/cancelled - clearing all data and redirecting', result);

    try {
      // If interview was cancelled, just clear state and navigate back
      if (result?.cancelled) {
        console.log('Interview was cancelled by user');
        dispatch(resetInterview());
        clearAllSessions();

        navigate('/candidate/dashboard', { replace: true });
        return;
      }

      // Normal completion flow
      // NOTE: Don't clear unfinished interview here - the payload needs to be sent first
      // The main process will clear conversations after payload is successfully sent via markPayloadSent()
      // Only clear Redux state (UI state), not main process state

      // Mark that an interview has been completed in this app session
      sessionStorage.setItem('interviewCompletedInSession', 'true');

      // Clear all session data using unified method (Redux only)
      clearAllSessions();

      // Clear Redux state
      dispatch(resetInterview());

      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      localStorage.setItem('dashboard-needs-refresh', Date.now().toString());

      // Redirect to candidate dashboard (user is authenticated, so go directly there)
      navigate('/candidate/dashboard', { replace: true });
    } catch (error) {
      console.error('Failed to complete interview:', error);
      // Fallback to home page if dashboard navigation fails
      navigate('/', { replace: true });
    }
  }, [navigate, dispatch, clearAllSessions]);




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
                console.log('✅ Using existing resume data:', existingResumeData);

                // Clear any previous errors
                dispatch(setError(null));

                // Extract resume data - handle different possible structures
                let baseResumeData: any = null;
                let detailedResumeData: any = null;

                // Check if it's a nested structure (resumeData.resumeData)
                if (existingResumeData.resumeData) {
                  baseResumeData = existingResumeData.resumeData;
                  detailedResumeData = existingResumeData.detailedResumeData || existingResumeData.resumeData;
                }
                // Check if it's a DetailedResumeData structure (has personalInfo)
                else if (existingResumeData.personalInfo || existingResumeData.experience || existingResumeData.technicalSkills) {
                  baseResumeData = {
                    name: existingResumeData.name,
                    email: existingResumeData.email,
                    phone: existingResumeData.phone,
                    text: existingResumeData.text || '',
                    fileName: existingResumeData.fileName || ''
                  };
                  detailedResumeData = existingResumeData;
                }
                // Otherwise, assume it's a simple ResumeData structure
                else {
                  baseResumeData = existingResumeData;
                  detailedResumeData = {
                    ...existingResumeData,
                    personalInfo: existingResumeData.personalInfo || {},
                    experience: existingResumeData.experience || { internships: [], projects: [], awards: [] },
                    technicalSkills: existingResumeData.technicalSkills || { languages: [], frameworks: [], tools: [], databases: [], other: [] }
                  };
                }

                // Set resume data in Redux state
                dispatch(setResumeData(baseResumeData));
                dispatch(setDetailedResumeData(detailedResumeData));
                console.log('✅ Resume data set in Redux state:', { baseResumeData, detailedResumeData });
                setCurrentStep('info');
              } else {
                console.warn('⚠️ No existing resume data to use');
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
        // Prefer voice interview session when questions are present
        if (currentSession && currentSession.questions && currentSession.questions.length > 0) {
          // Use pre-separated questions from backend if available, otherwise filter manually
          const theoreticalQuestions = (currentSession as any).theoreticalQuestions ||
            (currentSession.questions || []).filter((q: any) => q.type === 'technical');

          const codingQuestionsRaw = (currentSession as any).codingQuestions ||
            (currentSession.questions || []).filter((q: any) => q.type === 'coding');

          // Transform coding questions into CodingProblem format
          const codingProblems = codingQuestionsRaw.map((q: any) => ({
            id: q.id,
            title: q.question || q.instructions || 'Coding Problem',
            description: q.instructions || q.question || '',
            language: (q.language || 'javascript'),
            starterCode: q.initialCode || '',
            // Include multi-language starter codes if available
            starterCodes: q.starterCodes || (q.initialCode ? { [q.language || 'javascript']: q.initialCode } : undefined),
            solution: q.expectedAnswer || '',
            hints: Array.isArray(q.keyPoints) ? q.keyPoints : [],
            testCases: Array.isArray(q.testCases) ? q.testCases.map((t: any) => ({
              input: t.input,
              expectedOutput: t.expectedOutput,
              description: t.description || ''
            })) : [],
            difficulty: q.difficulty || 'easy',
            constraints: q.constraints,
            examples: q.examples
          }));

          console.log(`📊 Interview setup: ${theoreticalQuestions.length} theoretical, ${codingProblems.length} coding`);

          return (
            <VoiceInterviewSession
              interviewId={currentSession.sessionId}
              questions={theoreticalQuestions as any}
              codingProblems={codingProblems as any}
              resumeFromIndex={(currentSession as any)?.answers?.length || 0}
              skipIntro={resumeRequested && ((currentSession as any)?.answers?.length || 0) > 0}
              interviewLinkId={currentSession.interviewLinkId}
              livekitToken={(currentSession as any)?.token}
              livekitUrl={(currentSession as any)?.wsUrl}
              roomName={(currentSession as any)?.roomName}
              onComplete={handleInterviewComplete}
              onSaveResults={saveResults}
            />
          );
        }
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


  // Only show quit when interview is actually ready (has questions and not loading)
  // DISABLED: Now using the call controls in VoiceInterviewSession instead
  const showQuitButton = false;

  return (
    <div style={{
      padding: currentStep === 'interview' ? 0 : spacing.xl,
      minHeight: '100vh',
      backgroundColor: currentStep === 'interview' ? 'transparent' : colors.background.secondary,
      margin: 0
    }}>
      <div style={{
        marginBottom: currentStep === 'interview' ? 0 : spacing.md,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: currentStep === 'interview' ? 'fixed' : 'relative',
        top: currentStep === 'interview' ? spacing.md : 'auto',
        right: currentStep === 'interview' ? spacing.md : 'auto',
        zIndex: 1000
      }}>
        <div>
          {currentStep !== 'interview' && (
            <Button type="text" onClick={handleBack} icon={<LeftOutlined />} style={{ padding: '0 8px' }}>
              Back
            </Button>
          )}
        </div>
        <div>
          {showQuitButton && (
            <Button
              danger
              type="primary"
              onClick={() => setShowQuitConfirm(true)}
              style={{
                backgroundColor: '#d43f40',
                borderColor: '#d43f40',
                padding: '8px 12px',
                height: 'auto'
              }}
            >
              Quit Interview
            </Button>
          )}
        </div>
      </div>
      <Space direction="vertical" size="large" style={{ width: '100%', margin: 0, padding: 0 }}>

        {/* Main Content */}
        {renderCurrentStep()}
      </Space>



      {/* Quit confirmation */}
      <ConfirmationModal
        visible={showQuitConfirm}
        message="Are you sure you want to quit the interview?"
        okText="Quit interview"
        cancelText="Stay"
        okButtonProps={{ danger: true }}
        onConfirm={handleQuit}
        onCancel={() => setShowQuitConfirm(false)}
      />
    </div>
  );
};

export default InterviewChat;

