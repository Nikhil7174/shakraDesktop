import React from 'react'

interface InterviewProgressProps {
  currentState: string
  progress: { current: number, total: number }
  isListening?: boolean // Optional - not used, kept for backward compatibility
  isSpeaking?: boolean  // Optional - not used, kept for backward compatibility
}

export const InterviewProgress: React.FC<InterviewProgressProps> = ({
  currentState,
  progress
}) => {
  const getStateDisplayName = (state: string) => {
    const stateNames: { [key: string]: string } = {
      'intro': 'Introduction',
      'theoretical_question': 'Theoretical Questions',
      'waiting_for_answer': 'Waiting for Answer',
      'evaluating_answer': 'Evaluating Answer',
      'follow_up': 'Follow-up Question',
      'coding_intro': 'Coding Introduction',
      'coding_problem': 'Coding Problem',
      'coding_approach': 'Explaining Approach',
      'waiting_for_approach': 'Waiting for Approach',
      'evaluating_approach': 'Evaluating Approach',
      'monitoring_code': 'Monitoring Code',
      'providing_hint': 'Providing Hint',
      'wrap_up': 'Wrap-up',
      'completed': 'Completed'
    }
    return stateNames[state] || state
  }

  const getProgressPercentage = () => {
    if (currentState === 'completed') return 100
    if (currentState.startsWith('coding')) return 50 + (progress.current / progress.total) * 50
    return (progress.current / progress.total) * 50
  }

  const getPhaseName = () => {
    if (currentState.startsWith('coding')) return 'Coding Phase'
    if (currentState.startsWith('theoretical') || currentState === 'waiting_for_answer' || 
        currentState === 'evaluating_answer' || currentState === 'follow_up') {
      return 'Theoretical Phase'
    }
    return 'Interview'
  }

  return (
    <div className="interview-progress">
      <div className="progress-header">
        <h3>AI Interview Session</h3>
      </div>

      <div className="progress-content">
        <div className="phase-info">
          <span className="phase-name">{getPhaseName()}</span>
          <span className="state-name">{getStateDisplayName(currentState)}</span>
        </div>

        <div className="progress-bar-container">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>
          <span className="progress-text">
            {currentState.startsWith('coding') ? 
              'Coding Section' : 
              `Question ${progress.current} of ${progress.total}`
            }
          </span>
        </div>

        <div className="progress-details">
          <div className="detail-item">
            <span className="detail-label">Phase:</span>
            <span className="detail-value">{getPhaseName()}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Status:</span>
            <span className="detail-value">{getStateDisplayName(currentState)}</span>
          </div>
          {!currentState.startsWith('coding') && (
            <div className="detail-item">
              <span className="detail-label">Progress:</span>
              <span className="detail-value">{progress.current}/{progress.total}</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .interview-progress {
          background: #2d2d30;
          border-radius: 8px;
          padding: 16px;
          border: 1px solid #333;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .progress-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 18px;
          font-weight: 600;
        }

        .progress-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .phase-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .phase-name {
          font-size: 14px;
          color: #cccccc;
          font-weight: 500;
        }

        .state-name {
          font-size: 12px;
          color: #888888;
        }

        .progress-bar-container {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #1a1a1a;
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid #333;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4caf50, #2196f3);
          border-radius: 4px;
          transition: width 0.5s ease;
          position: relative;
        }

        .progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        .progress-text {
          font-size: 12px;
          color: #888888;
          text-align: center;
        }

        .progress-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .detail-label {
          font-size: 10px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .detail-value {
          font-size: 12px;
          color: #cccccc;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}

export default InterviewProgress


