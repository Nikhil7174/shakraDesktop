import React, { useEffect, useState } from 'react'
import { Alert, Space } from 'antd'
import { WarningOutlined, EyeOutlined, MobileOutlined, UserDeleteOutlined } from '@ant-design/icons'
import type { VisionSecurityStatus, SuspiciousEvent } from '../../../../shared/types'

interface VisionSecurityAlertProps {
  status: VisionSecurityStatus | null
  onDismiss?: (eventType: string) => void
}

export const VisionSecurityAlert: React.FC<VisionSecurityAlertProps> = ({
  status,
  onDismiss
}) => {
  const [dismissedEvents, setDismissedEvents] = useState<Set<string>>(new Set())

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

  if (!status || status.suspiciousEvents.length === 0) {
    return null
  }

  // Filter out dismissed events
  const activeEvents = status.suspiciousEvents.filter(
    event => !dismissedEvents.has(`${event.type}-${event.timestamp}`)
  )

  if (activeEvents.length === 0) {
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
      case 'suspicious_hand_pattern':
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
        return 'Possible mobile device usage detected'
      case 'suspicious_hand_pattern':
        return `Suspicious hand pattern: ${status.suspiciousHandPatterns.join(', ')}`
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

  return (
    <div className="vision-security-alerts">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {Object.entries(eventGroups).map(([type, events]) => {
          const severity = events[0].severity
          return (
            <Alert
              key={type}
              message={getEventMessage(type as SuspiciousEvent['type'], events)}
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
          max-width: 400px;
          animation: slideIn 0.3s ease-out;
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


