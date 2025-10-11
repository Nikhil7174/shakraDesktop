import { useState, useEffect, useCallback } from 'react'
import { ProcessStats } from './components/ProcessStats'

interface SecurityStatus {
  connected: boolean
  blockedApps: string[]
  timestamp: number
  error?: string
}

function App() {
  const [status, setStatus] = useState<SecurityStatus>({
    connected: false,
    blockedApps: [],
    timestamp: 0
  })
  const [showProcessStats, setShowProcessStats] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const handleStatusUpdate = useCallback((newStatus: any) => {
    try {
      setStatus({
        connected: true,
        blockedApps: newStatus.blockedAppsDetected?.map((a: any) => a.name) || [],
        timestamp: newStatus.timestamp,
        error: newStatus.error
      })
      setIsLoading(false)
    } catch (error) {
      console.error('Error processing status update:', error)
      setStatus(prev => ({
        ...prev,
        error: 'Failed to process status update'
      }))
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Listen for status updates from main process
    if (window.securityAgent) {
      try {
        window.securityAgent.onStatusUpdate(handleStatusUpdate)
      } catch (error) {
        console.error('Error setting up status listener:', error)
        setStatus(prev => ({
          ...prev,
          error: 'Failed to connect to security agent'
        }))
        setIsLoading(false)
      }
    } else {
      console.warn('Security agent not available')
      setIsLoading(false)
    }
  }, [handleStatusUpdate])

  if (isLoading) {
    return (
      <div className="app">
        <div className="container">
          <div className="icon">🛡️</div>
          <h1>Interview Security Agent</h1>
          <div className="loading">
            <p>Initializing security monitoring...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="container">
        <div className="icon">🛡️</div>
        <h1>Interview Security Agent</h1>
        
        <div className={`status ${status.connected ? 'connected' : 'disconnected'}`}>
          {status.connected ? '✓ Running' : '⚠ Disconnected'}
        </div>

        {status.error && (
          <div className="error">
            <h3>⚠️ Error</h3>
            <p>{status.error}</p>
          </div>
        )}

        {status.blockedApps.length > 0 && (
          <div className="warning">
            <h3>⚠️ Blocked Applications Detected ({status.blockedApps.length})</h3>
            <ul>
              {status.blockedApps.slice(0, 10).map((app, idx) => (
                <li key={idx}>{app}</li>
              ))}
              {status.blockedApps.length > 10 && (
                <li>... and {status.blockedApps.length - 10} more</li>
              )}
            </ul>
            <p>Please close these applications</p>
          </div>
        )}

        <div className="info">
          <p>WebSocket Server: Port 8765</p>
          <p>Status: {status.connected ? 'Monitoring active' : 'Disconnected'}</p>
          {status.timestamp > 0 && (
            <p>Last update: {new Date(status.timestamp).toLocaleTimeString()}</p>
          )}
        </div>

        <div className="app-actions">
          <button 
            className="stats-btn"
            onClick={() => setShowProcessStats(true)}
            disabled={!status.connected}
          >
            📊 View Process Stats
          </button>
        </div>
      </div>

      <ProcessStats 
        isVisible={showProcessStats}
        onClose={() => setShowProcessStats(false)}
      />
    </div>
  )
}

export default App