import React from 'react'
import { Question } from '../../../shared/types'

interface QuestionDisplayProps {
  question: Question | null
  followUpQuestionText?: string | null
  isListening: boolean
  isSpeaking: boolean
  progress: { current: number, total: number }
}

export const QuestionDisplay: React.FC<QuestionDisplayProps> = ({
  question,
  followUpQuestionText,
  isListening,
  isSpeaking,
  progress
}) => {
  if (!question) {
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
              <div className="video-background">
                <div className="person-icon candidate-icon">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="8" r="4" fill="currentColor"/>
                    <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" fill="currentColor"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Display follow-up question if available, otherwise show original question
  const displayQuestion = followUpQuestionText || question.question
  const isFollowUp = !!followUpQuestionText

  return (
    <div className="meeting-display">
      <div className="meeting-container">
        {/* AI Interviewer Video Window (Left Half) */}
        <div className={`video-window ai-video ${isSpeaking ? 'speaking-active' : ''}`}>
          <div className="video-header">
            <div className="video-header-info">
              <div className="video-name">AI Interviewer</div>
              <div className="video-meta">
                Question {progress.current} of {progress.total}
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
            <div className="subtitle-text">
              {displayQuestion}
            </div>
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
                  <span>Your turn</span>
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
            <div className="video-background">
              <div className="person-icon candidate-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="8" r="4" fill="currentColor"/>
                  <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" fill="currentColor"/>
                </svg>
              </div>
            </div>
          </div>

          <div className="video-subtitles">
            {isListening && (
              <div className="subtitle-text listening-subtitle">
                🎤 Your microphone is active
              </div>
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

        .video-window {
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
        }

        .video-window.speaking-active {
          border-color: #4caf50;
          box-shadow: 0 0 20px rgba(76, 175, 80, 0.4), 0 0 40px rgba(76, 175, 80, 0.2);
        }

        .video-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 10;
        }

        .video-header-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .video-name {
          font-size: 14px;
          font-weight: 600;
          color: #ffffff;
        }

        .video-meta {
          font-size: 11px;
          color: #888888;
          font-weight: 400;
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

        .video-status {
          display: flex;
          gap: 8px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }

        .speaking-badge {
          background: rgba(33, 150, 243, 0.2);
          color: #2196f3;
          border: 1px solid rgba(33, 150, 243, 0.4);
        }

        .listening-badge {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
          border: 1px solid rgba(76, 175, 80, 0.4);
        }

        .waiting-badge {
          background: rgba(255, 255, 255, 0.1);
          color: #cccccc;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }

        .video-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .video-background {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: 0;
          left: 0;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        }

        .ai-video .video-background {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
        }

        .candidate-video .video-background {
          background: linear-gradient(135deg, #2d1b3d 0%, #3d2a4d 50%, #4d3a5d 100%);
        }

        .person-icon {
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

        .person-icon svg {
          width: 60%;
          height: 60%;
          max-width: 300px;
          max-height: 300px;
        }

        .ai-icon {
          color: rgba(33, 150, 243, 0.5);
        }

        .candidate-icon {
          color: rgba(156, 39, 176, 0.5);
        }

        .speaking-indicator {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 200px;
          height: 200px;
          pointer-events: none;
          z-index: 5;
        }

        .speaking-pulse {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 3px solid #4caf50;
          animation: speakingPulse 2s infinite;
        }

        @keyframes speakingPulse {
          0% {
            transform: scale(0.8);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.6;
          }
          100% {
            transform: scale(0.8);
            opacity: 1;
          }
        }

        .video-subtitles {
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.7);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          min-height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .subtitle-text {
          font-size: 14px;
          color: #ffffff;
          line-height: 1.5;
          text-align: center;
          max-width: 90%;
          opacity: 0.9;
        }

        .listening-subtitle {
          color: #4caf50;
          font-weight: 500;
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


