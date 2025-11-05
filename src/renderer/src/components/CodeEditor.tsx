import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { CodingProblem } from '../../../shared/types'

interface CodeEditorProps {
  problem: CodingProblem
  onCodeChange?: (code: string) => void
  onAnalysisRequest?: (code: string, problemId: string) => void
  onSubmit?: (code: string) => void
  isMonitoring?: boolean
  readOnly?: boolean
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  problem,
  onCodeChange,
  onAnalysisRequest,
  onSubmit,
  isMonitoring = true,
  readOnly = false
}) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(problem.language || 'javascript')

  // Available languages
  const availableLanguages = ['javascript', 'python', 'cpp', 'java']

  // Initialize Monaco Editor
  useEffect(() => {
    if (!editorRef.current) return

    const initializeEditor = async () => {
      try {
        // Configure Monaco
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
          target: monaco.languages.typescript.ScriptTarget.ES2020,
          allowNonTsExtensions: true,
          moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.CommonJS,
          noEmit: true,
          esModuleInterop: true,
          jsx: monaco.languages.typescript.JsxEmit.React,
          reactNamespace: 'React',
          allowJs: true,
          typeRoots: ['node_modules/@types']
        })

        // Get starter code based on selected language
        const getStarterCode = () => {
          if (problem.starterCodes && problem.starterCodes[selectedLanguage]) {
            return problem.starterCodes[selectedLanguage]
          }
          return problem.starterCode || ''
        }

        // Create editor
        const editor = monaco.editor.create(editorRef.current!, {
          value: getStarterCode(),
          language: getMonacoLanguage(selectedLanguage),
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          readOnly,
          fontSize: 14,
          lineNumbers: 'on',
          roundedSelection: false,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto'
          },
          wordWrap: 'on',
          folding: true,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 3
        })

        monacoEditorRef.current = editor
        setIsEditorReady(true)

        // Set up change listener
        editor.onDidChangeModelContent(() => {
          const code = editor.getValue()
          onCodeChange?.(code)
        })

        // Set up cursor position tracking
        editor.onDidChangeCursorPosition((_e) => {
          // Could emit cursor position for more detailed analysis
        })

        // Set up selection change tracking
        editor.onDidChangeCursorSelection((_e) => {
          // Could track what the user is focusing on
        })

      } catch (error) {
        console.error('Failed to initialize Monaco Editor:', error)
      }
    }

    initializeEditor()

    // Cleanup
    return () => {
      if (monacoEditorRef.current) {
        monacoEditorRef.current.dispose()
        monacoEditorRef.current = null
      }
    }
  }, [problem.language, readOnly])

  // Start/stop monitoring
  useEffect(() => {
    if (!isEditorReady || !isMonitoring) return

    const startMonitoring = () => {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current)
      }

      monitoringIntervalRef.current = setInterval(() => {
        if (monacoEditorRef.current) {
          const code = monacoEditorRef.current.getValue()
          if (code.trim().length > 0) {
            onAnalysisRequest?.(code, problem.id)
          }
        }
      }, 10000) // Every 10 seconds
    }

    startMonitoring()

    return () => {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current)
        monitoringIntervalRef.current = null
      }
    }
  }, [isEditorReady, isMonitoring, problem.id, onAnalysisRequest])

  // Update editor content when problem changes
  useEffect(() => {
    if (monacoEditorRef.current && problem.starterCode) {
      const currentValue = monacoEditorRef.current.getValue()
      if (currentValue !== problem.starterCode) {
        monacoEditorRef.current.setValue(problem.starterCode)
      }
    }
  }, [problem.starterCode])

  // Handle language change
  const handleLanguageChange = useCallback((newLanguage: string) => {
    if (!monacoEditorRef.current) {
      console.log('⚠️ [CodeEditor] Editor not ready, cannot change language')
      return
    }
    
    console.log('🔄 [CodeEditor] Changing language from', selectedLanguage, 'to', newLanguage)
    setSelectedLanguage(newLanguage)
    
    // Get starter code for the new language
    let newStarterCode = ''
    if (problem.starterCodes && problem.starterCodes[newLanguage]) {
      newStarterCode = problem.starterCodes[newLanguage]
      console.log('✅ [CodeEditor] Using starter code for', newLanguage, '- length:', newStarterCode.length)
    } else if (problem.starterCode) {
      newStarterCode = problem.starterCode
      console.log('⚠️ [CodeEditor] Using default starter code - length:', newStarterCode.length)
    } else {
      newStarterCode = ''
      console.log('⚠️ [CodeEditor] No starter code available for', newLanguage)
    }
    
    // Get current code to check if user has modified it
    const currentCode = monacoEditorRef.current.getValue()
    // Get the starter code for the OLD language (before change) to compare
    const oldStarterCode = problem.starterCodes?.[selectedLanguage] || problem.starterCode || ''
    
    // Check if current code matches the old starter code (user hasn't modified it)
    const isUnmodified = currentCode.trim() === '' || 
                         currentCode.trim() === oldStarterCode.trim() ||
                         (oldStarterCode === '' && currentCode.trim() === '')
    
    if (isUnmodified || newStarterCode === '') {
      // User hasn't started coding, hasn't modified, or no starter code available - safe to replace
      console.log('✅ [CodeEditor] Replacing code with new language starter code')
      if (newStarterCode) {
        monacoEditorRef.current.setValue(newStarterCode)
        // Verify the value was set
        const verifyValue = monacoEditorRef.current.getValue()
        if (verifyValue !== newStarterCode) {
          console.error('❌ [CodeEditor] Failed to set value! Expected:', newStarterCode.substring(0, 50), 'Got:', verifyValue.substring(0, 50))
        } else {
          console.log('✅ [CodeEditor] Value successfully set, length:', verifyValue.length)
        }
      } else {
        console.log('⚠️ [CodeEditor] No starter code available, keeping current code but changing language')
      }
    } else {
      // User has modified code - ask for confirmation
      const shouldReplace = confirm(`You have unsaved changes. Do you want to replace your code with the ${newLanguage} starter code?`)
      if (shouldReplace) {
        console.log('✅ [CodeEditor] User confirmed, replacing code')
        monacoEditorRef.current.setValue(newStarterCode || '')
        // Verify the value was set
        const verifyValue = monacoEditorRef.current.getValue()
        if (newStarterCode && verifyValue !== newStarterCode) {
          console.error('❌ [CodeEditor] Failed to set value! Expected:', newStarterCode.substring(0, 50), 'Got:', verifyValue.substring(0, 50))
        } else {
          console.log('✅ [CodeEditor] Value successfully set')
        }
      } else {
        // Revert language selection by restoring the select value
        console.log('⚠️ [CodeEditor] User cancelled, reverting language selection')
        // Force re-render with old language by setting it again
        const selectElement = document.querySelector('.language-selector') as HTMLSelectElement
        if (selectElement) {
          selectElement.value = selectedLanguage
        }
        // Don't update state, just return
        return
      }
    }
    
    // Update editor language (syntax highlighting)
    const model = monacoEditorRef.current.getModel()
    if (model) {
      monaco.editor.setModelLanguage(model, getMonacoLanguage(newLanguage))
      console.log('✅ [CodeEditor] Language set to', getMonacoLanguage(newLanguage))
    } else {
      console.error('❌ [CodeEditor] Model not found, cannot set language')
    }
  }, [problem.starterCodes, problem.starterCode, selectedLanguage])

  // Public methods for external control
  const getCode = useCallback((): string => {
    return monacoEditorRef.current?.getValue() || ''
  }, [])

  const setCode = useCallback((code: string) => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.setValue(code)
    }
  }, [])

  const insertText = useCallback((text: string) => {
    if (monacoEditorRef.current) {
      const selection = monacoEditorRef.current.getSelection()
      if (selection) {
        monacoEditorRef.current.executeEdits('insert-text', [{
          range: selection,
          text,
          forceMoveMarkers: true
        }])
      }
    }
  }, [])

  const getCursorPosition = useCallback(() => {
    if (monacoEditorRef.current) {
      const position = monacoEditorRef.current.getPosition()
      return position ? { line: position.lineNumber, column: position.column } : null
    }
    return null
  }, [])

  const setCursorPosition = useCallback((line: number, column: number) => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.setPosition({ lineNumber: line, column })
      monacoEditorRef.current.focus()
    }
  }, [])

  const getSelectedText = useCallback((): string => {
    if (monacoEditorRef.current) {
      const selection = monacoEditorRef.current.getSelection()
      if (selection) {
        return monacoEditorRef.current.getModel()?.getValueInRange(selection) || ''
      }
    }
    return ''
  }, [])

  const highlightLine = useCallback((lineNumber: number) => {
    if (monacoEditorRef.current) {
      const model = monacoEditorRef.current.getModel()
      if (model) {
        const decoration = monacoEditorRef.current.deltaDecorations([], [{
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: 'highlight-line',
            glyphMarginClassName: 'highlight-glyph'
          }
        }])
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
          monacoEditorRef.current?.deltaDecorations(decoration, [])
        }, 3000)
      }
    }
  }, [])

  const addMarker = useCallback((lineNumber: number, message: string, severity: 'error' | 'warning' | 'info' = 'info') => {
    if (monacoEditorRef.current) {
      const model = monacoEditorRef.current.getModel()
      if (model) {
        const markerSeverity = severity === 'error' ? monaco.MarkerSeverity.Error :
                              severity === 'warning' ? monaco.MarkerSeverity.Warning :
                              monaco.MarkerSeverity.Info

        monaco.editor.setModelMarkers(model, 'interview', [{
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1,
          message,
          severity: markerSeverity
        }])
      }
    }
  }, [])

  const clearMarkers = useCallback(() => {
    if (monacoEditorRef.current) {
      const model = monacoEditorRef.current.getModel()
      if (model) {
        monaco.editor.setModelMarkers(model, 'interview', [])
      }
    }
  }, [])

  // Handle submit button click
  const handleSubmit = useCallback(async () => {
    if (!monacoEditorRef.current || !onSubmit || isSubmitting) return
    
    const code = monacoEditorRef.current.getValue()
    if (!code.trim()) {
      alert('Please write some code before submitting!')
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(code)
    } catch (error) {
      console.error('Error submitting solution:', error)
      alert('Failed to submit solution. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }, [onSubmit, isSubmitting])

  // Expose methods to parent component
  useEffect(() => {
    if (onCodeChange) {
      // Store methods on the component instance for external access
      const hostElement = editorRef.current as any
      if (hostElement) {
        hostElement.__editorMethods = {
          getCode,
          setCode,
          insertText,
          getCursorPosition,
          setCursorPosition,
          getSelectedText,
          highlightLine,
          addMarker,
          clearMarkers
        }
      }
    }
  }, [getCode, setCode, insertText, getCursorPosition, setCursorPosition, getSelectedText, highlightLine, addMarker, clearMarkers, onCodeChange])

  return (
    <div className="code-editor-container">
      <div className="coding-layout">
        {/* Left Column: Question Description */}
        <div className="question-panel">
          <div className="question-header">
            <h3>{problem.title}</h3>
            {isMonitoring && (
              <span className="monitoring-indicator">
                <div className="pulse-dot"></div>
                Monitoring
              </span>
            )}
          </div>
          <div className="question-content">
            <div className="question-section">
              <h4>Problem Description</h4>
              <p>{problem.description}</p>
            </div>
            {problem.constraints && (
              <div className="question-section">
                <h4>Constraints</h4>
                <ul>
                  {Array.isArray(problem.constraints) ? (
                    problem.constraints.map((constraint, idx) => (
                      <li key={idx}>{constraint}</li>
                    ))
                  ) : (
                    <li>{problem.constraints}</li>
                  )}
                </ul>
              </div>
            )}
            {problem.examples && (
              <div className="question-section">
                <h4>Examples</h4>
                {Array.isArray(problem.examples) ? (
                  problem.examples.map((example, idx) => (
                    <div key={idx} className="example">
                      {typeof example === 'string' ? (
                        <pre>{example}</pre>
                      ) : (
                        <div>
                          <p><strong>Input:</strong> {example.input}</p>
                          <p><strong>Output:</strong> {example.output}</p>
                          {example.explanation && (
                            <p><strong>Explanation:</strong> {example.explanation}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <pre>{problem.examples}</pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Code Editor */}
        <div className="editor-panel">
          <div className="editor-header">
            <div className="editor-controls">
              <select 
                className="language-selector"
                value={selectedLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                disabled={readOnly}
              >
                {availableLanguages.map(lang => (
                  <option key={lang} value={lang}>
                    {lang === 'cpp' ? 'C++' : 
                     lang === 'python' ? 'Python 3' : 
                     lang === 'java' ? 'Java' : 
                     'JavaScript'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div 
            ref={editorRef} 
            className="monaco-editor"
            style={{ height: 'calc(100vh - 200px)', width: '100%' }}
          />
          {onSubmit && !readOnly && (
            <div className="code-editor-footer">
              <button 
                className="submit-button"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Solution'}
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .code-editor-container {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #1e1e1e;
        }
        
        .coding-layout {
          display: flex;
          height: 100%;
          gap: 1px;
          overflow: hidden;
        }
        
        /* Left Column: Question Panel */
        .question-panel {
          flex: 0 0 45%;
          background: #1e1e1e;
          border-right: 1px solid #333;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        
        .question-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 16px;
          background: #2d2d30;
          border-bottom: 1px solid #333;
        }
        
        .question-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 18px;
          font-weight: 600;
        }
        
        .question-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          background: #1e1e1e;
        }
        
        .question-section {
          margin-bottom: 24px;
        }
        
        .question-section h4 {
          color: #4fc3f7;
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .question-section p {
          margin: 0 0 12px 0;
          color: #cccccc;
          font-size: 14px;
          line-height: 1.6;
        }
        
        .question-section ul {
          margin: 0;
          padding-left: 20px;
          color: #cccccc;
          font-size: 14px;
          line-height: 1.6;
        }
        
        .question-section li {
          margin-bottom: 8px;
        }
        
        .example {
          background: #252526;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 12px;
        }
        
        .example pre {
          margin: 0;
          color: #cccccc;
          font-size: 13px;
          font-family: 'Courier New', monospace;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        
        .example p {
          margin: 0 0 8px 0;
          color: #cccccc;
          font-size: 13px;
        }
        
        .example p:last-child {
          margin-bottom: 0;
        }
        
        .example strong {
          color: #4fc3f7;
        }
        
        /* Right Column: Editor Panel */
        .editor-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: #1e1e1e;
          overflow: hidden;
        }
        
        .editor-header {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          padding: 16px 16px;
          background: #2d2d30;
          border-bottom: 1px solid #333;
        }
        
        .editor-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .language-selector {
          background: #007acc;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          outline: none;
          transition: background 0.2s;
        }
        
        .language-selector:hover:not(:disabled) {
          background: #005a9e;
        }
        
        .language-selector:disabled {
          background: #555;
          cursor: not-allowed;
          opacity: 0.6;
        }
        
        .monitoring-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #4caf50;
          font-size: 12px;
        }
        
        .pulse-dot {
          width: 8px;
          height: 8px;
          background: #4caf50;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        .monaco-editor {
          flex: 1;
          border: none;
          min-height: 400px;
        }
        
        .code-editor-footer {
          padding: 16px;
          background: #2d2d30;
          border-top: 1px solid #333;
          display: flex;
          justify-content: flex-end;
        }
        
        .submit-button {
          padding: 10px 24px;
          background: #007acc;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .submit-button:hover:not(:disabled) {
          background: #005a9e;
        }
        
        .submit-button:disabled {
          background: #555;
          cursor: not-allowed;
          opacity: 0.6;
        }
        
        /* Scrollbar styling for question panel */
        .question-content::-webkit-scrollbar {
          width: 8px;
        }
        
        .question-content::-webkit-scrollbar-track {
          background: #1e1e1e;
        }
        
        .question-content::-webkit-scrollbar-thumb {
          background: #555;
          border-radius: 4px;
        }
        
        .question-content::-webkit-scrollbar-thumb:hover {
          background: #666;
        }
        
        :global(.highlight-line) {
          background-color: rgba(255, 255, 0, 0.1) !important;
        }
        
        :global(.highlight-glyph) {
          background-color: #ffd700 !important;
        }
      `}</style>
    </div>
  )
}

// Helper function to map language to Monaco language
function getMonacoLanguage(language: string): string {
  const languageMap: { [key: string]: string } = {
    'javascript': 'javascript',
    'typescript': 'typescript',
    'python': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'csharp': 'csharp',
    'go': 'go',
    'rust': 'rust',
    'php': 'php',
    'ruby': 'ruby',
    'swift': 'swift',
    'kotlin': 'kotlin',
    'scala': 'scala',
    'r': 'r',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'markdown': 'markdown'
  }
  
  return languageMap[language.toLowerCase()] || 'plaintext'
}

export default CodeEditor


