import React, { useState, useEffect } from 'react'
import { Question } from '../../../shared/types'
import { VideoCapture } from './VideoCapture'
import { useVisionSecurity } from '../hooks/useVisionSecurity'

interface QuestionDisplayProps {
  question: Question | null
  followUpQuestionText?: string | null
  introMessage?: string | null
  introMeta?: string
  isListening: boolean
  isSpeaking: boolean
  progress: { current: number, total: number }
  onVisionStatusChange?: (status: any) => void
}

export const QuestionDisplay: React.FC<QuestionDisplayProps> = ({
  question,
  followUpQuestionText,
  introMessage,
  introMeta = 'Ready to begin',
  isListening,
  isSpeaking,
  progress,
  onVisionStatusChange
}) => {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  
  // Initialize vision security tracking
  const { status: visionStatus, isInitialized: visionInitialized, error: visionError } = useVisionSecurity({
    videoElement,
    enabled: true,
    onSecurityAlert: (status) => {
      // Log all alerts (not just high severity)
      if (status.suspiciousEvents.length > 0) {
        console.warn('🚨 [Vision Security - QuestionDisplay] Alert triggered:', {
          totalEvents: status.suspiciousEvents.length,
          events: status.suspiciousEvents.map(e => ({
            type: e.type,
            severity: e.severity,
            description: e.description
          }))
        })
      }
      // Immediately pass to parent when alert is triggered
      if (onVisionStatusChange) {
        onVisionStatusChange(status)
      }
    }
  })

  // Update parent component with vision security status
  // Always pass the latest status to ensure UI updates when events occur
  useEffect(() => {
    if (visionStatus && onVisionStatusChange) {
      // Always update parent with latest status to ensure alerts are shown
      // The VisionSecurityAlert component will handle deduplication
      onVisionStatusChange(visionStatus)
      
      // Log when suspicious events are detected for debugging
      if (visionStatus.suspiciousEvents && visionStatus.suspiciousEvents.length > 0) {
        console.log('📢 [QuestionDisplay] Passing suspicious events to parent:', {
          count: visionStatus.suspiciousEvents.length,
          events: visionStatus.suspiciousEvents.map(e => ({
            type: e.type,
            severity: e.severity,
            timestamp: e.timestamp
          }))
        })
      }
    }
  }, [visionStatus, onVisionStatusChange])

  // Log vision security status periodically (for debugging)
  useEffect(() => {
    if (visionStatus && visionInitialized) {
      // Log every 5 seconds to avoid spam
      const interval = setInterval(() => {
        console.log('📹 [Vision Security] Status:', {
          faceDetected: visionStatus.faceDetected,
          gazeDirection: visionStatus.gazeDirection,
          blinkRate: visionStatus.blinkRate,
          handsDetected: visionStatus.handsDetected,
          suspiciousEvents: visionStatus.suspiciousEvents.length
        })
      }, 5000)
      return () => clearInterval(interval)
    }
    return undefined
  }, [visionStatus, visionInitialized])

  // Log vision security errors
  useEffect(() => {
    if (visionError) {
      console.error('❌ [Vision Security] Error:', visionError)
    }
  }, [visionError])

  // Determine display text and meta
  const isIntroMode = !question && !!introMessage
  const displayText = question 
    ? (followUpQuestionText || question.question)
    : (introMessage || null)
  const displayMeta = question
    ? `Question ${progress.current} of ${progress.total}`
    : (introMeta || 'Loading...')
  const isFollowUp = !!followUpQuestionText && !!question

  // Show loading state only if no question and no intro message
  if (!question && !introMessage) {
    return (
      <div className="meeting-display">
        <div className="meeting-container">
          <div className="video-window ai-video">
            <div className="video-header">
              <div className="video-header-info">
                <div className="video-name">AI Interviewer</div>
                <div className="video-meta">Loading...</div>
              </div>
            </div>
            <div className="video-content">
              <div className="video-background">
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Loading question...</p>
                </div>
              </div>
            </div>
          </div>
          <div className="video-window candidate-video">
            <div className="video-header">
              <div className="video-header-info">
                <div className="video-name">You</div>
                <div className="video-meta">Candidate</div>
              </div>
            </div>
            <div className="video-content">
              <VideoCapture
                onStreamReady={() => {
                  setTimeout(() => {
                    const videoEl = document.querySelector('.candidate-video video') as HTMLVideoElement
                    if (videoEl && (window as any).setVideoElementRef) {
                      (window as any).setVideoElementRef(videoEl)
                    }
                  }, 200)
                }}
                onVideoElementReady={(videoEl) => {
                  setVideoElement(videoEl)
                  console.log('📹 [QuestionDisplay] Video element ready for vision tracking')
                }}
                onStreamError={(error) => {
                  console.error('Video capture error:', error)
                }}
                className="candidate-video-capture"
                autoStart={true}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="meeting-display">
      <div className="meeting-container">
        {/* AI Interviewer Video Window (Left Half) */}
        <div className={`video-window ai-video ${isSpeaking ? 'speaking-active' : ''}`}>
          <div className="video-header">
            <div className="video-header-info">
              <div className="video-name">AI Interviewer</div>
              <div className="video-meta">
                {displayMeta}
                {isFollowUp && <span className="follow-up-badge">Follow-up</span>}
              </div>
            </div>
            <div className="video-status">
              {isSpeaking && (
                <div className="status-badge speaking-badge">
                  <div className="status-dot"></div>
                  <span>Speaking</span>
                </div>
              )}
            </div>
          </div>

          <div className="video-content">
            <div className="video-background">
              <div className="person-icon ai-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="8" r="4" fill="currentColor"/>
                  <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" fill="currentColor"/>
                </svg>
              </div>
            </div>
          </div>

          <div className="video-subtitles">
            {displayText && (isIntroMode ? isSpeaking : true) && (
              <div className="subtitle-text">
                {displayText}
              </div>
            )}
          </div>
        </div>

        {/* Candidate Video Window (Right Half) */}
        <div className={`video-window candidate-video ${isListening ? 'speaking-active' : ''}`}>
          <div className="video-header">
            <div className="video-header-info">
              <div className="video-name">You</div>
              <div className="video-meta">Candidate</div>
            </div>
            <div className="video-status">
              {isListening && !isSpeaking && (
                <div className="status-badge listening-badge">
                  <div className="status-dot"></div>
                  <span>{isIntroMode ? 'Ready' : 'Your turn'}</span>
                </div>
              )}
              {isSpeaking && (
                <div className="status-badge waiting-badge">
                  <div className="status-dot"></div>
                  <span>AI speaking</span>
                </div>
              )}
            </div>
          </div>

          <div className="video-content">
            <VideoCapture
              onStreamReady={() => {
                setTimeout(() => {
                  const videoEl = document.querySelector('.candidate-video video') as HTMLVideoElement
                  if (videoEl && (window as any).setVideoElementRef) {
                    (window as any).setVideoElementRef(videoEl)
                  }
                }, 200)
              }}
              onVideoElementReady={(videoEl) => {
                setVideoElement(videoEl)
                console.log('📹 [QuestionDisplay] Video element ready for vision tracking')
              }}
              onStreamError={(error) => {
                console.error('Video capture error:', error)
              }}
              className="candidate-video-capture"
              autoStart={true}
            />
          </div>

          <div className="video-subtitles">
            {isIntroMode ? (
              isListening && (
                <div className="subtitle-text listening-subtitle">
                  🎤 Get ready - The interview will begin shortly
                </div>
              )
            ) : (
              isListening && (
                <div className="subtitle-text listening-subtitle">
                  🎤 Your microphone is active
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <style>{`
        .meeting-display {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .meeting-container {
          display: flex;
          width: 100%;
          height: 100%;
          gap: 12px;
          padding: 12px;
          justify-content: center;
          align-items: center;
          max-width: 1400px;
          margin: 0 auto;
        }

        .meeting-container .video-window {
          flex: 0 1 45%;
          max-width: 600px;
          display: flex;
          flex-direction: column;
          background: #0a0a0a;
          border-radius: 8px;
          border: 3px solid #2a2a2a;
          overflow: hidden;
          position: relative;
          transition: all 0.3s ease;
          min-height: 500px;
          height: 80%;
        }

        .meeting-container .video-window.speaking-active {
          border-color: #4caf50;
          box-shadow: 0 0 20px rgba(76, 175, 80, 0.4), 0 0 40px rgba(76, 175, 80, 0.2);
        }

        .meeting-container .video-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 10;
        }

        .meeting-container .video-header-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .meeting-container .video-name {
          font-size: 14px;
          font-weight: 600;
          color: #ffffff;
        }

        .meeting-container .video-meta {
          font-size: 11px;
          color: #888888;
          font-weight: 400;
        }

        .meeting-container .video-status {
          display: flex;
          gap: 8px;
        }

        .meeting-container .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }

        .meeting-container .speaking-badge {
          background: rgba(33, 150, 243, 0.2);
          color: #2196f3;
          border: 1px solid rgba(33, 150, 243, 0.4);
        }

        .meeting-container .listening-badge {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
          border: 1px solid rgba(76, 175, 80, 0.4);
        }

        .meeting-container .waiting-badge {
          background: rgba(255, 255, 255, 0.1);
          color: #cccccc;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .meeting-container .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 2s infinite;
        }

        .meeting-container .video-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .meeting-container .video-background {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: 0;
          left: 0;
        }

        .meeting-container .ai-video .video-background {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        }

        .meeting-container .person-icon {
          width: 100%;
          height: 100%;
          color: rgba(255, 255, 255, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1;
        }

        .meeting-container .person-icon svg {
          width: 60%;
          height: 60%;
          max-width: 300px;
          max-height: 300px;
        }

        .meeting-container .ai-icon {
          color: rgba(33, 150, 243, 0.5);
        }

        .meeting-container .candidate-video .video-content {
          background: #000;
        }

        .meeting-container .candidate-video .candidate-video-capture {
          width: 100%;
          height: 100%;
          position: relative;
          z-index: 1;
        }

        .meeting-container .video-subtitles {
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.7);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .meeting-container .subtitle-text {
          font-size: 14px;
          color: #ffffff;
          line-height: 1.5;
          text-align: center;
          max-width: 90%;
          opacity: 0.9;
        }

        .meeting-container .listening-subtitle {
          color: #4caf50;
          font-weight: 500;
        }

        .meeting-container .video-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .follow-up-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          background: rgba(156, 39, 176, 0.2);
          color: #ab47bc;
          border: 1px solid rgba(156, 39, 176, 0.3);
          border-radius: 6px;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }


        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 40px;
          height: 100%;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255, 255, 255, 0.2);
          border-top: 3px solid #2196f3;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .loading-state p {
          color: #cccccc;
          font-size: 14px;
        }
      `}</style>
    </div>
  )
}

export default QuestionDisplay


