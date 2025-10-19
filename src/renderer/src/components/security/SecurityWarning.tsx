// src/components/security/SecurityWarning.tsx
import React from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { WarningOutlined, CloseOutlined } from '@ant-design/icons';
import { useAppDispatch, useAppSelector } from '../../store';
import { dismissWarning } from '../../store/slices/securitySlice';

const { Text } = Typography;

export const SecurityWarning: React.FC = () => {
  const dispatch = useAppDispatch();
  const { showWarning, warningMessage, cheatingIncidents, isSecurityAgentConnected } = useAppSelector(state => state.security);

  if (!showWarning) {
    return null;
  }

  const handleDismiss = () => {
    dispatch(dismissWarning());
  };

  const getAlertType = () => {
    if (!isSecurityAgentConnected) {
      return 'warning';
    }
    return cheatingIncidents.length > 0 ? 'error' : 'info';
  };

  const getAlertMessage = () => {
    if (!isSecurityAgentConnected) {
      return 'Security monitoring is not connected. Please ensure the security agent is running.';
    }
    return warningMessage;
  };

  const getDescription = () => {
    if (!isSecurityAgentConnected) {
      return 'The security agent helps monitor for unauthorized applications during your interview.';
    }
    
    if (cheatingIncidents.length > 0) {
      const recentIncidents = cheatingIncidents.slice(-3); // Show last 3 incidents
      return (
        <div>
          <Text type="secondary">
            Recent detections:
          </Text>
          <ul style={{ marginTop: 8, marginBottom: 0 }}>
            {recentIncidents.map((incident) => (
              <li key={incident.id}>
                <Text type="secondary">
                  {incident.processName} - {new Date(incident.timestamp).toLocaleTimeString()}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    
    return null;
  };

  return (
    <Alert
      type={getAlertType()}
      showIcon
      icon={<WarningOutlined />}
      message={
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ color: getAlertType() === 'error' ? '#ff4d4f' : undefined }}>
              {getAlertType() === 'error' ? 'Security Alert' : 'Security Notice'}
            </Text>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={handleDismiss}
              style={{ color: 'rgba(0, 0, 0, 0.45)' }}
            />
          </div>
          <Text>{getAlertMessage()}</Text>
          {getDescription()}
        </Space>
      }
      style={{
        marginBottom: 16,
        borderRadius: 8,
        border: getAlertType() === 'error' ? '1px solid #ff4d4f' : undefined,
      }}
      action={
        <Button size="small" onClick={handleDismiss}>
          Dismiss
        </Button>
      }
    />
  );
};


