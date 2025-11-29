// src/components/security/SecurityStatus.tsx
import React from 'react';
import { Badge, Tooltip, Typography, Space } from 'antd';
import { 
  SafetyCertificateOutlined, 
  DisconnectOutlined,
  WarningOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { useAppSelector } from '../../store';

const { Text } = Typography;

interface SecurityStatusProps {
  visionSecurityStatus?: {
    faceDetected: boolean
    suspiciousEvents: Array<{ type: string; severity: string }>
  } | null
}

export const SecurityStatus: React.FC<SecurityStatusProps> = ({ visionSecurityStatus }) => {
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
    
    if (cheatingDetected || (visionSecurityStatus?.suspiciousEvents?.some(e => e.severity === 'high'))) {
      return 'Security Alert';
    }
    
    return 'Security Active';
  };

  const getStatusColor = () => {
    if (!isSecurityAgentConnected) {
      return 'error';
    }
    
    if (cheatingDetected || (visionSecurityStatus?.suspiciousEvents?.some(e => e.severity === 'high'))) {
      return 'warning';
    }
    
    return 'success';
  };

  const getTooltipContent = () => {
    if (!isSecurityAgentConnected) {
      return 'Security agent is not connected. Please ensure the security application is running.';
    }
    
    const visionAlerts = visionSecurityStatus?.suspiciousEvents?.filter(e => e.severity === 'high').length || 0;
    
    if (cheatingDetected || visionAlerts > 0) {
      const incidentCount = cheatingIncidents.length;
      const parts = [];
      if (incidentCount > 0) {
        parts.push(`${incidentCount} suspicious application${incidentCount > 1 ? 's' : ''} detected`);
      }
      if (visionAlerts > 0) {
        parts.push(`${visionAlerts} vision security alert${visionAlerts > 1 ? 's' : ''}`);
      }
      return parts.join('. ') + '.';
    }
    
    if (securityStatus?.blockedAppsDetected.length === 0 && (!visionSecurityStatus || visionSecurityStatus.faceDetected)) {
      return 'No suspicious activity detected. Your interview environment is secure.';
    }
    
    return 'Security monitoring is active and protecting your interview.';
  };

  const hasVisionMonitoring = visionSecurityStatus !== undefined;

  return (
    <Tooltip title={getTooltipContent()} placement="bottom">
      <Badge 
        status={getStatusColor() as any} 
        text={
          <Space size="small">
            {getStatusIcon()}
            {hasVisionMonitoring && visionSecurityStatus?.faceDetected && (
              <EyeOutlined style={{ fontSize: 12, color: '#52c41a' }} />
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {getStatusText()}
            </Text>
          </Space>
        }
      />
    </Tooltip>
  );
};


