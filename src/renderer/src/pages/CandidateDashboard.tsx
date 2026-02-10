import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Button,
  Table,
  Typography,
  Space,
  Row,
  Col,
  Empty,
  Input,
} from 'antd';
import {
  LogoutOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  CalendarOutlined,
  BuildOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { colors } from '../styles';
import { useAppSelector } from '../store';
import api from '../services/api';

import './CandidateDashboard.css';

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
  company?: string;
  companyId?: number;
  companyLogo?: string;
}

export const CandidateDashboard: React.FC = () => {
  const { user, logout, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { isSynced } = useAppSelector((state) => state.auth);

  console.log('🎯 [CandidateDashboard] Rendering with user:', user?.fullName);

  // State management
  const [attempts, setAttempts] = useState<InterviewAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);


  // Safety check: Redirect if no user data is available
  useEffect(() => {
    if (!user && !authLoading) {
      console.warn('⚠️ [CandidateDashboard] No user data found. Redirecting to login...');
      navigate('/login');
    }
  }, [user, authLoading, navigate]);

  // Memoized fetch function - React will handle when to call this
  const fetchAttempts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (!isSynced) {
        console.log('⏳ [CandidateDashboard] Waiting for auth sync...');
        setLoading(true);
        return;
      }

      // api instance handles token from localStorage automatically via interceptor
      console.log('Fetching interviews via Axios...');

      const response = await api.get('/auth/interviews');

      console.log('Response status:', response.status);

      if (response.data.success) {
        setAttempts(response.data.interviews || []);
        setLastFetched(new Date());
        console.log('Successfully fetched', response.data.interviews?.length || 0, 'interviews');
      } else {
        throw new Error(response.data.error || 'Failed to fetch interviews');
      }
    } catch (err: any) {
      console.error('API Error:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch interviews';
      setError(errorMessage);
      // Handle 401 specifically if needed, though interceptor might do it
      if (err.response?.status === 401) {
        console.warn('Unauthorized access - token might be invalid/expired');
      }
    } finally {
      setLoading(false);
    }
  }, [isSynced]); // Reduced dependencies as token is handled internally by api interceptor

  // Manual refetch function
  const refetch = useCallback(() => {
    return fetchAttempts();
  }, [fetchAttempts]);

  // Initial fetch
  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  // Listen for auth sync completion
  useEffect(() => {
    if (isSynced) {
      console.log('✨ [CandidateDashboard] Auth synced, fetching data...');
      fetchAttempts();
    }
  }, [isSynced, fetchAttempts]);
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

  // Count completed interviews in the current month
  const interviewsThisMonth = useMemo(() => {
    if (completedAttempts.length === 0) return 0;
    const startOfMonth = dayjs().startOf('month');
    const endOfMonth = dayjs().endOf('month');
    return completedAttempts.filter((attempt) => {
      if (!attempt.startTime) return false;
      const interviewDate = dayjs(attempt.startTime);
      return interviewDate.isAfter(startOfMonth) && interviewDate.isBefore(endOfMonth);
    }).length;
  }, [completedAttempts]);

  const companiesCount = useMemo(() => {
    // Unique companies based on companyId (preferred) or company name
    const companyIds = new Set(
      attempts
        .filter(a => a.companyId)
        .map(a => a.companyId)
    );

    // Fallback to names if IDs aren't available for some logic
    const companyNames = new Set(
      attempts
        .filter(a => !a.companyId && a.company)
        .map(a => a.company!.trim())
    );

    return companyIds.size + companyNames.size;
  }, [attempts]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/');
  }, [logout, navigate]);

  const handleJoinInterview = useCallback(() => {
    // Check if an interview was completed in this app session
    navigate('/interview');
  }, [navigate]);

  // Search state
  const [companySearchText, setCompanySearchText] = useState('');
  const [companySearchVisible, setCompanySearchVisible] = useState(false);
  const [titleSearchText, setTitleSearchText] = useState('');
  const [titleSearchVisible, setTitleSearchVisible] = useState(false);

  // Filter attempts based on search text
  const filteredAttempts = useMemo(() => {
    let result = completedAttempts;

    if (companySearchText) {
      const lower = companySearchText.toLowerCase();
      result = result.filter(a => (a.company || '').toLowerCase().includes(lower));
    }

    if (titleSearchText) {
      const lower = titleSearchText.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(lower));
    }

    return result;
  }, [completedAttempts, companySearchText, titleSearchText]);

  // Memoized table columns with Phase 4: Typography improvements
  const columns = useMemo(() => [
    {
      title: (
        <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {companySearchVisible ? (
            <Input
              placeholder="Search company..."
              value={companySearchText}
              onChange={(e) => setCompanySearchText(e.target.value)}
              onBlur={() => {
                if (!companySearchText) setCompanySearchVisible(false);
              }}
              autoFocus
              prefix={<SearchOutlined style={{ color: '#9CA3AF' }} />}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', fontSize: 13 }}
            />
          ) : (
            <div
              onClick={() => setCompanySearchVisible(true)}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 8,
                width: '100%',
                height: '100%'
              }}
            >
              Company <SearchOutlined style={{ fontSize: 12, color: '#9CA3AF' }} />
            </div>
          )}
        </div>
      ),
      dataIndex: 'company',
      key: 'company',
      width: 300,
      render: (company: string, record: InterviewAttempt) => (
        <Space>
          {record.companyLogo && (
            <img
              src={record.companyLogo}
              alt={company}
              style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }}
            />
          )}
          <Text style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
            {company || 'Unknown Company'}
          </Text>
        </Space>
      ),
    },
    {
      title: (
        <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {titleSearchVisible ? (
            <Input
              placeholder="Search interview..."
              value={titleSearchText}
              onChange={(e) => setTitleSearchText(e.target.value)}
              onBlur={() => {
                if (!titleSearchText) setTitleSearchVisible(false);
              }}
              autoFocus
              prefix={<SearchOutlined style={{ color: '#9CA3AF' }} />}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', fontSize: 13 }}
            />
          ) : (
            <div
              onClick={() => setTitleSearchVisible(true)}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 8,
                width: '100%',
                height: '100%'
              }}
            >
              Interview Name <SearchOutlined style={{ fontSize: 12, color: '#9CA3AF' }} />
            </div>
          )}
        </div>
      ),
      dataIndex: 'title',
      key: 'title',
      width: 400,
      render: (title: string) => (
        <Text style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.6, color: '#111827' }}>
          {title}
        </Text>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'startTime',
      key: 'startTime',
      width: '20%',
      render: (date: string) => (
        <Text style={{ fontSize: 14, fontWeight: 400, lineHeight: 1.6, color: '#6B7280' }}>
          {dayjs(date).format('MMM D, YYYY')}
        </Text>
      ),
    },
  ], [companySearchVisible, companySearchText, titleSearchVisible, titleSearchText]);

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', padding: '32px 0' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 32px' }}>
        {/* Phase 1: Premium Header */}
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            padding: '24px 32px',
            marginBottom: 32,
          }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Title level={2} style={{ margin: 0, marginBottom: 4, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                Your Interviews
              </Title>
              <Text style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.6 }}>
                Welcome back, {user?.fullName}
              </Text>
            </Col>
            <Col>
              <Space size={12}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={refetch}
                  loading={loading}
                  size="large"
                  type="text"
                  style={{
                    color: '#6B7280',
                    border: 'none',
                    fontSize: '16px',
                    height: '36px',
                  }}
                >
                </Button>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleJoinInterview}
                  size="large"
                  className="primary-cta-btn"
                  style={{
                    background: colors.primary.main,
                    border: 'none',
                    fontWeight: 500,
                    boxShadow: 'none',
                    fontSize: '16px',
                    height: '36px',
                  }}
                >
                  {attempts.length === 0 ? 'Start Your First Interview' : 'Take Interview'}
                </Button>
                <Button
                  icon={<LogoutOutlined />}
                  onClick={handleLogout}
                  size="large"
                  type="text"
                  loading={authLoading}
                  className="ghost-logout-btn"
                  style={{
                    color: '#6B7280',
                    border: '1px solid #E5E7EB',
                    background: '#F3F4F6',
                    borderRadius: 6,
                    fontSize: '16px',
                    height: '36px',
                  }}
                >
                  Logout
                </Button>
              </Space>
            </Col>
          </Row>
        </div>

        <div>

          {/* Error Display */}
          {error && (
            <Card
              style={{
                marginBottom: 32,
                border: '1px solid #FCA5A5',
                background: '#FEF2F2',
                boxShadow: 'none',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <ExclamationCircleOutlined style={{ color: '#DC2626', fontSize: 20 }} />
                <div>
                  <Text strong style={{ color: '#DC2626', lineHeight: 1.6 }}>Failed to load interview data</Text>
                  <br />
                  <Text style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.6 }}>{error}</Text>
                  <br />
                  <Button
                    type="link"
                    onClick={refetch}
                    loading={loading}
                    style={{ padding: 0, marginTop: 4, height: 'auto' }}
                  >
                    Try again
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Phase 2: Summary Bar */}
          <Card
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              boxShadow: 'none',
              borderRadius: 8,
              marginBottom: 32,
            }}
            bodyStyle={{ padding: '16px 20px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#D1FAE5',
                  border: '1px solid #A7F3D0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <FileTextOutlined style={{ color: '#10B981', fontSize: 20 }} />
                </span>
                <Text style={{ color: '#374151', fontSize: 14 }}>
                  <Text style={{ color: '#6B7280', fontWeight: 500 }}>Completed:</Text>{' '}
                  <Text strong style={{ color: '#111827', fontWeight: 800 }}>
                    {loading ? '—' : completedAttempts.length}
                  </Text>
                </Text>
              </div>

              <Text style={{ color: '#9CA3AF' }}>|</Text>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <CalendarOutlined style={{ color: '#F59E0B', fontSize: 20 }} />
                </span>
                <Text style={{ color: '#374151', fontSize: 14 }}>
                  <Text style={{ color: '#6B7280', fontWeight: 500 }}>This Month:</Text>{' '}
                  <Text strong style={{ color: '#111827', fontWeight: 800 }}>
                    {loading ? '—' : interviewsThisMonth}
                  </Text>
                </Text>
              </div>

              <Text style={{ color: '#9CA3AF' }}>|</Text>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#E0F2FE',
                  border: '1px solid #BAE6FD',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <BuildOutlined style={{ color: '#0284C7', fontSize: 20 }} />
                </span>
                <Text style={{ color: '#374151', fontSize: 14 }}>
                  <Text style={{ color: '#6B7280', fontWeight: 500 }}>Companies:</Text>{' '}
                  <Text strong style={{ color: '#111827', fontWeight: 800 }}>
                    {loading ? '—' : companiesCount}
                  </Text>
                </Text>
              </div>
            </div>
          </Card>

          {/* Phase 3: Premium Table */}
          <Card
            title={
              <Title level={4} style={{ margin: 0, fontWeight: 600, fontSize: 18, lineHeight: 1.5 }}>
                Interview History
              </Title>
            }
            style={{
              borderRadius: 8,
              boxShadow: 'none',
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
            }}
            bodyStyle={{ padding: 24 }}
          >
            {attempts.length > 0 ? (
              completedAttempts.length > 0 ? (
                <Table
                  columns={columns}
                  dataSource={filteredAttempts}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  className="premium-table"
                  style={{
                    borderRadius: 8,
                  }}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <div>
                      <Text style={{ display: 'block', marginBottom: 16, color: '#6B7280', fontSize: 14, lineHeight: 1.6 }}>
                        You have interviews in progress. Complete them to see your scores!
                      </Text>
                      <Button
                        icon={<PlayCircleOutlined />}
                        onClick={handleJoinInterview}
                        size="large"
                        className="primary-cta-btn"
                        style={{
                          color: colors.primary.main,
                          borderColor: colors.primary.main,
                          background: 'transparent',
                          fontWeight: 500,
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
                    <Text style={{ display: 'block', marginBottom: 16, color: '#6B7280', fontSize: 14, lineHeight: 1.6 }}>
                      You haven't taken any interviews yet
                    </Text>
                    <Button
                      icon={<PlayCircleOutlined />}
                      onClick={handleJoinInterview}
                      size="large"
                      style={{
                        color: colors.primary.main,
                        borderColor: colors.primary.main,
                        background: 'transparent',
                        fontWeight: 500,
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
    </div>
  );
};
