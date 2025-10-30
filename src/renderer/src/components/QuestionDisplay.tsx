import React from 'react'
import { Question } from '../../../shared/types'

interface QuestionDisplayProps {
  question: Question | null
  isListening: boolean
  isSpeaking: boolean
  progress: { current: number, total: number }
}

export const QuestionDisplay: React.FC<QuestionDisplayProps> = ({
  question,
  isListening,
  isSpeaking,
  progress
}) => {
  if (!question) {
    return (
      <div className="question-display">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading question...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="question-display">
      <div className="question-header">
        <div className="question-number">
          Question {progress.current} of {progress.total}
        </div>
        <div className="question-status">
          {isSpeaking && (
            <div className="status-indicator speaking">
              <div className="pulse-dot"></div>
              AI is speaking
            </div>
          )}
          {isListening && (
            <div className="status-indicator listening">
              <div className="pulse-dot"></div>
              Listening for your answer
            </div>
          )}
        </div>
      </div>

      <div className="question-content">
        <h2 className="question-text">{question.question}</h2>
        
        {question.keyPoints && question.keyPoints.length > 0 && (
          <div className="key-points">
            <h4>Key points to cover:</h4>
            <ul>
              {question.keyPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>
        )}

        {question.followUps && question.followUps.length > 0 && (
          <div className="follow-ups">
            <h4>Possible follow-up topics:</h4>
            <ul>
              {question.followUps.map((followUp, index) => (
                <li key={index}>
                  <strong>If you mention:</strong> {Array.isArray(followUp.trigger) ? followUp.trigger.join(', ') : followUp.trigger}
                  <br />
                  <strong>I might ask:</strong> {followUp.question}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="question-instructions">
        <div className="instruction-item">
          <div className="instruction-icon">🎤</div>
          <div className="instruction-text">
            <strong>Speak clearly</strong> into your microphone
          </div>
        </div>
        <div className="instruction-item">
          <div className="instruction-icon">⏱️</div>
          <div className="instruction-text">
            <strong>Take your time</strong> to think through your answer
          </div>
        </div>
        <div className="instruction-item">
          <div className="instruction-icon">💡</div>
          <div className="instruction-text">
            <strong>Be specific</strong> and provide examples when possible
          </div>
        </div>
      </div>

      <style>{`
        .question-display {
          max-width: 800px;
          margin: 0 auto;
          padding: 24px;
          background: #2d2d30;
          border-radius: 12px;
          border: 1px solid #333;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 40px;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #333;
          border-top: 3px solid #4caf50;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .question-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid #333;
        }

        .question-number {
          font-size: 14px;
          color: #888888;
          font-weight: 500;
        }

        .question-status {
          display: flex;
          gap: 12px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-indicator.speaking {
          background: rgba(33, 150, 243, 0.2);
          color: #2196f3;
          border: 1px solid rgba(33, 150, 243, 0.3);
        }

        .status-indicator.listening {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
          border: 1px solid rgba(76, 175, 80, 0.3);
        }

        .pulse-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }

        .question-content {
          margin-bottom: 24px;
        }

        .question-text {
          font-size: 20px;
          color: #ffffff;
          margin: 0 0 20px 0;
          line-height: 1.4;
        }

        .key-points,
        .follow-ups {
          margin: 20px 0;
          padding: 16px;
          background: #1a1a1a;
          border-radius: 8px;
          border: 1px solid #333;
        }

        .key-points h4,
        .follow-ups h4 {
          margin: 0 0 12px 0;
          color: #4caf50;
          font-size: 14px;
          font-weight: 600;
        }

        .key-points ul,
        .follow-ups ul {
          margin: 0;
          padding-left: 20px;
        }

        .key-points li,
        .follow-ups li {
          margin: 8px 0;
          color: #cccccc;
          line-height: 1.4;
        }

        .follow-ups li {
          font-size: 13px;
        }

        .follow-ups strong {
          color: #ffffff;
        }

        .question-instructions {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .instruction-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #1a1a1a;
          border-radius: 8px;
          border: 1px solid #333;
        }

        .instruction-icon {
          font-size: 20px;
          flex-shrink: 0;
        }

        .instruction-text {
          font-size: 13px;
          color: #cccccc;
          line-height: 1.3;
        }

        .instruction-text strong {
          color: #ffffff;
        }
      `}</style>
    </div>
  )
}

export default QuestionDisplay


