import { useState, useEffect, useCallback } from 'react'
import { SecurityStatus, ProcessMonitorProps } from '../../../shared/types'

export function ProcessMonitor({ onStatusUpdate }: ProcessMonitorProps) {
  const [status, setStatus] = useState<SecurityStatus>({
    connected: false,
    blockedApps: [],
    timestamp: 0
  })
  const [showBlockedApps, setShowBlockedApps] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const handleStatusUpdate = useCallback((newStatus: any) => {
    try {
      console.log('ProcessMonitor received status update:', newStatus)
      console.log('blockedAppsDetected:', newStatus.blockedAppsDetected)
      
      const updatedStatus = {
        connected: true,
        blockedApps: newStatus.blockedAppsDetected?.map((a: any) => a.name) || [],
        timestamp: newStatus.timestamp,
        error: newStatus.error,
        blockedAndKilled: newStatus.blockedAndKilled,
        message: newStatus.message
      }
      
      setStatus(updatedStatus)
      onStatusUpdate(updatedStatus) // Notify parent component
      setIsLoading(false)
    } catch (error) {
      console.error('Error processing status update:', error)
      const errorStatus = {
        ...status,
        error: 'Failed to process status update'
      }
      setStatus(errorStatus)
      onStatusUpdate(errorStatus)
      setIsLoading(false)
    }
  }, [onStatusUpdate, status])

  useEffect(() => {
    // Listen for process status updates from main process
    if (window.securityAgent) {
      try {
        // Only listen to process status updates, not AI connection or DNS updates
        window.securityAgent.onStatusUpdate(handleStatusUpdate)
        console.log('ProcessMonitor: Listening for process status updates')
      } catch (error) {
        console.error('Error setting up status listener:', error)
        const errorStatus = {
          ...status,
          error: 'Failed to connect to security agent'
        }
        setStatus(errorStatus)
        onStatusUpdate(errorStatus)
        setIsLoading(false)
      }
    } else {
      console.warn('Security agent not available')
      setIsLoading(false)
    }
  }, [handleStatusUpdate, onStatusUpdate, status])

  if (isLoading) {
    return (
      <div className="process-monitor-loading">
        <div className="loading">
          <p>Initializing process monitoring...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="process-monitor">
      <div className={`status ${status.connected ? 'connected' : 'disconnected'}`}>
        {status.connected ? '✓ Running' : '⚠ Disconnected'}
        {status.blockedAndKilled && (
          <div className="blocking-status">
            🚫 Active Blocking Enabled
          </div>
        )}
      </div>

      {status.error && (
        <div className="error">
          <h3>⚠️ Error</h3>
          <p>{status.error}</p>
        </div>
      )}

      {/* Blocked Apps Dropdown - Always present */}
      <div className="blocked-apps-section">
        <button 
          className={`blocked-apps-toggle ${status.blockedApps.length > 0 ? 'has-blocked' : ''}`}
          onClick={() => setShowBlockedApps(!showBlockedApps)}
          disabled={!status.connected}
        >
          {status.blockedApps.length > 0 ? (
            <>
              🚫 Blocked Applications ({status.blockedApps.length})
              <span className="toggle-icon">{showBlockedApps ? '▼' : '▶'}</span>
            </>
          ) : (
            <>
              ✅ No Blocked Applications
              <span className="toggle-icon">{showBlockedApps ? '▼' : '▶'}</span>
            </>
          )}
        </button>
        
        {showBlockedApps && (
          <div className="blocked-apps-dropdown">
            {status.blockedApps.length > 0 ? (
              <>
                <div className="blocked-apps-header">
                  <h4>🚫 Blocked Applications Detected & Terminated</h4>
                  <p>{status.message || 'These applications were automatically terminated for security'}</p>
                </div>
                <ul className="blocked-apps-list">
                  {status.blockedApps.slice(0, 20).map((app, idx) => (
                    <li key={idx} className="blocked-app-item">
                      <span className="app-name">{app}</span>
                    </li>
                  ))}
                  {status.blockedApps.length > 20 && (
                    <li className="blocked-app-item">
                      <span className="app-name">... and {status.blockedApps.length - 20} more</span>
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <div className="no-blocked-apps">
                <div className="no-blocked-icon">✅</div>
                <h4>No Blocked Applications</h4>
                <p>System is secure. No prohibited applications detected.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="info">
        <p>WebSocket Server: Port 8765</p>
        <p>Status: {status.connected ? 'Monitoring active' : 'Disconnected'}</p>
        {status.timestamp > 0 && (
          <p>Last update: {new Date(status.timestamp).toLocaleTimeString()}</p>
        )}
      </div>
    </div>
  )
}
