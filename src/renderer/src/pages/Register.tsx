import React, { useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Divider, App } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, PhoneOutlined } from '@ant-design/icons';
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
    <>
      <style>
        {`
          .login-signup-button:hover {
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
          }
          .login-signup-button:focus {
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
          }
        `}
      </style>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F3F4F6',
          padding: spacing.lg,
          position: 'relative',
        }}
      >
      <Card
        style={{
          width: '100%',
          maxWidth: 500,
          border: '1px solid #E5E7EB',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          borderRadius: 16,
          background: '#FFFFFF',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: spacing.xl }}>
          <Title level={2} style={{ color: '#111827', marginBottom: spacing.sm }}>
            Create Account
          </Title>
          <Text type="secondary">Join Shakra AI to practice interviews</Text>
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
                background: colors.primary.main,
                border: `1px solid ${colors.primary.main}`,
                boxShadow: 'none',
              }}
              className="login-signup-button"
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
                color: '#111827',
                fontWeight: 500,
              }}
            >
              Sign in
            </Link>
          </Text>
        </div>
      </Card>
    </div>
    </>
  );
};

