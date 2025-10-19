// src/components/landing/CommonContentRow.tsx
import React from 'react';
import { Typography, Space, Row, Col, Card, Statistic } from 'antd';
import { TrophyOutlined, RiseOutlined, SafetyOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppSelector } from '../../store';
import { colors, spacing, borderRadius, typography } from '../../styles';

const { Title, Paragraph } = Typography;

const intervieweeContent = {
  title: 'Accelerate Your Career Growth',
  description: 'Join thousands of professionals who have improved their interview skills',
  stats: [
    { title: 'Success Rate', value: '87%', icon: <TrophyOutlined />, suffix: 'higher' },
    { title: 'Confidence Boost', value: '3x', icon: <RiseOutlined />, suffix: 'improvement' },
    { title: 'Practice Sessions', value: '50K+', icon: <SafetyOutlined />, suffix: 'completed' },
    { title: 'Avg. Prep Time', value: '2', icon: <ClockCircleOutlined />, suffix: 'weeks' },
  ],
};


export const CommonContentRow: React.FC = () => {
  const { activeUserType } = useAppSelector((state) => state.ui);
  
  const content = activeUserType === 'interviewee' ? intervieweeContent : null;

  if (!content) return null;

  return (
    <div 
      id="common-content"
      style={{ 
        background: colors.background.secondary,
        padding: `${spacing.xxxl}px ${spacing.lg}px`,
        marginTop: spacing.xxl,
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeUserType}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <div style={{ textAlign: 'center', marginBottom: spacing.xxl }}>
                <Title level={2} style={{ 
                  marginBottom: spacing.md,
                  color: colors.neutral[900],
                  fontSize: typography.fontSize['4xl'],
                  fontWeight: typography.fontWeight.bold,
                }}>
                  {content.title}
                </Title>
                <Paragraph style={{ 
                  fontSize: typography.fontSize.lg, 
                  color: colors.neutral[600], 
                  maxWidth: 600, 
                  margin: '0 auto',
                  lineHeight: typography.lineHeight.relaxed,
                }}>
                  {content.description}
                </Paragraph>
              </div>

              <Row gutter={[spacing.lg, spacing.lg]}>
                {content.stats.map((stat, index) => (
                  <Col xs={12} sm={12} md={6} key={index}>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Card 
                        style={{ 
                          textAlign: 'center',
                          borderRadius: borderRadius.xl,
                          border: 'none',
                          boxShadow: colors.shadows.sm,
                          background: colors.background.primary,
                          height: '100%',
                        }}
                        bodyStyle={{ padding: spacing.xl }}
                      >
                        <div style={{ 
                          fontSize: 32, 
                          color: colors.primary.main, 
                          marginBottom: spacing.md 
                        }}>
                          {stat.icon}
                        </div>
                        <Statistic
                          title={
                            <span style={{ 
                              color: colors.neutral[600],
                              fontSize: typography.fontSize.sm,
                              fontWeight: typography.fontWeight.medium,
                            }}>
                              {stat.title}
                            </span>
                          }
                          value={stat.value}
                          suffix={
                            <span style={{ 
                              fontSize: typography.fontSize.sm, 
                              color: colors.neutral[500],
                              fontWeight: typography.fontWeight.normal,
                            }}>
                              {stat.suffix}
                            </span>
                          }
                          valueStyle={{ 
                            color: colors.neutral[900], 
                            fontWeight: typography.fontWeight.bold,
                            fontSize: typography.fontSize['2xl'],
                          }}
                        />
                      </Card>
                    </motion.div>
                  </Col>
                ))}
              </Row>
            </Space>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};