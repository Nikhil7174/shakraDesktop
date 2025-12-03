import React, { useEffect, useState, useRef } from 'react'
import { Alert, Space, Button, Collapse } from 'antd'
import { WarningOutlined, EyeOutlined, MobileOutlined, UserDeleteOutlined, BarChartOutlined } from '@ant-design/icons'
import type { VisionSecurityStatus, SuspiciousEvent } from '../../../../shared/types'
import { WarningDashboard } from '../WarningDashboard'

interface VisionSecurityAlertProps {
  status: VisionSecurityStatus | null
  warningStats?: any
  onDismiss?: (eventType: string) => void
}

export const VisionSecurityAlert: React.FC<VisionSecurityAlertProps> = ({
  status,
  warningStats,
  onDismiss
}) => {
  const [dismissedEvents, setDismissedEvents] = useState<Set<string>>(new Set())
  const [showDashboard, setShowDashboard] = useState(false)

  useEffect(() => {
    // Auto-dismiss low severity events after 5 seconds
    if (status?.suspiciousEvents) {
      status.suspiciousEvents.forEach(event => {
        if (event.severity === 'low' && !dismissedEvents.has(event.type)) {
          setTimeout(() => {
            setDismissedEvents(prev => new Set(prev).add(event.type))
            onDismiss?.(event.type)
          }, 5000)
        }
      })
    }
  }, [status, dismissedEvents, onDismiss])

  // Debug logging
  // useEffect(() => {
  //   if (status) {
  //     const eventsCount = status.suspiciousEvents?.length || 0
  //     console.log('🔔 [VisionSecurityAlert] Status received:', {
  //       hasStatus: !!status,
  //       eventsCount: eventsCount,
  //       faceDetected: status.faceDetected,
  //       events: status.suspiciousEvents?.map(e => ({
  //         type: e.type,
  //         severity: e.severity,
  //         timestamp: e.timestamp,
  //         description: e.description
  //       })) || []
  //     })
      
  //     if (eventsCount > 0) {
  //       console.log('🔔 [VisionSecurityAlert] Will render alerts for', eventsCount, 'events')
  //     } else {
  //       console.log('🔔 [VisionSecurityAlert] No events to display')
  //     }
  //   } else {
  //     console.log('🔔 [VisionSecurityAlert] No status received')
  //   }
  // }, [status])

  if (!status) {
    // console.log('🔔 [VisionSecurityAlert] No status, returning null')
    return null
  }

  if (!status.suspiciousEvents || status.suspiciousEvents.length === 0) {
    // console.log('🔔 [VisionSecurityAlert] No suspicious events, returning null')
    return null
  }

  // Filter out dismissed events
  // Group events by type and keep only the most recent one of each type
  // This prevents duplicate alerts for the same event type
  const now = Date.now()
  const eventsByType = new Map<string, SuspiciousEvent>()
  
  // Collect most recent event of each type
  status.suspiciousEvents.forEach(event => {
    const eventKey = `${event.type}-${event.timestamp}`
    const isDismissed = dismissedEvents.has(eventKey)
    
    // Events stay visible for 60 seconds
    const staleThreshold = 60000
    const isRecent = (now - event.timestamp) < staleThreshold
    
    if (!isDismissed && isRecent) {
      const existing = eventsByType.get(event.type)
      // Keep the most recent event of each type
      if (!existing || event.timestamp > existing.timestamp) {
        eventsByType.set(event.type, event)
      }
    }
  })
  
  const activeEvents = Array.from(eventsByType.values())

  // console.log('🔔 [VisionSecurityAlert] Active events after filtering:', activeEvents.length, 'out of', status.suspiciousEvents.length, {
  //   events: activeEvents.map(e => ({ type: e.type, timestamp: e.timestamp, age: now - e.timestamp }))
  // })

  if (activeEvents.length === 0) {
    // console.log('🔔 [VisionSecurityAlert] No active events after filtering, returning null')
    return null
  }

  // Group events by type
  const eventGroups = activeEvents.reduce((acc, event) => {
    if (!acc[event.type]) {
      acc[event.type] = []
    }
    acc[event.type].push(event)
    return acc
  }, {} as Record<string, SuspiciousEvent[]>)

  const getEventIcon = (type: SuspiciousEvent['type']) => {
    switch (type) {
      case 'gaze_away':
        return <EyeOutlined />
      case 'multiple_faces':
        return <UserDeleteOutlined />
      case 'mobile_device_usage':
        return <MobileOutlined />
      default:
        return <WarningOutlined />
    }
  }

  const getEventMessage = (type: SuspiciousEvent['type'], events: SuspiciousEvent[]) => {
    const event = events[0]
    switch (type) {
      case 'gaze_away':
        return `Gaze away from screen detected (${Math.round((event.duration || 0) / 1000)}s)`
      case 'multiple_faces':
        return 'Multiple faces detected in frame'
      case 'face_absent':
        return `Face not detected (${Math.round((event.duration || 0) / 1000)}s)`
      case 'mobile_device_usage':
        return 'Possible mobile device usage detected (looking down)'
      default:
        return event.description
    }
  }

  const getSeverityType = (severity: SuspiciousEvent['severity']): 'error' | 'warning' | 'info' => {
    switch (severity) {
      case 'high':
        return 'error'
      case 'medium':
        return 'warning'
      default:
        return 'info'
    }
  }

  console.log('🔔 [VisionSecurityAlert] Rendering alerts for', Object.keys(eventGroups).length, 'event types')

  return (
    <div className="vision-security-alerts">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {/* Dashboard Toggle Button */}
        <Button
          type="primary"
          icon={<BarChartOutlined />}
          onClick={() => setShowDashboard(!showDashboard)}
          size="small"
        >
          {showDashboard ? 'Hide' : 'Show'} Warning Stats
        </Button>

        {/* Warning Dashboard */}
        {showDashboard && warningStats && (
          <div className="dashboard-container">
            <WarningDashboard warningStats={warningStats} />
          </div>
        )}

        {/* Active Alerts */}
        {Object.entries(eventGroups).map(([type, events]) => {
          const severity = events[0].severity
          const message = getEventMessage(type as SuspiciousEvent['type'], events)
          // console.log('🔔 [VisionSecurityAlert] Rendering alert:', { type, severity, message })
          
          return (
            <Alert
              key={type}
              message={message}
              type={getSeverityType(severity)}
              icon={getEventIcon(type as SuspiciousEvent['type'])}
              closable
              onClose={() => {
                events.forEach(event => {
                  setDismissedEvents(prev => new Set(prev).add(`${event.type}-${event.timestamp}`))
                  onDismiss?.(event.type)
                })
              }}
              showIcon
            />
          )
        })}
      </Space>

      <style>{`
        .vision-security-alerts {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 10000;
          max-width: 450px;
          animation: slideIn 0.3s ease-out;
        }

        .dashboard-container {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          max-height: 400px;
          overflow-y: auto;
        }

        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

export default VisionSecurityAlert


