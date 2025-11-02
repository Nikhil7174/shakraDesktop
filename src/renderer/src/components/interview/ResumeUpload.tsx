// src/components/interview/ResumeUpload.tsx
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, Typography, Space, Upload, Spin, Progress, Button } from 'antd';
import { UploadOutlined, FileTextOutlined, RobotOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../styles';
import type { ResumeData } from '../../types';

const { Title, Paragraph, Text } = Typography;

interface ResumeUploadProps {
  onUpload: (file: File) => void;
  loading: boolean; // Overall loading state from hook
  error?: string | null;
  onRemoveFile: () => void;
  isProcessing: boolean; // New prop to indicate AI processing
  resumeData?: ResumeData | null; // To show file details if already processed
  existingResumeData?: any; // Existing resume data from user profile
  onUseExistingResume?: () => void; // Callback to use existing resume
  existingFileName?: string; // Name of the stored PDF file
}

export const ResumeUpload: React.FC<ResumeUploadProps> = ({
  onUpload,
  loading,
  error,
  onRemoveFile,
  isProcessing,
  resumeData,
  existingResumeData,
  onUseExistingResume,
  existingFileName
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    // If resumeData is available and we were processing, show success briefly
    if (resumeData && isProcessing && !loading) {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 1000); // Show success for 1 second
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [resumeData, isProcessing, loading]);

  const handleFileUpload = useCallback((file: File) => {
    setSelectedFile(file);
    onUpload(file);
    return false; // Prevent Ant Design from uploading
  }, [onUpload]);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    onRemoveFile();
    setShowSuccess(false);
  }, [onRemoveFile]);

  const formatBytes = useCallback((bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }, []);

  const getFileIcon = useCallback((fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension === 'pdf' ? <FileTextOutlined /> : <FileTextOutlined />; // Using generic file icon for now
  }, []);

  // Memoize processing content
  const processingContent = useMemo(() => (
    <div style={{ textAlign: 'center', padding: spacing.xl }}>
      <Spin indicator={<RobotOutlined style={{ fontSize: 64, color: colors.primary.main }} spin />} />
      <Title level={4} style={{ color: colors.primary.main, marginTop: spacing.md }}>
        AI is analyzing your resume...
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        This may take a few moments
      </Paragraph>
      <Progress
        percent={75} // Simulate progress
        status="active"
        showInfo={false}
        strokeColor={colors.primary.main}
        trailColor={colors.neutral[200]}
        style={{ marginTop: spacing.md }}
      />
    </div>
  ), []);

  // Memoize success content
  const successContent = useMemo(() => (
    <div style={{ textAlign: 'center', padding: spacing.xl }}>
      <CheckCircleOutlined style={{ fontSize: 64, color: colors.success.main }} />
      <Title level={4} style={{ color: colors.success.main, marginTop: spacing.md }}>
        Resume processed successfully!
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        Moving to next step...
      </Paragraph>
    </div>
  ), []);

  // Memoize file display content
  const fileDisplayContent = useMemo(() => {
    if (!selectedFile) return null;

    return (
      <div style={{
        padding: spacing.lg,
        backgroundColor: colors.neutral[50],
        borderRadius: 8,
        border: `1px solid ${colors.neutral[200]}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: spacing.md
      }}>
        <Space direction="horizontal" align="center">
          <Text style={{ fontSize: 48, color: colors.primary.main }}>
            {getFileIcon(selectedFile.name)}
          </Text>
          <Space direction="vertical" size={spacing.xs}>
            <Text strong style={{ fontSize: 16 }}>{selectedFile.name}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(selectedFile.size)} ({selectedFile.type})
            </Text>
          </Space>
        </Space>
        <Button danger onClick={handleRemoveFile} disabled={loading}>
          Remove File
        </Button>
      </div>
    );
  }, [selectedFile, getFileIcon, formatBytes, handleRemoveFile, loading]);

  // Memoize upload dragger
  const uploadDragger = useMemo(() => (
    <Upload.Dragger
      name="resume"
      accept=".pdf,.docx"
      beforeUpload={handleFileUpload}
      showUploadList={false}
      disabled={loading}
    >
      <p className="ant-upload-drag-icon">
        <UploadOutlined style={{ fontSize: 48, color: colors.primary.main }} />
      </p>
      <p className="ant-upload-text">
        {loading ? 'Processing...' : 'Click or drag file to this area to upload'}
      </p>
      <p className="ant-upload-hint">
        Support for PDF and DOCX files only
      </p>
    </Upload.Dragger>
  ), [handleFileUpload, loading]);

  // Memoize existing resume display
  const existingResumeContent = useMemo(() => {
    if (!existingResumeData) return null;

    return (
      <div style={{
        padding: spacing.lg,
        backgroundColor: colors.success.light + '20',
        borderRadius: 8,
        border: `1px solid ${colors.success.main}`,
        marginBottom: spacing.lg
      }}>
        <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <CheckCircleOutlined style={{ color: colors.success.main, fontSize: 20 }} />
            <Text strong style={{ color: colors.success.main, fontSize: 16 }}>
              You have an existing resume on file
            </Text>
          </div>
          
          {/* Show stored PDF filename */}
          {existingFileName && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: spacing.sm,
              padding: spacing.sm,
              backgroundColor: colors.neutral[50],
              borderRadius: 6,
              border: `1px solid ${colors.neutral[200]}`
            }}>
              <FileTextOutlined style={{ color: colors.primary.main, fontSize: 16 }} />
              <Text style={{ fontSize: 14, fontWeight: 500 }}>
                {existingFileName}
              </Text>
            </div>
          )}
          
          <div style={{ fontSize: 14, color: colors.neutral[600] }}>
            <div><strong>Name:</strong> {existingResumeData?.personalInfo?.name || existingResumeData?.name || 'N/A'}</div>
            <div><strong>Email:</strong> {existingResumeData?.personalInfo?.email || existingResumeData?.email || 'N/A'}</div>
          </div>
          
          <Space>
            <Button 
              type="primary" 
              onClick={onUseExistingResume}
              style={{ backgroundColor: colors.success.main, borderColor: colors.success.main }}
              size="large"
            >
              Use This Resume
            </Button>
            <Button 
              onClick={onRemoveFile}
              size="large"
            >
              Upload Different Resume
            </Button>
          </Space>
        </Space>
      </div>
    );
  }, [existingResumeData, existingFileName, onUseExistingResume, onRemoveFile]);

  const renderContent = useCallback(() => {
    if (isProcessing) {
      return processingContent;
    }

    if (showSuccess && resumeData) {
      return successContent;
    }

    if (selectedFile) {
      return fileDisplayContent;
    }

    return uploadDragger;
  }, [isProcessing, showSuccess, resumeData, selectedFile, processingContent, successContent, fileDisplayContent, uploadDragger]);

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

  return (
    <Card style={{ maxWidth: 600, margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={3}>
            {existingResumeData ? 'Resume Management' : 'Upload Your Resume'}
          </Title>
          <Paragraph>
            {existingResumeData 
              ? 'You have a resume on file. You can use it or upload a new one.'
              : 'Upload your resume (PDF or DOCX) to get started with your AI interview practice.'
            }
          </Paragraph>
        </div>

        {existingResumeContent}
        {errorDisplay}
        {renderContent()}
      </Space>
    </Card>
  );
};
