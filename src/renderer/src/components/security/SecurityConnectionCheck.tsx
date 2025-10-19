// src/components/security/SecurityConnectionCheck.tsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Alert, Spin, Progress } from 'antd';
import { 
  SafetyCertificateOutlined, 
  CheckCircleOutlined,
  ReloadOutlined,
  DisconnectOutlined
} from '@ant-design/icons';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAppSelector } from '../../store';
import { colors, spacing } from '../../styles';

const { Title, Text, Paragraph } = Typography;

interface SecurityConnectionCheckProps {
  onConnectionVerified: () => void;
  onSkip: () => void;
  sessionId?: string;
}

export const SecurityConnectionCheck: React.FC<SecurityConnectionCheckProps> = ({
  onConnectionVerified,
  onSkip,
  sessionId
}) => {
  const [isChecking, setIsChecking] = useState(true);
  const [checkAttempts, setCheckAttempts] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'failed' | 'timeout'>('checking');
  const [canProceed, setCanProceed] = useState(false);
  
  const { isConnected, connectionError } = useWebSocket(sessionId);
  const { securityStatus } = useAppSelector(state => state.security);

  const maxAttempts = 3;
  const checkTimeout = 10000; // 10 seconds

  useEffect(() => {
    if (sessionId) {
      startConnectionCheck();
    }
  }, [sessionId]);

  useEffect(() => {
    if (isConnected && securityStatus) {
      setConnectionStatus('connected');
      setIsChecking(false);
      setCanProceed(true);
    } else if (connectionError && checkAttempts >= maxAttempts) {
      setConnectionStatus('failed');
      setIsChecking(false);
    }
  }, [isConnected, connectionError, securityStatus, checkAttempts]);

  const startConnectionCheck = () => {
    setIsChecking(true);
    setConnectionStatus('checking');
    setCheckAttempts(0);
    
    // Set timeout for connection check
    const timeout = setTimeout(() => {
      if (!isConnected) {
        setConnectionStatus('timeout');
        setIsChecking(false);
      }
    }, checkTimeout);

    return () => clearTimeout(timeout);
  };

  const handleRetry = () => {
    setCheckAttempts(prev => prev + 1);
    startConnectionCheck();
  };

  const handleProceed = () => {
    if (canProceed) {
      onConnectionVerified();
    }
  };

  const handleSkip = () => {
    onSkip();
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <CheckCircleOutlined style={{ fontSize: 48, color: colors.success.main }} />;
      case 'failed':
      case 'timeout':
        return <DisconnectOutlined style={{ fontSize: 48, color: colors.error.main }} />;
      default:
        return <SafetyCertificateOutlined style={{ fontSize: 48, color: colors.primary.main }} />;
    }
  };

  const getStatusTitle = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Security Agent Connected';
      case 'failed':
        return 'Connection Failed';
      case 'timeout':
        return 'Connection Timeout';
      default:
        return 'Checking Security Connection';
    }
  };

  const getStatusDescription = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Your interview environment is now protected. The security agent is actively monitoring for unauthorized applications.';
      case 'failed':
        return 'Unable to connect to the security agent. Please ensure the desktop security application is running and try again.';
      case 'timeout':
        return 'Connection check timed out. The security agent may not be running or there may be a network issue.';
      default:
        return 'Verifying connection to the desktop security agent...';
    }
  };

  // const getAlertType = () => {
  //   switch (connectionStatus) {
  //     case 'connected':
  //       return 'success';
  //     case 'failed':
  //     case 'timeout':
  //       return 'error';
  //     default:
  //       return 'info';
  //   }
  // };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '60vh',
      padding: spacing.xl 
    }}>
      <Card 
        style={{ 
          maxWidth: 600, 
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Status Icon */}
          <div>
            {isChecking ? (
              <Spin size="large" />
            ) : (
              getStatusIcon()
            )}
          </div>

          {/* Status Title */}
          <Title level={3} style={{ margin: 0 }}>
            {getStatusTitle()}
          </Title>

          {/* Status Description */}
          <Paragraph style={{ fontSize: 16, margin: 0 }}>
            {getStatusDescription()}
          </Paragraph>

          {/* Connection Details */}
          {connectionStatus === 'connected' && securityStatus && (
            <Alert
              type="success"
              message="Security Agent Active"
              description={
                <div>
                  <Text>• Monitoring for blocked applications</Text><br />
                  <Text>• Process termination enabled</Text><br />
                  <Text>• Real-time threat detection active</Text>
                </div>
              }
              showIcon
              style={{ textAlign: 'left' }}
            />
          )}

          {/* Error Details */}
          {(connectionStatus === 'failed' || connectionStatus === 'timeout') && (
            <Alert
              type="error"
              message="Security Connection Issue"
              description={
                <div>
                  <Text>Please ensure:</Text><br />
                  <Text>• The desktop security application is running</Text><br />
                  <Text>• No firewall is blocking the connection</Text><br />
                  <Text>• The application is listening on port 8765</Text>
                </div>
              }
              showIcon
              style={{ textAlign: 'left' }}
            />
          )}

          {/* Progress Indicator */}
          {isChecking && (
            <div style={{ width: '100%' }}>
              <Progress 
                percent={Math.min((checkAttempts / maxAttempts) * 100, 90)} 
                status="active"
                strokeColor={colors.primary.main}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Attempt {checkAttempts + 1} of {maxAttempts}
              </Text>
            </div>
          )}

          {/* Action Buttons */}
          <Space size="middle">
            {connectionStatus === 'connected' ? (
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                onClick={handleProceed}
                style={{ minWidth: 150 }}
              >
                Proceed to Interview
              </Button>
            ) : (
              <>
                <Button
                  type="primary"
                  size="large"
                  icon={<ReloadOutlined />}
                  onClick={handleRetry}
                  loading={isChecking}
                  disabled={checkAttempts >= maxAttempts}
                  style={{ minWidth: 150 }}
                >
                  {isChecking ? 'Checking...' : 'Retry Connection'}
                </Button>
                
                <Button
                  size="large"
                  onClick={handleSkip}
                  style={{ minWidth: 150 }}
                >
                  Skip Security Check
                </Button>
              </>
            )}
          </Space>

          {/* Warning for skipping */}
          {connectionStatus !== 'connected' && (
            <Alert
              type="warning"
              message="Security Warning"
              description="Proceeding without security monitoring means the interview will not be protected against cheating attempts. This may affect the validity of your results."
              showIcon
              style={{ textAlign: 'left' }}
            />
          )}
        </Space>
      </Card>
    </div>
  );
};



