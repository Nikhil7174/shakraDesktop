import { useState, useEffect, useCallback } from 'react'

interface ProcessInfo {
  name: string
  pid: number
  cpu: number
  memory: number
  status: string
}

interface ProcessStatsData {
  totalProcesses: number
  blockedAppsDetected: Array<{ name: string; pid: number; reason?: string }>
  systemInfo: {
    cpuUsage: number
    memoryUsage: number
    uptime: number
  }
  recentProcesses: ProcessInfo[]
  timestamp: number
  error?: string
}

interface ProcessStatsProps {
  isVisible: boolean
  onClose: () => void
}

export function ProcessStats({ isVisible, onClose }: ProcessStatsProps) {
  const [stats, setStats] = useState<ProcessStatsData>({
    totalProcesses: 0,
    blockedAppsDetected: [],
    systemInfo: {
      cpuUsage: 0,
      memoryUsage: 0,
      uptime: 0
    },
    recentProcesses: [],
    timestamp: 0
  })
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleStatsUpdate = useCallback((newStats: ProcessStatsData) => {
    try {
      setStats(newStats)
      setIsLoading(false)
    } catch (error) {
      console.error('Error processing stats update:', error)
      setStats(prev => ({
        ...prev,
        error: 'Failed to process stats update'
      }))
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) return

    setIsLoading(true)

    // Listen for process stats updates
    if (window.securityAgent) {
      try {
        (window.securityAgent as any).onProcessStatsUpdate(handleStatsUpdate)
        
        // Request initial stats with error handling
        (window.securityAgent as any).getProcessStats()
          .then(handleStatsUpdate)
          .catch((error) => {
            console.error('Error getting initial process stats:', error)
            setStats(prev => ({
              ...prev,
              error: 'Failed to load process stats'
            }))
            setIsLoading(false)
          })
      } catch (error) {
        console.error('Error setting up stats listener:', error)
        setStats(prev => ({
          ...prev,
          error: 'Failed to connect to process monitor'
        }))
        setIsLoading(false)
      }
    } else {
      console.warn('Security agent not available for process stats')
      setStats(prev => ({
        ...prev,
        error: 'Security agent not available'
      }))
      setIsLoading(false)
    }
  }, [isVisible, handleStatsUpdate])

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (!isVisible) return null

  return (
    <div className="process-stats-overlay">
      <div className="process-stats-window">
        <div className="process-stats-header">
          <h2>🖥️ Process Monitoring Stats</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="process-stats-content">
          {isLoading && (
            <div className="loading-state">
              <p>Loading process statistics...</p>
            </div>
          )}

          {!isLoading && (
            <>
              {/* System Overview */}
              <div className="stats-section">
                <h3>System Overview</h3>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-label">Total Processes</div>
                    <div className="stat-value">{stats.totalProcesses}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">CPU Usage</div>
                    <div className="stat-value">{stats.systemInfo.cpuUsage.toFixed(1)}%</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Memory Usage</div>
                    <div className="stat-value">{formatBytes(stats.systemInfo.memoryUsage)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Uptime</div>
                    <div className="stat-value">{formatUptime(stats.systemInfo.uptime)}</div>
                  </div>
                </div>
              </div>

              {/* Blocked Applications */}
              {stats.blockedAppsDetected.length > 0 && (
                <div className="stats-section">
                  <h3>🚫 Blocked Applications ({stats.blockedAppsDetected.length})</h3>
                  <div className="blocked-apps-list">
                    {stats.blockedAppsDetected.slice(0, 20).map((app, idx) => (
                      <div key={idx} className="blocked-app-item">
                        <div className="app-info">
                          <span className="app-name">{app.name}</span>
                          <span className="app-pid">PID: {app.pid}</span>
                        </div>
                        {app.reason && (
                          <div className="detection-reason">
                            <span className="reason-label">Reason:</span>
                            <span className="reason-text">{app.reason}</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {stats.blockedAppsDetected.length > 20 && (
                      <div className="blocked-app-item">
                        <div className="app-info">
                          <span className="app-name">... and {stats.blockedAppsDetected.length - 20} more blocked applications</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Processes */}
              <div className="stats-section">
                <div className="section-header">
                  <h3>Recent Processes</h3>
                  <button 
                    className="toggle-btn"
                    onClick={() => setIsExpanded(!isExpanded)}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                </div>
                
                {isExpanded && (
                  <div className="processes-table">
                    <div className="table-header">
                      <div>Name</div>
                      <div>PID</div>
                      <div>CPU</div>
                      <div>Memory</div>
                      <div>Status</div>
                    </div>
                    {stats.recentProcesses.slice(0, 20).map((process, idx) => (
                      <div key={idx} className="table-row">
                        <div className="process-name">{process.name}</div>
                        <div>{process.pid}</div>
                        <div>{process.cpu.toFixed(1)}%</div>
                        <div>{formatBytes(process.memory)}</div>
                        <div className={`status ${process.status.toLowerCase()}`}>
                          {process.status}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Last Updated */}
              <div className="last-updated">
                Last updated: {new Date(stats.timestamp).toLocaleTimeString()}
              </div>
            </>
          )}

          {stats.error && (
            <div className="error-message">
              ⚠️ {stats.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
