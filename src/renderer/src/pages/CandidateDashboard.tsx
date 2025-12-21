import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card,
  Button,
  Table,
  Typography,
  Space,
  Row,
  Col,
  Statistic,
  Empty,
  Tooltip,
} from 'antd';
import {
  ClockCircleOutlined,
  FileTextOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { colors, spacing } from '../styles';
import { API_BASE_URL } from '../constants/api';
import { useAppSelector } from '../store';

const { Title, Text } = Typography;

interface InterviewAttempt {
  id: number;
  sessionId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  score?: number;
  startTime: string;
  endTime?: string;
  duration?: number;
  totalQuestions: number;
  answeredQuestions: number;
}

export const CandidateDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { token } = useAppSelector((state) => state.auth);
  
  // State management
  const [attempts, setAttempts] = useState<InterviewAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  
  // Memoized fetch function - React will handle when to call this
  const fetchAttempts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (!token) {
        throw new Error('No authentication token found');
      }

      console.log('Fetching interviews with token:', token.substring(0, 20) + '...');
      console.log('API URL:', `${API_BASE_URL}/auth/interviews`);

      const response = await fetch(`${API_BASE_URL}/auth/interviews`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const data = await response.json();
        console.log('Response data:', data);
        if (data.success) {
          setAttempts(data.interviews || []);
          setLastFetched(new Date());
          console.log('Successfully fetched', data.interviews?.length || 0, 'interviews');
        } else {
          throw new Error(data.error || 'Failed to fetch interviews');
        }
      } else {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch interviews';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [token]); // Include token in dependency array

  // Manual refetch function
  const refetch = useCallback(() => {
    return fetchAttempts();
  }, [fetchAttempts]);

  // Initial fetch
  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  // Listen for refresh events (triggered after interview completion)
  useEffect(() => {
    const handleRefresh = () => {
      console.log('🔄 Dashboard refresh triggered');
      fetchAttempts();
    };

    window.addEventListener('dashboard-refresh', handleRefresh);
    
    // Listen for storage event (for cross-tab updates)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dashboard-needs-refresh') {
        fetchAttempts();
        localStorage.removeItem('dashboard-needs-refresh');
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('dashboard-refresh', handleRefresh);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [fetchAttempts]);

  // Memoized computed values
  const completedAttempts = useMemo(() => 
    attempts.filter((a) => a.status === 'completed'), 
    [attempts]
  );

  const totalDuration = useMemo(() => {
    // Calculate total duration from all completed interviews using startTime and endTime
    return completedAttempts.reduce((total, attempt) => {
      if (attempt.startTime && attempt.endTime) {
        const start = new Date(attempt.startTime).getTime();
        const end = new Date(attempt.endTime).getTime();
        const durationMs = end - start;
        return total + durationMs;
      }
      return total;
    }, 0);
  }, [completedAttempts]);
  
  // Format duration in hours and minutes
  const formatDuration = (ms: number) => {
    const totalMinutes = Math.round(ms / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const inProgressCount = useMemo(() => 
    attempts.filter((a) => a.status === 'in_progress').length,
    [attempts]
  );

  const isStale = useMemo(() => {
    if (!lastFetched) return true;
    return Date.now() - lastFetched.getTime() > 300000; // 5 minutes
  }, [lastFetched]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/');
  }, [logout, navigate]);

  const handleJoinInterview = useCallback(() => {
    // Pass a flag to tell InterviewChat to check for existing session
    navigate('/interview', { state: { checkExistingSession: true } });
  }, [navigate]);

  // Memoized table columns
  const columns = useMemo(() => [
    {
      title: 'Interview Name',
      dataIndex: 'title',
      key: 'title',
      render: (title: string) => <strong>{title}</strong>,
    },
    {
      title: 'Date',
      dataIndex: 'startTime',
      key: 'startTime',
      render: (date: string) => dayjs(date).format('MMM D, YYYY'),
    },
  ], []);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: spacing.xl }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
            borderRadius: 16,
            padding: spacing.xl,
            marginBottom: spacing.xl,
            color: 'white',
          }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Title level={2} style={{ color: 'white', margin: 0 }}>
                Welcome, {user?.fullName}!
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>
                {attempts.length === 0 
                  ? "Ready to take your first interview? Let's get started!"
                  : `You've completed ${completedAttempts.length} interview${completedAttempts.length !== 1 ? 's' : ''}. Keep practicing!`
                }
              </Text>
              {lastFetched && (
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, display: 'block', marginTop: 4 }}>
                  Last updated: {dayjs(lastFetched).format('MMM D, YYYY h:mm A')}
                  {isStale && (
                    <Tooltip title="Data is stale - click refresh to get latest updates">
                      <ExclamationCircleOutlined style={{ marginLeft: 8, color: '#ffa940' }} />
                    </Tooltip>
                  )}
                </Text>
              )}
            </Col>
            <Col>
              <Space>
                <Tooltip title="Refresh interview data">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={refetch}
                    loading={loading}
                    size="large"
                    style={{
                      background: 'rgba(255,255,255,0.2)',
                      color: 'white',
                      border: 'none',
                    }}
                  />
                </Tooltip>
                <Button
                  type="default"
                  icon={<PlayCircleOutlined />}
                  onClick={handleJoinInterview}
                  size="large"
                  style={{
                    background: 'white',
                    color: colors.primary.main,
                    border: 'none',
                    fontWeight: 600,
                  }}
                >
                  {attempts.length === 0 ? 'Start Your First Interview' : 'Take Another Interview'}
                </Button>
                <Button
                  icon={<LogoutOutlined />}
                  onClick={handleLogout}
                  size="large"
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  Logout
                </Button>
              </Space>
            </Col>
          </Row>
        </div>

        {/* Error Display */}
        {error && (
          <Card style={{ marginBottom: spacing.xl, border: `1px solid ${colors.error.main}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
              <ExclamationCircleOutlined style={{ color: colors.error.main, fontSize: 20 }} />
              <div>
                <Text strong style={{ color: colors.error.main }}>Failed to load interview data</Text>
                <br />
                <Text type="secondary">{error}</Text>
                <br />
                <Button 
                  type="link" 
                  onClick={refetch} 
                  loading={loading}
                  style={{ padding: 0, marginTop: 4 }}
                >
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Statistics */}
        <Row gutter={16} style={{ marginBottom: spacing.xl }}>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="Total Interviews"
                value={attempts.length}
                prefix={<FileTextOutlined />}
                valueStyle={{ color: colors.primary.main }}
                loading={loading}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="In Progress"
                value={inProgressCount}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ color: colors.warning.main }}
                loading={loading}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="Total Interview Duration"
                value={formatDuration(totalDuration)}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ color: colors.info.main }}
                loading={loading}
              />
            </Card>
          </Col>
        </Row>

        {/* Interview History */}
        <Card
          title={<Title level={4} style={{ margin: 0 }}>Interview History</Title>}
          style={{ borderRadius: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
          extra={
            <Space>
              <Tooltip title="Refresh data">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={refetch}
                  loading={loading}
                  size="small"
                />
              </Tooltip>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleJoinInterview}
                style={{
                  background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
                  border: 'none',
                }}
              >
                Start New Interview
              </Button>
            </Space>
          }
        >
          {attempts.length > 0 ? (
            completedAttempts.length > 0 ? (
              <Table
                columns={columns}
                dataSource={completedAttempts}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 10 }}
              />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: spacing.md }}>
                      You have interviews in progress. Complete them to see your scores!
                    </Text>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={handleJoinInterview}
                      size="large"
                      style={{
                        background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
                        border: 'none',
                      }}
                    >
                      Continue Interview
                    </Button>
                  </div>
                }
              />
            )
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: spacing.md }}>
                    You haven't taken any interviews yet
                  </Text>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={handleJoinInterview}
                    size="large"
                    style={{
                      background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
                      border: 'none',
                    }}
                  >
                    Join Your First Interview
                  </Button>
                </div>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
};


