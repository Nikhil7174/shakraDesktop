// src/components/interview/InfoCollection.tsx
import React, { useEffect, useCallback, useMemo } from 'react';
import { Card, Typography, Space, Form, Input, Button, Spin } from 'antd';
import { CheckCircleOutlined, EditOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';
import type { ResumeData, DetailedResumeData } from '../../types';

const { Title, Paragraph, Text } = Typography;

interface InfoCollectionProps {
  resumeData: ResumeData | null;
  detailedResumeData: DetailedResumeData | null;
  onSubmit: (info: { name: string; email: string; phone: string }) => void;
  loading: boolean;
  error?: string | null;
}

export const InfoCollection: React.FC<InfoCollectionProps> = ({
  resumeData,
  onSubmit,
  loading,
  error
}) => {
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      name: resumeData?.name || '',
      email: resumeData?.email || '',
      phone: resumeData?.phone || '',
    });
  }, [resumeData, form]);

  const handleSubmit = useCallback((values: { name: string; email: string; phone: string }) => {
    onSubmit(values);
  }, [onSubmit]);

  const getFieldHelp = useCallback((fieldName: string) => {
    const hasValue = resumeData?.[fieldName as keyof ResumeData];
    return hasValue ? (
      <Text type="secondary" style={{ color: colors.success.main }}>
        <CheckCircleOutlined />
      </Text>
    ) : (
      'This field is required'
    );
  }, [resumeData]);

  const getFieldStatus = useCallback((fieldName: string) => {
    const hasValue = resumeData?.[fieldName as keyof ResumeData];
    return {
      style: hasValue ? {
        backgroundColor: colors.success.light + '20',
        borderColor: colors.success.main
      } : {},
      prefix: hasValue ? <EditOutlined style={{ color: colors.success.main }} /> : undefined
    };
  }, [resumeData]);

  // Memoize initial form values
  const initialValues = useMemo(() => ({
    name: resumeData?.name || '',
    email: resumeData?.email || '',
    phone: resumeData?.phone || '',
  }), [resumeData]);

  // Memoize error display
  const errorDisplay = useMemo(() => {
    if (!error) return null;

    return (
      <div style={{
        padding: spacing.md,
        backgroundColor: colors.error.light + '20',
        border: `1px solid ${colors.error.main}`,
        borderRadius: 8,
        color: colors.error.main
      }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }, [error]);

  // Memoize form fields
  const nameField = useMemo(() => (
    <Form.Item
      label="Name"
      name="name"
      rules={[{ required: true, message: 'Please enter your name!' }]}
      help={getFieldHelp('name')}
    >
      <Input
        placeholder="Your Name"
        {...getFieldStatus('name')}
        disabled={loading}
      />
    </Form.Item>
  ), [getFieldHelp, getFieldStatus, loading]);

  const emailField = useMemo(() => (
    <Form.Item
      label="Email"
      name="email"
      rules={[
        { required: true, message: 'Please enter your email!' },
        { type: 'email', message: 'Please enter a valid email!' }
      ]}
      help={getFieldHelp('email')}
    >
      <Input
        placeholder="Your Email"
        {...getFieldStatus('email')}
        disabled={loading}
      />
    </Form.Item>
  ), [getFieldHelp, getFieldStatus, loading]);

  const phoneField = useMemo(() => (
    <Form.Item
      label="Phone Number"
      name="phone"
      rules={[{ required: true, message: 'Please enter your phone number!' }]}
      help={getFieldHelp('phone')}
    >
      <Input
        placeholder="Your Phone Number"
        {...getFieldStatus('phone')}
        disabled={loading}
      />
    </Form.Item>
  ), [getFieldHelp, getFieldStatus, loading]);

  const submitButton = useMemo(() => (
    <Form.Item style={{ marginTop: spacing.lg }}>
      <Button
        type="primary"
        htmlType="submit"
        size="large"
        block
        loading={loading}
        disabled={loading}
      >
        {loading ? 'Processing...' : 'Continue to Interview'}
      </Button>
    </Form.Item>
  ), [loading]);

  return (
    <Card style={{ maxWidth: 600, margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={3}>Complete Your Information</Title>
          <Paragraph>
            Please provide any missing information to proceed with your interview.
          </Paragraph>
        </div>

        {errorDisplay}

        <Spin spinning={loading} tip="Processing information...">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={initialValues}
          >
            {nameField}
            {emailField}
            {phoneField}
            {submitButton}
          </Form>
        </Spin>
      </Space>
    </Card>
  );
};

