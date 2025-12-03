import React, { useState, useEffect } from 'react'
import { WarningStateManager } from '../services/warningStateManager'
import { WarningDashboard } from './WarningDashboard'

export const WarningSystemDemo: React.FC = () => {
  const [warningManager] = useState(() => new WarningStateManager((warning) => {
    console.log(`Warning completed: ${warning.type} - ${Math.round(warning.duration! / 1000)}s`)
    setWarningStats(warningManager.getWarningStats())
  }))
  
  const [warningStats, setWarningStats] = useState<any>({})
  const [activeWarnings, setActiveWarnings] = useState<string[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveWarnings(warningManager.getActiveWarnings().map(w => w.type))
    }, 1000)

    return () => clearInterval(interval)
  }, [warningManager])

  const startWarning = (type: string) => {
    warningManager.startWarning(type)
    setActiveWarnings(warningManager.getActiveWarnings().map(w => w.type))
  }

  const endWarning = (type: string) => {
    warningManager.endWarning(type)
    setActiveWarnings(warningManager.getActiveWarnings().map(w => w.type))
  }

  const clearStats = () => {
    warningManager.clear()
    setWarningStats({})
    setActiveWarnings([])
  }

  return (
    <div className="warning-system-demo">
      <h2>Warning System Demo</h2>
      
      <div className="controls">
        <h3>Controls</h3>
        <div className="button-group">
          <button onClick={() => startWarning('gaze_away')}>
            Start Gaze Warning
          </button>
          <button onClick={() => endWarning('gaze_away')}>
            End Gaze Warning
          </button>
        </div>
        
        <div className="button-group">
          <button onClick={() => startWarning('multiple_faces')}>
            Start Multiple Faces
          </button>
          <button onClick={() => endWarning('multiple_faces')}>
            End Multiple Faces
          </button>
        </div>
        
        <div className="button-group">
          <button onClick={() => startWarning('mobile_device_usage')}>
            Start Mobile Device
          </button>
          <button onClick={() => endWarning('mobile_device_usage')}>
            End Mobile Device
          </button>
        </div>
        
        <button onClick={clearStats} className="clear-button">
          Clear All Stats
        </button>
      </div>

      <div className="status">
        <h3>Active Warnings</h3>
        {activeWarnings.length > 0 ? (
          <ul>
            {activeWarnings.map(type => (
              <li key={type} className="active-warning">
                {type} (active)
              </li>
            ))}
          </ul>
        ) : (
          <p>No active warnings</p>
        )}
      </div>

      <WarningDashboard warningStats={warningStats} />

      <style>{`
        .warning-system-demo {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
        }

        .controls {
          margin-bottom: 20px;
          padding: 16px;
          background: #f5f5f5;
          border-radius: 8px;
        }

        .button-group {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }

        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          background: #1890ff;
          color: white;
          cursor: pointer;
        }

        button:hover {
          background: #40a9ff;
        }

        .clear-button {
          background: #ff4d4f;
          margin-top: 8px;
        }

        .clear-button:hover {
          background: #ff7875;
        }

        .status {
          margin-bottom: 20px;
          padding: 16px;
          background: #f0f0f0;
          border-radius: 8px;
        }

        .active-warning {
          color: #d32f2f;
          font-weight: 500;
        }

        ul {
          margin: 8px 0;
          padding-left: 20px;
        }
      `}</style>
    </div>
  )
}

export default WarningSystemDemo