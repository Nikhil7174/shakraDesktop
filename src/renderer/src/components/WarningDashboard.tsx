import React from 'react'

interface WarningEvent {
  type: string
  startTime: number
  endTime?: number
  duration?: number
}

interface WarningStats {
  [key: string]: {
    count: number
    totalDuration: number
    events: WarningEvent[]
  }
}

interface WarningDashboardProps {
  warningStats: WarningStats
  className?: string
}

export const WarningDashboard: React.FC<WarningDashboardProps> = ({
  warningStats,
  className = ''
}) => {
  const formatDuration = (ms: number): string => {
    const seconds = Math.round(ms / 1000)
    return `${seconds}sec`
  }

  const getWarningDisplayName = (type: string): string => {
    const names: { [key: string]: string } = {
      'gaze_away': 'Gaze Warning',
      'multiple_faces': 'Multiple Faces',
      'face_absent': 'Face Absent',
      'mobile_device_usage': 'Mobile Device Usage'
    }
    return names[type] || type
  }

  const hasWarnings = Object.keys(warningStats).length > 0

  return (
    <div className={`warning-dashboard ${className}`}>
      <h3>Security Warnings Summary</h3>
      
      {!hasWarnings ? (
        <div className="no-warnings">
          <div className="no-warnings-icon">✅</div>
          <p>No security warnings detected</p>
        </div>
      ) : (
        <div className="warnings-list">
          {Object.entries(warningStats).map(([type, stats]) => (
            <div key={type} className="warning-type">
              <div className="warning-header">
                <h4>{stats.count} {getWarningDisplayName(type)}</h4>
                <span className="total-time">
                  Total: {formatDuration(stats.totalDuration)}
                </span>
              </div>
              
              <div className="warning-events">
                {stats.events.map((event, index) => (
                  <div key={index} className="warning-event">
                    <span className="event-number">{index + 1}</span>
                    <span className="event-duration">
                      {formatDuration(event.duration || 0)}
                    </span>
                    <span className="event-time">
                      {new Date(event.startTime).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .warning-dashboard {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
        }

        .warning-dashboard h3 {
          margin: 0 0 16px 0;
          color: #333;
          font-size: 18px;
        }

        .no-warnings {
          text-align: center;
          padding: 24px;
          color: #666;
        }

        .no-warnings-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }

        .warnings-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .warning-type {
          background: white;
          border-radius: 6px;
          padding: 12px;
          border-left: 4px solid #ff4d4f;
        }

        .warning-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .warning-header h4 {
          margin: 0;
          color: #d32f2f;
          font-size: 16px;
        }

        .total-time {
          background: #ffebee;
          color: #d32f2f;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .warning-events {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .warning-event {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 8px;
          background: #fafafa;
          border-radius: 4px;
          font-size: 14px;
        }

        .event-number {
          background: #ff4d4f;
          color: white;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 500;
        }

        .event-duration {
          font-weight: 500;
          color: #d32f2f;
          min-width: 60px;
        }

        .event-time {
          color: #666;
          font-size: 12px;
        }
      `}</style>
    </div>
  )
}

export default WarningDashboard