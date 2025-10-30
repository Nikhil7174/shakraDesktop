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

        // Create editor
        const editor = monaco.editor.create(editorRef.current!, {
          value: problem.starterCode || '',
          language: getMonacoLanguage(problem.language),
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
      <div className="code-editor-header">
        <h3>{problem.title}</h3>
        <div className="editor-controls">
          <span className="language-badge">{problem.language}</span>
          {isMonitoring && (
            <span className="monitoring-indicator">
              <div className="pulse-dot"></div>
              Monitoring
            </span>
          )}
        </div>
      </div>
      <div className="code-editor-description">
        <p>{problem.description}</p>
      </div>
      <div 
        ref={editorRef} 
        className="monaco-editor"
        style={{ height: '400px', width: '100%' }}
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
      <style>{`
        .code-editor-container {
          border: 1px solid #333;
          border-radius: 8px;
          overflow: hidden;
          background: #1e1e1e;
        }
        
        .code-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #2d2d30;
          border-bottom: 1px solid #333;
        }
        
        .code-editor-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 16px;
        }
        
        .editor-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .language-badge {
          background: #007acc;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
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
        
        .code-editor-description {
          padding: 12px 16px;
          background: #252526;
          border-bottom: 1px solid #333;
        }
        
        .code-editor-description p {
          margin: 0;
          color: #cccccc;
          font-size: 14px;
          line-height: 1.4;
        }
        
        .monaco-editor {
          border: none;
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


