// src/components/interview/WelcomeBackModal.tsx
import React, { useMemo } from 'react';
import { Modal, Card, Typography, Space, Button, Progress } from 'antd';
import { ClockCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';

const { Title, Paragraph, Text } = Typography;

interface WelcomeBackModalProps {
  visible: boolean;
  questionsAnswered: number;
  totalQuestions: number;
  timeAway: number; // FIXED: Add timeAway prop
  onContinue: () => void;
  onStartNew: () => void;
  onClose: () => void;
}

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} hr ${remainingMinutes} min`;
};

export const WelcomeBackModal: React.FC<WelcomeBackModalProps> = ({
  visible,
  questionsAnswered,
  totalQuestions,
  timeAway, // FIXED: Use timeAway prop
  onContinue,
  onStartNew,
  onClose
}) => {
  console.log('WelcomeBackModal props:', { visible, questionsAnswered, totalQuestions, timeAway });

  // Memoize modal title
  const modalTitle = useMemo(() => (
    <Title level={3} style={{ textAlign: 'center', marginBottom: 0 }}>Welcome Back!</Title>
  ), []);

  // Memoize modal styles
  const modalStyles = useMemo(() => ({
    content: {
      backgroundColor: colors.background.primary,
      borderRadius: 8,
      padding: spacing.lg
    }
  }), []);

  // FIXED: Use timeAway prop instead of hardcoded value
  const sessionInfoDisplay = useMemo(() => {
    return (
      <>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing.md,
          backgroundColor: colors.info.light + '20',
          padding: spacing.md,
          borderRadius: 8
        }}>
          <div style={{ textAlign: 'left' }}>
            <Text type="secondary">Time Away</Text>
            <div style={{ fontSize: 16, fontWeight: 500 }}>
              <ClockCircleOutlined style={{ marginRight: spacing.xs }} />
              {formatDuration(timeAway)} {/* FIXED: Use actual timeAway */}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Text type="secondary">Questions Answered</Text>
            <div style={{ fontSize: 16, fontWeight: 500 }}>
              <FileTextOutlined style={{ marginRight: spacing.xs }} />
              {questionsAnswered} / {totalQuestions}
            </div>
          </div>
        </div>

        <Progress
          percent={(questionsAnswered / totalQuestions) * 100}
          status="active"
          strokeColor={colors.primary.main}
          trailColor={colors.neutral[200]}
          showInfo={false}
        />

        <Paragraph>
          {questionsAnswered === 0 ?
            `You can start your interview with ${totalQuestions} questions.` :
            `You left off at question ${questionsAnswered + 1} of ${totalQuestions}.`
          }
        </Paragraph>
      </>
    );
  }, [questionsAnswered, totalQuestions, timeAway]); // FIXED: Add timeAway to dependencies

  // Memoize action buttons
  const actionButtons = useMemo(() => (
    <Space size="middle" style={{ marginTop: spacing.lg }}>
      <Button size="large" onClick={onStartNew}>
        Start New Interview
      </Button>
      <Button type="primary" size="large" onClick={onContinue}>
        Continue Interview
      </Button>
    </Space>
  ), [onStartNew, onContinue]);

  return (
    <Modal
      title={modalTitle}
      open={visible}
      onCancel={onClose}
      footer={null}
      centered
      maskClosable={false}
      width={600}
      styles={modalStyles}
    >
      <Card style={{ backgroundColor: colors.neutral[50], border: 'none' }}>
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <Paragraph type="secondary">
            It looks like you have an ongoing interview session.
          </Paragraph>

          {sessionInfoDisplay}
          {actionButtons}
        </Space>
      </Card>
    </Modal>
  );
};
