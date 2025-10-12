import { useState } from 'react'
import { ProcessStats } from './components/ProcessStats'
import { ProcessMonitor } from './components/ProcessMonitor'
import { SecurityStatus } from '../../shared/types'

function App() {
  const [status, setStatus] = useState<SecurityStatus>({
    connected: false,
    blockedApps: [],
    timestamp: 0
  })
  const [showProcessStats, setShowProcessStats] = useState(false)

  const handleProcessStatusUpdate = (newStatus: SecurityStatus) => {
    setStatus(newStatus)
  }

  return (
    <div className="app">
      <div className="container">
        <div className="icon">🛡️</div>
        <h1>Interview Security Agent</h1>
        
        <ProcessMonitor onStatusUpdate={handleProcessStatusUpdate} />

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