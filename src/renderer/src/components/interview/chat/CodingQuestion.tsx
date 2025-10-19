// src/components/interview/chat/CodingQuestion.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card, Button, Space, Typography, Alert, Divider, Spin } from 'antd';
import { CodeOutlined, CheckCircleOutlined, CloseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { colors, spacing } from '../../../styles';
import Editor from '@monaco-editor/react';
import type { Question } from '../../../types';
import { useInterview } from '../../../hooks/api/useInterview';
import { useMonaco } from '../../../hooks/useMonaco';

const { Title, Text, Paragraph } = Typography;

interface CodingQuestionProps {
    question: Question;
    onSubmitAnswer: (code: string) => void;
    loading?: boolean;
    disabled?: boolean;
    showResult?: boolean;
    submittedCode?: string; // eslint-disable-line @typescript-eslint/no-unused-vars
    testResults?: Array<{
        passed: boolean;
        input: string;
        expectedOutput: string;
        actualOutput: string;
        error?: string;
    }>;
}

export const CodingQuestion: React.FC<CodingQuestionProps> = ({
    question,
    onSubmitAnswer,
    loading = false,
    disabled = false,
    showResult = false,
    submittedCode,
    testResults = []
}) => {
    const { validateCode } = useInterview();
    const { isMonacoLoading, monacoError } = useMonaco();

    const getDefaultCode = useCallback(() => {
        // If showing results and we have submitted code, use that
        if (showResult && submittedCode) {
            return submittedCode;
        }

        if (question.initialCode) {
            return question.initialCode;
        }

        // Fallback based on question ID
        if (question.id === 'q5') {
            return `function findMax(numbers) {
  // Complete this function to return the maximum number
  // Example: findMax([1, 5, 3, 9, 2]) should return 9
  
}`;
        } else if (question.id === 'q6') {
            return `function isPalindrome(str) {
  // Complete this function to check if the string is a palindrome
  // A palindrome reads the same forwards and backwards
  // Example: isPalindrome("racecar") should return true
  
}`;
        }

        return '// Start coding here...';
    }, [question.initialCode, question.id, showResult, submittedCode]);

    const [code, setCode] = useState<string>(getDefaultCode());
    const [isValidating, setIsValidating] = useState<boolean>(false);
    const [validationResults, setValidationResults] = useState<Array<{
        passed: boolean;
        input: string;
        expectedOutput: string;
        actualOutput: string;
        error?: string;
    }>>([]);
    const [validationSummary, setValidationSummary] = useState<{
        totalTests: number;
        passedTests: number;
        failedTests: number;
        successRate: number;
        isCorrect: boolean;
    } | null>(null);
    const editorRef = useRef<any>(null);

    // Reset code and validation results when question changes or when submittedCode changes
    useEffect(() => {
        console.log('=== QUESTION CHANGE DEBUG ===');
        console.log('Question ID changed to:', question.id);
        console.log('Clearing validation results...');
        console.log('================================');

        const initialCode = getDefaultCode();
        setCode(initialCode);

        // Clear validation results when question changes
        setValidationResults([]);
        setValidationSummary(null);
    }, [question.id, question.initialCode, getDefaultCode, submittedCode]);

    const handleEditorDidMount = useCallback((editor: any) => {
        console.log('Monaco Editor mounted successfully!', editor);
        editorRef.current = editor;

        // Configure editor to match the app's styling
        editor.updateOptions({
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            lineNumbers: 'on',
            folding: true,
            bracketPairColorization: { enabled: true },
            renderWhitespace: 'selection',
        });
    }, []);

    const handleCodeChange = useCallback((value: string | undefined) => {
        if (value !== undefined) {
            setCode(value);
        }
    }, []);

    const handleSubmit = useCallback(() => {
        if (code.trim() && !loading && !disabled) {
            onSubmitAnswer(code);
        }
    }, [code, loading, disabled, onSubmitAnswer]);

    const handleValidateCode = useCallback(async () => {
        if (!code.trim() || isValidating) {
            return;
        }

        console.log('=== VALIDATION DEBUG ===');
        console.log('Current question ID:', question.id);
        console.log('Code to validate:', code);
        console.log('========================');

        setIsValidating(true);
        try {
            const result = await validateCode(question.id, code);
            setValidationResults(result.testResults || []);
            setValidationSummary(result.summary || null);
        } catch (error) {
            console.error('Code validation failed:', error);
            // Show error message to user
            setValidationResults([]);
            setValidationSummary(null);
        } finally {
            setIsValidating(false);
        }
    }, [code, question.id, validateCode, isValidating]);



    const getLanguageFromQuestion = useCallback(() => {
        return question.language || 'javascript';
    }, [question.language]);

    const getTestResultIcon = useCallback((passed: boolean) => {
        return passed ?
            <CheckCircleOutlined style={{ color: colors.success.main }} /> :
            <CloseCircleOutlined style={{ color: colors.error.main }} />;
    }, []);

    // If no question, don't render anything
    if (!question) {
        return <div>No question provided</div>;
    }

    return (
        <Card style={{
            marginBottom: spacing.lg,
            width: '100%',
            maxWidth: '700px',
            minWidth: '600px',
            minHeight: '180px',
            height: 'auto'
        }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {/* Question Header */}
                <div>
                    <Title level={4}>
                        <CodeOutlined style={{ marginRight: spacing.sm, color: colors.primary.main }} />
                        {question.question}
                    </Title>
                    <Text type="secondary">
                        {question.type} • {question.difficulty} • {question.timeLimit}s • {getLanguageFromQuestion()}
                    </Text>
                    {question.instructions && (
                        <Paragraph style={{ marginTop: spacing.sm, marginBottom: 0 }}>
                            <Text strong>Instructions:</Text> {question.instructions}
                        </Paragraph>
                    )}
                </div>

                {/* Code Editor */}
                <div style={{
                    border: `1px solid ${colors.neutral[200]}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    backgroundColor: colors.background.primary
                }}>
                    {monacoError ? (
                        <Alert
                            type="error"
                            message="Code Editor Error"
                            description={monacoError}
                            style={{ margin: spacing.md }}
                        />
                    ) : isMonacoLoading ? (
                        <div style={{ 
                            height: '300px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            flexDirection: 'column',
                            gap: spacing.sm
                        }}>
                            <Spin size="large" />
                            <Text type="secondary">Initializing Code Editor...</Text>
                        </div>
                    ) : (
                        <Editor
                            key={question.id}
                            height="300px"
                            language={getLanguageFromQuestion()}
                            value={code}
                            onChange={handleCodeChange}
                            onMount={handleEditorDidMount}
                            beforeMount={(monaco) => {
                                console.log('Monaco beforeMount called:', monaco);
                            }}
                            options={{
                                readOnly: disabled || showResult,
                                fontSize: 14,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                wordWrap: 'on',
                                lineNumbers: 'on',
                                folding: true,
                                bracketPairColorization: { enabled: true },
                                renderWhitespace: 'selection',
                            }}
                            theme="vs-light"
                            loading={<div>Loading Monaco Editor...</div>}
                        />
                    )}
                </div>

                {/* Test Results */}
                {(() => {
                    // Only show validation results for current question (not showResult mode)
                    // Only show testResults for previous questions (showResult mode)
                    const shouldShowValidationResults = !showResult && validationResults.length > 0;
                    const shouldShowTestResults = showResult && testResults.length > 0;

                    if (!shouldShowValidationResults && !shouldShowTestResults) {
                        return null;
                    }

                    return (
                        <div>
                            <Title level={5}>Test Results:</Title>
                            {validationSummary && !showResult && (
                                <Alert
                                    type={validationSummary.isCorrect ? 'success' : 'error'}
                                    message={
                                        <div>
                                            <Text strong>
                                                {validationSummary.isCorrect ? 'All tests passed!' : 'Some tests failed'}
                                            </Text>
                                            <br />
                                            <Text type="secondary">
                                                {validationSummary.passedTests}/{validationSummary.totalTests} tests passed
                                                ({validationSummary.successRate.toFixed(1)}%)
                                            </Text>
                                        </div>
                                    }
                                    style={{ marginBottom: spacing.md }}
                                />
                            )}
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                {(shouldShowValidationResults ? validationResults : testResults).map((result, index) => (
                                    <Alert
                                        key={index}
                                        type={result.passed ? 'success' : 'error'}
                                        message={
                                            <div>
                                                <Space>
                                                    {getTestResultIcon(result.passed)}
                                                    <Text strong>Test Case {index + 1}</Text>
                                                </Space>
                                                <Divider style={{ margin: spacing.xs }} />
                                                <div style={{ fontSize: '12px' }}>
                                                    <div><Text code>Input:</Text> {result.input}</div>
                                                    <div><Text code>Expected:</Text> {result.expectedOutput}</div>
                                                    <div><Text code>Output:</Text> {result.actualOutput}</div>
                                                    {result.error && (
                                                        <div><Text code>Error:</Text> {result.error}</div>
                                                    )}
                                                </div>
                                            </div>
                                        }
                                        showIcon={false}
                                    />
                                ))}
                            </Space>
                        </div>
                    );
                })()}

                {/* Action Buttons */}
                {!showResult && (
                    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                        <Button
                            icon={<PlayCircleOutlined />}
                            onClick={handleValidateCode}
                            loading={isValidating}
                            disabled={disabled || !code.trim() || isMonacoLoading || !!monacoError}
                        >
                            Test Code
                        </Button>
                        <Button
                            type="primary"
                            size="large"
                            onClick={handleSubmit}
                            loading={loading}
                            disabled={disabled || !code.trim() || isMonacoLoading || !!monacoError}
                        >
                            Submit Solution
                        </Button>
                    </Space>
                )}

                {/* Debug Info */}
                <div style={{ fontSize: '12px', color: colors.neutral[500] }}>
                    Debug: Language: {getLanguageFromQuestion()}, Code length: {code.length} chars
                </div>
            </Space>
        </Card>
    );
};

export default CodingQuestion;
