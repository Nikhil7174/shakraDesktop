// src/components/landing/UserTypeCard.tsx
import React, { memo, useCallback } from 'react';
import { Card, Typography, Button } from 'antd';
import { motion } from 'framer-motion';
import type { UserType } from '../../types';
import { colors } from '../../styles';
// Import actual images - add your images to src/assets/images/
import intervieweeImage from '../../assets/images/interviewee.png';

const { Title, Text } = Typography;

interface UserTypeCardProps {
  type: UserType;
  title: string;
  subtitle: string;
  features: string[];
  ctaText: string;
  isActive: boolean;
  onSelect: () => void;
  onCtaClick?: () => void;
  icon: React.ReactNode;
}

export const UserTypeCard: React.FC<UserTypeCardProps> = memo(({
  type,
  title,
  subtitle,
  ctaText,
  onSelect,
  onCtaClick,
}) => {
  const handleCtaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCtaClick?.();
  }, [onCtaClick]);

  // Determine card styling based on type
  const isInterviewee = type === 'interviewee';
  // const isCandidate = type === 'candidate';
  const theme = isInterviewee ? colors.card.dark : colors.card.light;
  const imageSrc = intervieweeImage; // Use same image for both types

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300 }}
    >
      <Card
        hoverable
        style={{
          height: 400,
          borderRadius: 24,
          border: 'none',
          boxShadow: isInterviewee
            ? colors.shadows.lg
            : colors.shadows.md,
          transition: 'all 0.3s ease',
          position: 'relative',
          overflow: 'hidden',
          background: theme.background,
        }}
        styles={{ body: { padding: 0, height: '100%' } }}
        onClick={onSelect}
      >
        <div style={{
          display: 'flex',
          height: '100%',
          position: 'relative'
        }}>
          {/* Left Side - Content */}
          <div style={{
            flex: 1,
            padding: '40px 32px',
            zIndex: 2
          }}>
            <Text style={{
              color: theme.subtitle,
              fontSize: '14px',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '8px',
              display: 'block',
              height: '20px' // Fixed height
            }}>
              {isInterviewee ? 'For Candidates' : 'For Candidates'}
            </Text>

            <Title level={2} style={{
              color: theme.text,
              fontSize: '28px',
              fontWeight: 700,
              lineHeight: 1.2,
              marginBottom: '12px',
              margin: 0,
              height: '68px', // Fixed height for title
              display: 'flex',
              alignItems: 'center'
            }}>
              {title}
            </Title>

            <Text style={{
              color: theme.subtitle,
              fontSize: '16px',
              lineHeight: 1.5,
              display: 'block',
              marginBottom: '32px',
              height: '72px', // Fixed height for subtitle
              overflow: 'hidden'
            }}>
              {subtitle}
            </Text>

            {/* CTA Button - placed directly below text with gap */}
            <Button
              type="primary"
              size="large"
              style={{
                height: 48,
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                background: colors.gradient.button,
                border: 'none',
                width: '140px',
                boxShadow: colors.shadows.md,
                marginTop: '8px' // Additional gap between text and button
              }}
              onClick={handleCtaClick}
            >
              {ctaText}
            </Button>
          </div>

          {/* Right Side - Image with Circle */}
          <div style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
            {/* Curly wave pattern */}
            <div style={{
              position: 'absolute',
              right: '-50px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '300px',
              height: '300px',
              background: `conic-gradient(from 0deg at 50% 50%, 
                ${isInterviewee ? '#60A5FA50' : theme.circle + '30'} 0deg, 
                transparent 60deg, 
                ${isInterviewee ? '#60A5FA40' : theme.circle + '20'} 120deg, 
                transparent 180deg, 
                ${isInterviewee ? '#60A5FA45' : theme.circle + '25'} 240deg, 
                transparent 300deg, 
                ${isInterviewee ? '#60A5FA50' : theme.circle + '30'} 360deg)`,
              borderRadius: '50%',
              opacity: 0.7,
              zIndex: 1,
              filter: 'blur(1px)'
            }} />

            {/* Additional curly accent */}
            <div style={{
              position: 'absolute',
              right: '-20px',
              top: '40%',
              width: '150px',
              height: '150px',
              background: `radial-gradient(ellipse at 30% 70%, 
                ${isInterviewee ? '#60A5FA60' : theme.circle + '40'} 0%, 
                transparent 50%), 
                radial-gradient(ellipse at 70% 30%, 
                ${isInterviewee ? '#60A5FA30' : theme.circle + '20'} 0%, 
                transparent 50%)`,
              borderRadius: '50%',
              opacity: 0.5,
              zIndex: 1,
              transform: 'rotate(45deg)'
            }} />

            {/* Small curly dots */}
            <div style={{
              position: 'absolute',
              right: '40px',
              top: '30%',
              width: '12px',
              height: '12px',
              background: `radial-gradient(circle, ${isInterviewee ? '#60A5FA80' : theme.circle + '60'} 0%, transparent 70%)`,
              borderRadius: '50%',
              opacity: 0.8,
              zIndex: 2
            }} />
            <div style={{
              position: 'absolute',
              right: '60px',
              top: '70%',
              width: '8px',
              height: '8px',
              background: `radial-gradient(circle, ${isInterviewee ? '#60A5FA70' : theme.circle + '50'} 0%, transparent 70%)`,
              borderRadius: '50%',
              opacity: 0.6,
              zIndex: 2
            }} />

            {/* Person Image - made wider */}
            <div style={{
              position: 'relative',
              zIndex: 3,
              width: '220px',
              height: '220px',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: colors.shadows.lg,
              background: colors.background.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img
                src={imageSrc}
                alt={isInterviewee ? 'Interviewee' : 'Candidate'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  // Fallback to a simple icon if image fails to load
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement!.innerHTML = `
                    <div style="
                      width: 100%; 
                      height: 100%; 
                      background: ${theme.circle}; 
                      border-radius: 12px; 
                      display: flex; 
                      align-items: center; 
                      justify-content: center;
                      color: white;
                      font-size: 48px;
                    ">
                      ${isInterviewee ? '👤' : '👤'}
                    </div>
                  `;
                }}
              />
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
});

UserTypeCard.displayName = 'UserTypeCard';
