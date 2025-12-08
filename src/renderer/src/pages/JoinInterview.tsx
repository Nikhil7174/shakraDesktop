// src/pages/JoinInterview.tsx
import React, { useState, useEffect } from 'react';
import { Card, Typography, Space, Input, Button, App } from 'antd';
import { LinkOutlined, UserOutlined, LeftOutlined } from '@ant-design/icons';
import { colors, spacing } from '../styles';
import { useAppDispatch, useAppSelector } from '../store';
import { useNavigate, useLocation } from 'react-router-dom';
// import { loginSuccess } from '../store/slices/authSlice';
import { setCurrentSession } from '../store/slices/interviewSlice';
import { API_BASE_URL } from '../constants/api';
import { extractToken, extractTokenFromHash, extractTokenFromSearch } from '../utils/tokenExtractor';
import axios from 'axios';

const { Title, Paragraph, Text } = Typography;

export const JoinInterview: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { isAuthenticated, user } = useAppSelector((state) => state.auth);
  const { resumeData, detailedResumeData } = useAppSelector((state) => state.interview);
  const [linkToken, setLinkToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [linkInfo, setLinkInfo] = useState<any>(null);

  const handleBack = () => {
    const from = (location.state as any)?.from;
    if (from) {
      navigate(from, { replace: true });
    } else {
      navigate(-1);
    }
  };

  // Get token from URL parameters (if opened via link)
  useEffect(() => {
    // For Electron apps, we need to handle hash-based routing
    const hash = window.location.hash;
    const search = window.location.search;
    
    let token: string | null = null;
    
    // Try to get token from search parameters first
    token = extractTokenFromSearch(search);
    
    // If not found in search, try to extract from hash
    if (!token) {
      token = extractTokenFromHash(hash);
    }
    
    // Debug logging (can be removed in production)
    // console.log('URL hash:', hash);
    // console.log('URL search:', search);
    // console.log('Extracted token:', token);
    
    if (token) {
      setLinkToken(token);
      handleValidateLink(token);
    }
  }, []);

  // Check if user has resume data, if not redirect to upload flow
  useEffect(() => {
    if (isAuthenticated && !resumeData && !detailedResumeData) {
      message.warning('Please upload your resume first before joining an interview');
      navigate('/interview');
    }
  }, [isAuthenticated, resumeData, detailedResumeData, navigate, message]);

  const handleValidateLink = async (token: string) => {
    if (!token.trim()) {
      message.error('Please enter a valid interview link');
      return;
    }

    // Extract just the token from the input (in case full URL is provided)
    const cleanToken = extractToken(token);

    // Debug logging (can be removed in production)
    // console.log('Original token:', token);
    // console.log('Cleaned token:', cleanToken);
    // console.log('API URL:', `${API_BASE_URL}/interview/link/${cleanToken}`);
    
    setValidating(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/interview/link/${cleanToken}`);
      
      if (response.data.success) {
        // Server returns 'link' not 'linkInfo', and we need to add the token
        setLinkInfo({ ...response.data.link, token: cleanToken });
        message.success('Interview link validated successfully!');
      } else {
        message.error(response.data.message || 'Invalid interview link');
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || 'Failed to validate interview link');
    } finally {
      setValidating(false);
    }
  };

  const handleJoinInterview = async () => {
    if (!linkInfo) {
      message.error('Please validate the link first');
      return;
    }

    if (!isAuthenticated) {
      message.error('Please login first to join the interview');
      return;
    }

    try {
      setLoading(true);
      
      const candidateData = {
        id: user?.id,
        email: user?.email,
        name: user?.fullName,
        phone: user?.phone,
        resumeData: resumeData,
        detailedResumeData: detailedResumeData,
      };

      const response = await axios.post(`${API_BASE_URL}/interview/start`, {
        candidateData,
        linkToken: linkInfo.token
      }, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken')}`
        }
      });

      if (response.data.success) {
        const session = response.data;
        
        console.log('Interview started successfully, session data:', session);
        
        // Save session to Redux
        dispatch(setCurrentSession(session));
        
        message.success('Interview started successfully!');
        // Navigate to interview chat (new flow with resume upload)
        navigate('/interview', { state: { fromLink: true, sessionId: session.sessionId } });
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || 'Failed to start interview');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background.secondary,
      padding: spacing.lg
    }}>
      <Card style={{ maxWidth: 500, width: '100%' }}>
        <div style={{ marginBottom: spacing.md }}>
          <Button type="text" onClick={handleBack} icon={<LeftOutlined />} style={{ padding: 0 }}>
            Back
          </Button>
        </div>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <UserOutlined style={{ fontSize: 48, color: colors.primary.main }} />
            <Title level={2}>Join Interview</Title>
            <Paragraph>
              Enter your interview link to get started with your AI interview session.
            </Paragraph>
          </div>

          <div>
            <Text strong>Interview Link Token:</Text>
            <Input
              placeholder="Enter interview link token"
              value={linkToken}
              onChange={(e) => setLinkToken(e.target.value)}
              prefix={<LinkOutlined />}
              style={{ marginTop: spacing.sm }}
            />
            <Button
              type="primary"
              onClick={() => handleValidateLink(linkToken)}
              loading={validating}
              style={{ marginTop: spacing.md, width: '100%' }}
            >
              Validate Link
            </Button>
          </div>

          {linkInfo && (
            <Card style={{ backgroundColor: colors.success.light + '20', border: `1px solid ${colors.success.main}` }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong style={{ color: colors.success.main }}>
                  ✓ Interview Link Valid
                </Text>
                <div>
                  <Text strong>Title:</Text> {linkInfo.title}
                </div>
              </Space>
            </Card>
          )}

          {linkInfo && (
            <Button
              type="primary"
              size="large"
              onClick={handleJoinInterview}
              loading={loading}
              disabled={!isAuthenticated}
              style={{ width: '100%' }}
            >
              {isAuthenticated ? 'Start Interview' : 'Please Login First'}
            </Button>
          )}

          {!isAuthenticated && (
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">
                You need to be logged in to join an interview.
              </Text>
            </div>
          )}
        </Space>
      </Card>
    </div>
  );
};
