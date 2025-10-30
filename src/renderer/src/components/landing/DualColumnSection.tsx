// src/components/landing/DualColumnSection.tsx
import React, { useCallback } from 'react';
import { Row, Col } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { UserTypeCard } from './UserTypeCard';
import { useUserSelection } from '../../hooks/useUserSelection';
import { useNavigate } from 'react-router-dom';

const intervieweeFeatures = [
  'Join interview sessions',
  'Real-time performance analysis',
  'Industry-specific questions',
  'Confidence building exercises',
];


export const DualColumnSection: React.FC = () => {
  const { activeUserType, selectUserType } = useUserSelection();
  const navigate = useNavigate();

  const handleJoinInterview = useCallback(() => {
    // Always navigate to login page
    navigate('/login', { state: { returnTo: '/join' } });
  }, [navigate]);

  // const _handleStartNewInterview = useCallback(() => {
  //   // Always navigate to login page
  //   navigate('/login', { state: { returnTo: '/interview' } });
  // }, [navigate]);


  return (
    <div style={{
      padding: '60px 24px',
      maxWidth: 1200,
      margin: '0 auto',
    }}>
      <Row gutter={[32, 32]} justify="center">
        <Col xs={24} md={12}>
          <UserTypeCard
            type="interviewee"
            title="Join Interview"
            subtitle="Enter your interview link to start practicing with AI-powered feedback"
            features={intervieweeFeatures}
            ctaText="Join Interview"
            isActive={activeUserType === 'interviewee'}
            onSelect={() => selectUserType('interviewee')}
            onCtaClick={handleJoinInterview}
            icon={<UserOutlined />}
          />
        </Col>

      </Row>
    </div>
  );
};
