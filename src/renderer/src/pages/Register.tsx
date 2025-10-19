import React, { useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Divider, App } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, PhoneOutlined, LeftOutlined } from '@ant-design/icons';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { colors, spacing } from '../styles';
import { useAuth } from '../hooks/useAuth';

const { Title, Text } = Typography;

export const Register: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { register, loading, isAuthenticated, user } = useAuth();
  const [form] = Form.useForm();
  
  // Get return to path from navigation state
  const returnTo = (location.state as any)?.returnTo;
  
  // Only allow candidate signup - userType is hardcoded to 'candidate'

  const handleBack = () => {
    // Always navigate to home page
    navigate('/', { replace: true });
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const redirectTo = returnTo || '/candidate/dashboard';
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, user, navigate, returnTo]);

  const handleSubmit = async (values: any) => {
    try {
      await register({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        userType: values.userType,
        phone: values.phone,
        company: values.company,
      });
      message.success('Registration successful!');
      // Navigation will be handled by the useEffect above
    } catch (error: any) {
      message.error(error.message || 'Registration failed');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
        padding: spacing.lg,
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
          borderRadius: 16,
        }}
      >
        <div style={{ marginBottom: spacing.md }}>
          <Button type="text" onClick={handleBack} icon={<LeftOutlined />} style={{ padding: 0 }}>
            Back
          </Button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: spacing.xl }}>
          <Title level={2} style={{ color: colors.primary.main, marginBottom: spacing.sm }}>
            Create Account
          </Title>
          <Text type="secondary">Join Crisp to practice interviews</Text>
        </div>

        <Form
          form={form}
          name="register"
          onFinish={handleSubmit}
          layout="vertical"
          size="large"
          autoComplete="off"
          initialValues={{ userType: 'candidate' }}
        >
          {/* Hidden field to always set userType as candidate */}
          <Form.Item name="userType" style={{ display: 'none' }}>
            <Input value="candidate" />
          </Form.Item>

          <Form.Item
            name="fullName"
            rules={[{ required: true, message: 'Please enter your full name!' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="Full Name"
              style={{ borderRadius: 8 }}
            />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email!' },
              { type: 'email', message: 'Please enter a valid email!' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Email"
              style={{ borderRadius: 8 }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Please enter a password!' },
              { min: 8, message: 'Password must be at least 8 characters!' },
              {
                pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                message: 'Password must contain uppercase, lowercase, and number!',
              },
            ]}
            hasFeedback
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
              style={{ borderRadius: 8 }}
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            hasFeedback
            rules={[
              { required: true, message: 'Please confirm your password!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match!'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Confirm Password"
              style={{ borderRadius: 8 }}
            />
          </Form.Item>

          <Form.Item name="phone">
            <Input
              prefix={<PhoneOutlined />}
              placeholder="Phone (Optional)"
              style={{ borderRadius: 8 }}
            />
          </Form.Item>


          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${colors.primary.main} 0%, ${colors.info.main} 100%)`,
                border: 'none',
              }}
            >
              Sign Up
            </Button>
          </Form.Item>
        </Form>

        <Divider />

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">
            Already have an account?{' '}
            <Link
              to="/login"
              style={{
                color: colors.primary.main,
                fontWeight: 500,
              }}
            >
              Sign in
            </Link>
          </Text>
        </div>
      </Card>
    </div>
  );
};

