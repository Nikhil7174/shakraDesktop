// src/components/security/SecurityStatus.tsx
import React from 'react';
import { Badge, Tooltip, Typography, Space } from 'antd';
import { 
  SafetyCertificateOutlined, 
  DisconnectOutlined,
  WarningOutlined 
} from '@ant-design/icons';
import { useAppSelector } from '../../store';

const { Text } = Typography;

export const SecurityStatus: React.FC = () => {
  const { 
    isSecurityAgentConnected, 
    cheatingDetected, 
    cheatingIncidents, 
    securityStatus 
  } = useAppSelector(state => state.security);

  const getStatusIcon = () => {
    if (!isSecurityAgentConnected) {
      return <DisconnectOutlined style={{ color: '#ff4d4f' }} />;
    }
    
    if (cheatingDetected) {
      return <WarningOutlined style={{ color: '#faad14' }} />;
    }
    
    return <SafetyCertificateOutlined style={{ color: '#52c41a' }} />;
  };

  const getStatusText = () => {
    if (!isSecurityAgentConnected) {
      return 'Security Offline';
    }
    
    if (cheatingDetected) {
      return 'Security Alert';
    }
    
    return 'Security Active';
  };

  const getStatusColor = () => {
    if (!isSecurityAgentConnected) {
      return 'error';
    }
    
    if (cheatingDetected) {
      return 'warning';
    }
    
    return 'success';
  };

  const getTooltipContent = () => {
    if (!isSecurityAgentConnected) {
      return 'Security agent is not connected. Please ensure the security application is running.';
    }
    
    if (cheatingDetected) {
      const incidentCount = cheatingIncidents.length;
      return `${incidentCount} suspicious application${incidentCount > 1 ? 's' : ''} detected and blocked.`;
    }
    
    if (securityStatus?.blockedAppsDetected.length === 0) {
      return 'No suspicious applications detected. Your interview environment is secure.';
    }
    
    return 'Security monitoring is active and protecting your interview.';
  };

  return (
    <Tooltip title={getTooltipContent()} placement="bottom">
      <Badge 
        status={getStatusColor() as any} 
        text={
          <Space size="small">
            {getStatusIcon()}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {getStatusText()}
            </Text>
          </Space>
        }
      />
    </Tooltip>
  );
};


