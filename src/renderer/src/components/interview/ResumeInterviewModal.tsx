import React from 'react'
import { Modal, Button, Space, Typography } from 'antd'
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

interface ResumeInterviewModalProps {
  visible: boolean
  sessionSummary?: {
    questionsAnswered: number
    totalQuestions: number
    lastActivity: string
    sessionId: string
  }
  onResume: () => void
  onRestart: () => void
  onCancel?: () => void
}

export const ResumeInterviewModal: React.FC<ResumeInterviewModalProps> = ({
  visible,
  sessionSummary,
  onResume,
  onRestart,
  onCancel
}) => {
  const formatLastActivity = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    } catch {
      return 'recently'
    }
  }

  return (
    <Modal
      open={visible}
      title={null}
      footer={null}
      closable={!!onCancel}
      onCancel={onCancel}
      width={520}
      centered
      maskClosable={!!onCancel}
    >
      <div style={{ padding: '24px 8px' }}>
        <Title level={3} style={{ marginBottom: 8, textAlign: 'center' }}>
          Unfinished Interview Detected
        </Title>
        
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 32 }}>
          You have an incomplete interview session
        </Text>

        {sessionSummary && (
          <div style={{
            background: '#f5f5f5',
            borderRadius: 8,
            padding: 20,
            marginBottom: 32
          }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text strong>Progress:</Text>
                <Text>
                  {sessionSummary.questionsAnswered} of {sessionSummary.totalQuestions} questions answered
                </Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text strong>Last Activity:</Text>
                <Text>{formatLastActivity(sessionSummary.lastActivity)}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text strong>Session ID:</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {sessionSummary.sessionId.substring(0, 8)}...
                </Text>
              </div>
            </Space>
          </div>
        )}

        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={onResume}
            block
            style={{ height: 48 }}
          >
            Continue Interview
          </Button>
          
          <Button
            size="large"
            icon={<ReloadOutlined />}
            onClick={onRestart}
            block
            danger
            style={{ height: 48 }}
          >
            Start Fresh Interview
          </Button>

          {onCancel && (
            <Button
              size="large"
              onClick={onCancel}
              block
              style={{ height: 48, marginTop: 8 }}
            >
              Cancel / Go Back
            </Button>
          )}

          <Text
            type="secondary"
            style={{
              display: 'block',
              textAlign: 'center',
              fontSize: 12,
              marginTop: 8
            }}
          >
            Starting fresh will permanently delete your previous session
          </Text>
        </Space>
      </div>
    </Modal>
  )
}








