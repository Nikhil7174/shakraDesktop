import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import { CodingProblem } from '../../../shared/types'

interface CodeEditorProps {
  problem: CodingProblem
  onCodeChange?: (code: string) => void
  onNotepadChange?: (notepad: string) => void
  onAnalysisRequest?: (code: string, problemId: string) => void
  onSubmit?: (code: string, timeComplexity?: string, spaceComplexity?: string) => void
  isMonitoring?: boolean
  readOnly?: boolean
  onTimerExpire?: () => void
  showTimer?: boolean
  timeComplexity?: string
  spaceComplexity?: string
  onTimeComplexityChange?: (value: string) => void
  onSpaceComplexityChange?: (value: string) => void
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  problem,
  onCodeChange,
  onNotepadChange,
  onAnalysisRequest,
  onSubmit,
  isMonitoring = true,
  readOnly = false,
  onTimerExpire,
  showTimer = true,
  timeComplexity = '',
  spaceComplexity = '',
  onTimeComplexityChange,
  onSpaceComplexityChange
}) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeComplexityInputRef = useRef<HTMLInputElement | null>(null)
  const spaceComplexityInputRef = useRef<HTMLInputElement | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(problem.language || 'cpp')
  const [activeTab, setActiveTab] = useState<'code' | 'notepad'>('code')
  const [notepadContent, setNotepadContent] = useState('')
  // Initialize timer state - only reset when problem.id changes
  const [timeRemaining, setTimeRemaining] = useState<number>(getTimeLimit(problem.difficulty))

  // Reset timer only when problem.id changes (not on every render)
  useEffect(() => {
    if (showTimer && !readOnly) {
      setTimeRemaining(getTimeLimit(problem.difficulty))
    }
    setNotepadContent('') // Reset notepad content for new problem
  }, [problem.id]) // Only reset when problem.id changes

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
        // Use problem.language as fallback if selectedLanguage doesn't have starter code
        const getStarterCode = () => {
          // First try selected language
          if (problem.starterCodes && problem.starterCodes[selectedLanguage]) {
            return problem.starterCodes[selectedLanguage]
          }
          // Then try problem's default language
          const problemLang = problem.language || 'cpp'
          if (problem.starterCodes && problem.starterCodes[problemLang]) {
            return problem.starterCodes[problemLang]
          }
          // Fallback to generic starter code
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

        // Set up change listener - only track code changes, no analysis
        editor.onDidChangeModelContent(() => {
          const code = editor.getValue()
          onCodeChange?.(code)
          // Analysis happens only every 60s via the interval below
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
  }, [problem.id, problem.language, selectedLanguage])

  useEffect(() => {
    if (!monacoEditorRef.current) return
    const currentReadOnly = monacoEditorRef.current.getOption(monaco.editor.EditorOption.readOnly)
    if (currentReadOnly !== readOnly) {
      monacoEditorRef.current.updateOptions({ readOnly })
    }
  }, [readOnly])

  // Simple 60-second timer - starts when monitoring begins, sends every 60 seconds
  useEffect(() => {
    if (!isEditorReady || !isMonitoring) return

    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current)
    }

    console.log('⏰ [CodeEditor] Starting 60-second timer')

    // Send code every 60 seconds
    monitoringIntervalRef.current = setInterval(() => {
      if (monacoEditorRef.current) {
        const code = monacoEditorRef.current.getValue()
        console.log('⏰ [CodeEditor] 60s interval: Sending code to LLM. Code length:', code.length)
        onAnalysisRequest?.(code, problem.id)
      }
    }, 60000) // Every 60 seconds

    return () => {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current)
        monitoringIntervalRef.current = null
      }
    }
  }, [isEditorReady, isMonitoring, problem.id, onAnalysisRequest])

  // Timer countdown - separate from reset logic
  useEffect(() => {
    if (!showTimer || readOnly) return

    const startTimer = () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            // Time's up - clear interval to prevent multiple calls
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current)
              timerIntervalRef.current = null
            }
            // Call expiration handler once
            onTimerExpire?.()
            return 0
          }
          return prev - 1
        })
      }, 1000) // Every second
    }

    startTimer()

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [showTimer, readOnly, onTimerExpire]) // Timer countdown logic - doesn't reset timer

  // Reset selected language when problem changes
  // Preserve user's language choice if the new problem supports it, otherwise reset to problem's default
  useEffect(() => {
    const problemDefaultLanguage = problem.language || 'cpp'

    // Check if current selected language has starter code in the new problem
    const hasStarterCodeForSelectedLang = problem.starterCodes && problem.starterCodes[selectedLanguage]

    // If selected language doesn't have starter code in new problem, reset to problem's default
    if (!hasStarterCodeForSelectedLang && selectedLanguage !== problemDefaultLanguage) {
      setSelectedLanguage(problemDefaultLanguage)
    }
  }, [problem.id, problem.language, problem.starterCodes, selectedLanguage])

  // Update editor content when problem or selected language changes
  useEffect(() => {
    if (!monacoEditorRef.current) return

    // Get starter code for the selected language
    const getStarterCode = () => {
      if (problem.starterCodes && problem.starterCodes[selectedLanguage]) {
        return problem.starterCodes[selectedLanguage]
      }
      return problem.starterCode || ''
    }

    const starterCode = getStarterCode()
    if (starterCode) {
      const currentValue = monacoEditorRef.current.getValue()
      // Only update if the code is different (avoid unnecessary updates)
      if (currentValue !== starterCode) {
        monacoEditorRef.current.setValue(starterCode)
        // Also update the language mode
        const model = monacoEditorRef.current.getModel()
        if (model) {
          monaco.editor.setModelLanguage(model, getMonacoLanguage(selectedLanguage))
        }
      }
    }
  }, [problem.id, problem.starterCode, problem.starterCodes, selectedLanguage])

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

    // Read code directly from editor (like we always do)
    const code = monacoEditorRef.current.getValue()
    if (!code.trim()) {
      // Don't show blocking alert - just return silently
      // The user can still submit empty code if they want (orchestrator will handle feedback)
      return
    }

    // Read TC/SC directly from input fields (same approach as reading code from editor)
    const timeComplexityValue = timeComplexityInputRef.current?.value?.trim() || undefined
    const spaceComplexityValue = spaceComplexityInputRef.current?.value?.trim() || undefined

    console.log('📝 [CodeEditor] Submitting - reading from inputs:', {
      codeLength: code.length,
      timeComplexity: timeComplexityValue || 'NOT PROVIDED',
      spaceComplexity: spaceComplexityValue || 'NOT PROVIDED'
    })

    setIsSubmitting(true)
    try {
      await onSubmit(code, timeComplexityValue, spaceComplexityValue)
    } catch (error) {
      console.error('Error submitting solution:', error)
      // Don't show blocking alert - error is already logged
      // The interview flow will handle errors gracefully
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
            <h3>{problem.title || (problem as any).question?.split('.')[0] || 'Coding Problem'}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {showTimer && !readOnly && (
                <div className="timer-display">
                  <svg className="timer-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 8V12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 2H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>{formatTime(timeRemaining)}</span>
                </div>
              )}
              {isMonitoring && (
                <span className="monitoring-indicator">
                  <div className="pulse-dot"></div>
                  Monitoring
                </span>
              )}
            </div>
          </div>
          <div className="question-content">
            <div className="question-section">
              <h4>Problem Description</h4>
              <p>{problem.description || (problem as any).problemStatement || (problem as any).instructions || (problem as any).question || ''}</p>
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

        {/* Right Column: Editor Panel */}
        <div className="editor-panel">
          {/* Editor Header with Tabs */}
          <div className="editor-header">
            <div className="editor-tabs">
              <button
                className={`editor-tab ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                Code
              </button>
              <button
                className={`editor-tab ${activeTab === 'notepad' ? 'active' : ''}`}
                onClick={() => setActiveTab('notepad')}
              >
                Notepad
              </button>
            </div>

            {activeTab === 'code' && (
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
            )}
          </div>

          {/* Code Editor View */}
          <div style={{ display: activeTab === 'code' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <div className="monaco-wrapper" style={{ flex: 1, minHeight: 0, width: '100%' }}>
              <div
                ref={editorRef}
                className="monaco-editor"
                style={{ height: 'calc(100% - 40px)', width: '100%' }}
              />
            </div>
            {onSubmit && !readOnly && (
              <div className="code-editor-footer">
                <div className="complexity-inputs">
                  <div className="complexity-input">
                    <label htmlFor="time-complexity">Time Complexity</label>
                    <input
                      ref={timeComplexityInputRef}
                      id="time-complexity"
                      type="text"
                      placeholder="e.g. O(n log n)"
                      value={timeComplexity}
                      onChange={(e) => onTimeComplexityChange?.(e.target.value)}
                    />
                  </div>
                  <div className="complexity-input">
                    <label htmlFor="space-complexity">Space Complexity</label>
                    <input
                      ref={spaceComplexityInputRef}
                      id="space-complexity"
                      type="text"
                      placeholder="e.g. O(n)"
                      value={spaceComplexity}
                      onChange={(e) => onSpaceComplexityChange?.(e.target.value)}
                    />
                  </div>
                </div>
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

          {/* Notepad View */}
          {activeTab === 'notepad' && (
            <div className="notepad-container">
              <textarea
                className="notepad-textarea"
                placeholder="Use this space for scratchpad notes, pseudocode, or thinking through the problem."
                value={notepadContent}
                onChange={(e) => {
                  setNotepadContent(e.target.value)
                  onNotepadChange?.(e.target.value)
                }}
                disabled={readOnly}
              />
            </div>
          )}
        </div>
      </div>
      <style>{`
        .code-editor-container {
          width: 100%;
          height: 80vh;
          display: flex;
          flex-direction: column;
          background: #1e1e1e;
          border-radius: 12px;
          overflow: hidden;
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
          border-top-left-radius: 12px;
          border-bottom-left-radius: 12px;
        }
        
        .question-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #2d2d30;
          border-bottom: 1px solid #333;
          border-top-left-radius: 12px;
        }
        
        .question-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 18px;
          font-weight: 600;
        }
        
        .timer-display {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 600;
          color: ${timeRemaining > 300 ? '#4caf50' : timeRemaining > 60 ? '#ff9800' : '#f44336'};
          min-width: 80px;
          font-variant-numeric: tabular-nums;
        }
        
        .timer-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
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
          border-top-right-radius: 12px;
          border-bottom-right-radius: 12px;
        }
        
        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #2d2d30;
          border-bottom: 1px solid #333;
          height: 52px;
          border-top-right-radius: 12px;
        }

        .editor-tabs {
          display: flex;
          height: 100%;
          align-items: flex-end; 
          padding-left: 16px; 
        }

        .editor-tab {
          background: transparent;
          color: #969696;
          border: none;
          padding: 10px 16px; /* Added top/bottom padding to center vertically or position correctly */
          height: 100%;
          cursor: pointer;
          font-size: 13px;
          outline: none;
          border-bottom: 2px solid transparent; /* Use bottom border for active state to look cleaner */
          display: flex;
          align-items: center;
        }

        .editor-tab:hover {
          color: #e0e0e0;
        }

        .editor-tab.active {
          color: #ffffff;
          border-bottom: 2px solid #007acc; 
          border-right: none;
          border-top: none; 
          /* Removing previous borders to look more like standard tabs */
        }
        
        .notepad-container {
          flex: 1;
          display: flex;
          background: #1e1e1e;
          overflow: hidden;
        }

        .notepad-textarea {
          flex: 1;
          background: #1e1e1e;
          color: #d4d4d4;
          border: none;
          resize: none;
          padding: 16px;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 14px;
          line-height: 1.5;
          outline: none;
        }
        
        .editor-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-right: 16px;
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
          height: 70px;
          padding-left: 16px;
          padding-right: 16px;
          background: #2d2d30;
          border-top: 1px solid #333;
          display: flex;
          align-items: center;
          justify-content: space-evenly;
          gap: 16px;
        }
        
        .complexity-inputs {
          width: 40%;
          display: flex;
          gap: 8px;
          flex: 1;
          align-items: center;
        }
        
        .complexity-input {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          max-width: 160px;
        }
        
        .complexity-input label {
          font-size: 11px;
          font-weight: 500;
          color: #cccccc;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .complexity-input input {
          width: 80%;
          padding: 6px 10px;
          background: #1e1e1e;
          border: 1px solid #444;
          border-radius: 4px;
          color: #ffffff;
          font-size: 12px;
          font-family: 'Courier New', monospace;
          outline: none;
          transition: border-color 0.2s;
        }
        
        .complexity-input input:focus {
          border-color: #007acc;
        }
        
        .complexity-input input::placeholder {
          color: #666;
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
          white-space: nowrap;
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

// Helper function to get time limit based on difficulty (in seconds)
function getTimeLimit(difficulty: string): number {
  switch (difficulty.toLowerCase()) {
    case 'easy':
      return 900 // 15 minutes 
    case 'medium':
      return 1500 // 25 minutes
    case 'hard':
      return 1800 // 30 minutes
    default:
      return 1500 // Default 25 minutes
  }
}

// Helper function to format time (MM:SS)
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
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


