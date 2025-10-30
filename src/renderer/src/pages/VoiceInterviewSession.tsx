import React, { useState, useEffect, useCallback, useRef } from 'react'
import { CodeEditor } from '../components/CodeEditor'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { InterviewProgress } from '../components/InterviewProgress'
import { QuestionDisplay } from '../components/QuestionDisplay'
import { ResumeInterviewModal } from '../components/interview/ResumeInterviewModal'
import { CodingProblem, Question } from '../../../shared/types'

interface VoiceInterviewSessionProps {
  interviewId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  resumeFromIndex?: number
  skipIntro?: boolean
  onComplete?: (results: any) => void
}

export const VoiceInterviewSession: React.FC<VoiceInterviewSessionProps> = ({
  interviewId,
  questions,
  codingProblems,
  resumeFromIndex,
  skipIntro,
  onComplete
}) => {
  const [currentState, setCurrentState] = useState<string>('connecting')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [currentCodingProblem, setCurrentCodingProblem] = useState<CodingProblem | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const isListeningRef = useRef(false)
  const [progress, setProgress] = useState({ current: 0, total: questions.length })
  const [evaluations, setEvaluations] = useState<any[]>([])
  const [codeAnalysis, setCodeAnalysis] = useState<any>(null)
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [hasMicStream, setHasMicStream] = useState(false)
  const lastAudioTimeRef = useRef(0)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [unfinishedSession, setUnfinishedSession] = useState<any>(null)
  const [hasCheckedUnfinished, setHasCheckedUnfinished] = useState(false)
  const [userChoseResume, setUserChoseResume] = useState(false)
  
  const codeEditorRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Check for unfinished interview on mount
  useEffect(() => {
    const checkUnfinished = async () => {
      if (hasCheckedUnfinished) return
      
      try {
        const result = await window.electronAPI.checkUnfinishedInterview()
        if (result.hasUnfinished && result.sessionInfo) {
          console.log('Found unfinished interview:', result.sessionInfo)
          setUnfinishedSession(result.sessionInfo)
          setShowResumeModal(true)
        } else {
          // No unfinished interview, proceed normally
          setHasCheckedUnfinished(true)
        }
      } catch (error) {
        console.error('Failed to check unfinished interview:', error)
        setHasCheckedUnfinished(true)
      }
    }

    checkUnfinished()
  }, [hasCheckedUnfinished])

  // Initialize interview
  useEffect(() => {
    // Don't initialize until we've checked for unfinished interviews
    if (!hasCheckedUnfinished) return

    const initializeInterview = async () => {
      try {
        // Request audio permissions
        const hasPermission = await window.electronAPI.requestAudioPermissions()
        if (!hasPermission.success) {
          console.error('Audio permission denied:', hasPermission.error)
          return
        }

        // Get fresh STT token
        const tokenResult = await window.electronAPI.getSTTToken()
        if (!tokenResult.success || !tokenResult.token) {
          console.error('Failed to get STT token:', tokenResult.error)
          return
        }

        // Update STT service with new token
        const updateResult = await window.electronAPI.updateSTTToken(tokenResult.token)
        if (!updateResult.success) {
          console.error('Failed to update STT token:', updateResult.error)
          return
        }

        console.log('🎤 [Renderer] STT service updated with fresh token')

        // Wait for main to request audio capture, then start mic streaming
        window.electronAPI.onAudioCaptureRequired(() => {
          startMicrophoneStreaming()
        })

        // Determine resume parameters (props take priority; else use user choice)
        const effectiveResumeFromIndex = typeof resumeFromIndex === 'number'
          ? resumeFromIndex
          : (userChoseResume && unfinishedSession?.questionsAnswered ? unfinishedSession.questionsAnswered : undefined)

        const effectiveSkipIntro = typeof skipIntro === 'boolean'
          ? skipIntro
          : (userChoseResume && (unfinishedSession?.questionsAnswered ?? 0) > 0)

        // Start the interview
        const result = await window.electronAPI.startInterview({
          id: interviewId,
          questions,
          codingProblems,
          resumeFromIndex: effectiveResumeFromIndex,
          skipIntro: effectiveSkipIntro
        })

        if (!result.success) {
          console.error('Failed to start interview:', result.error)
          return
        }

        console.log('Interview started successfully')
      } catch (error) {
        console.error('Failed to initialize interview:', error)
      }
    }

    initializeInterview()
  }, [interviewId, questions, codingProblems, hasCheckedUnfinished, resumeFromIndex, skipIntro, userChoseResume, unfinishedSession?.questionsAnswered])

  // Set up event listeners
  useEffect(() => {
    const setupEventListeners = () => {
      // Interview state changes
      window.electronAPI.onInterviewStateChange((state: string) => {
        setCurrentState(state)
      })

      // Question changes
      window.electronAPI.onQuestionChanged((question: Question) => {
        setCurrentQuestion(question)
        setProgress(prev => ({ ...prev, current: prev.current + 1 }))
      })

      // Coding problem changes
      window.electronAPI.onCodingProblemChanged((problem: CodingProblem) => {
        setCurrentCodingProblem(problem)
        setIsMonitoring(true)
      })

      // Audio state changes
      window.electronAPI.onListeningStateChange((listening: boolean) => {
        console.log('🎤 [Renderer] Received listening state change:', listening)
        isListeningRef.current = listening
        setIsListening(listening)
      })

      window.electronAPI.onSpeakingStateChange((speaking: boolean) => {
        setIsSpeaking(speaking)
      })

      // Evaluations
      window.electronAPI.onEvaluation((evaluation: any) => {
        setEvaluations(prev => [...prev, evaluation])
      })

      // Code analysis
      window.electronAPI.onCodeAnalysis((analysis: any) => {
        setCodeAnalysis(analysis)
      })

      // Interview completion
      window.electronAPI.onInterviewCompleted((results: any) => {
        onComplete?.(results)
      })
    }

    setupEventListeners()
  }, [onComplete])

  // Set up audio visualization
  useEffect(() => {
    const setupAudioVisualization = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        audioContextRef.current = new AudioContext()
        const source = audioContextRef.current.createMediaStreamSource(stream)
        analyserRef.current = audioContextRef.current.createAnalyser()
        
        analyserRef.current.fftSize = 256
        source.connect(analyserRef.current)
        
        startAudioVisualization()
      } catch (error) {
        console.error('Failed to set up audio visualization:', error)
      }
    }

    setupAudioVisualization()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  const startAudioVisualization = () => {
    if (!analyserRef.current) return

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
    
    const animate = () => {
      analyserRef.current!.getByteFrequencyData(dataArray)
      
      // Emit audio data for visualization
      // window.electronAPI.onAudioData?.(dataArray)
      
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    
    animate()
  }

  // Microphone capture and streaming to main (16k PCM mono)
  const startMicrophoneStreaming = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        sampleRate: 48000, // browser typical; we'll downsample
        noiseSuppression: false, // Disable to get raw audio
        echoCancellation: false, // Disable to get raw audio
        autoGainControl: false   // Disable to get raw audio
      } as MediaTrackConstraints })
      
      console.log('🎤 [Mic] Microphone stream obtained:', stream)
      console.log('🎤 [Mic] Audio tracks:', stream.getAudioTracks().length)
      console.log('🎤 [Mic] Track settings:', stream.getAudioTracks()[0]?.getSettings())

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 })
      const source = audioContext.createMediaStreamSource(stream)
      // Use 1024 buffer size (power of 2) - approximately 64ms at 16kHz
      const processor = audioContext.createScriptProcessor(1024, 1, 1)

      const downsampleTo16k = (input: Float32Array, inputSampleRate: number, targetRate = 16000): Int16Array => {
        const sampleRateRatio = inputSampleRate / targetRate
        const newLength = Math.round(input.length / sampleRateRatio)
        const result = new Int16Array(newLength)
        let offsetResult = 0
        let offsetBuffer = 0
        while (offsetResult < result.length) {
          const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
          let accum = 0, count = 0
          for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i++) {
            accum += input[i]
            count++
          }
          const sample = Math.max(-1, Math.min(1, accum / count))
          result[offsetResult] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
          offsetResult++
          offsetBuffer = nextOffsetBuffer
        }
        return result
      }

      processor.onaudioprocess = (e) => {
        // Only stream after STT starts listening
        if (!isListeningRef.current) {
          console.log('🎤 [Mic] Not listening, skipping audio chunk. Current isListening state:', isListening, 'ref:', isListeningRef.current)
          return
        }

        // Throttle to prevent sending too many chunks (1024 samples = ~64ms)
        const now = Date.now()
        if (now - lastAudioTimeRef.current < 50) {
          return
        }
        lastAudioTimeRef.current = now

        const input = e.inputBuffer.getChannelData(0)
        const pcm16 = downsampleTo16k(input, audioContext.sampleRate)
        
        // Convert Int16Array to proper PCM s16le format (browser-compatible)
        const buffer = new Uint8Array(pcm16.buffer)
        
        // Log buffer info for debugging
        console.log('🎤 [Mic] Buffer size:', buffer.length, 'samples:', pcm16.length)
        
        // Log audio activity
        const audioLevel = Math.sqrt(input.reduce((sum, val) => sum + val * val, 0) / input.length)
        console.log('🎤 [Mic] Audio level:', audioLevel.toFixed(4), 'chunk size:', buffer.length)
        
        // Apply volume boost if audio is too quiet
        if (audioLevel > 0.001) { // If there's any audio at all
          const boostFactor = 2.0 // 2x volume boost (less aggressive)
          const boostedInput = input.map(sample => Math.max(-1, Math.min(1, sample * boostFactor)))
          const boostedPcm16 = downsampleTo16k(boostedInput, audioContext.sampleRate)
          const boostedBuffer = new Uint8Array(boostedPcm16.buffer)
          console.log('🎤 [Mic] Applying volume boost, sending boosted audio')
          window.electronAPI.sendAudioChunk(boostedBuffer)
          return
        }
        
        window.electronAPI.sendAudioChunk(buffer)
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      setHasMicStream(true)
    } catch (err) {
      console.error('Microphone streaming error:', err)
    }
  }

  // When STT is listening and mic stream is ready, proceed from connecting → intro
  useEffect(() => {
    if (currentState === 'connecting' && isListening && hasMicStream) {
      setCurrentState('intro')
    }
  }, [currentState, isListening, hasMicStream])

  const handleCodeChange = useCallback((code: string) => {
    // Code changed, could trigger immediate analysis if needed
    console.log('Code changed:', code.length, 'characters')
  }, [])

  const handleAnalysisRequest = useCallback(async (code: string, problemId: string) => {
    try {
      const result = await window.electronAPI.analyzeCode({
        code,
        problemId,
        timestamp: Date.now()
      })

      if (result.success) {
        setCodeAnalysis(result.analysis)
      }
    } catch (error) {
      console.error('Code analysis failed:', error)
    }
  }, [])

  const handleSubmit = useCallback(async (code: string) => {
    try {
      console.log('📤 [Interview] Submitting solution:', code.length, 'characters')
      const result = await window.electronAPI.submitSolution(code)

      if (result.success) {
        console.log('✅ [Interview] Solution submitted successfully')
        // Feedback will be spoken via TTS
        // Next problem will be presented automatically if exists
        if (result.hasNextProblem) {
          console.log('➡️ [Interview] Moving to next problem')
        } else {
          console.log('🎉 [Interview] All coding problems completed')
        }
      } else {
        console.log('❌ [Interview] Solution needs improvement:', result.feedback)
        // Show feedback to user - they can improve and resubmit
        alert(result.feedback || 'Your solution needs some improvements. Please review and try again.')
      }
    } catch (error) {
      console.error('Failed to submit solution:', error)
      alert('Failed to submit solution. Please try again.')
    }
  }, [])

  const handlePauseInterview = useCallback(async () => {
    try {
      await window.electronAPI.pauseInterview()
    } catch (error) {
      console.error('Failed to pause interview:', error)
    }
  }, [])

  const handleResumeInterview = useCallback(async () => {
    try {
      await window.electronAPI.resumeInterview()
    } catch (error) {
      console.error('Failed to resume interview:', error)
    }
  }, [])

  const handleStopInterview = useCallback(async () => {
    try {
      await window.electronAPI.stopInterview()
    } catch (error) {
      console.error('Failed to stop interview:', error)
    }
  }, [])

  const renderCurrentSection = () => {
    switch (currentState) {
      case 'connecting':
        return (
          <div className="loading-section">
            <h2>Preparing Interview...</h2>
            <p>Connecting audio and AI services. Please wait…</p>
          </div>
        )
      case 'intro':
        return (
          <div className="intro-section">
            <h2>Welcome to Your AI Interview</h2>
            <p>I'll be conducting your technical interview today. We'll start with some theoretical questions, then move on to a coding problem.</p>
            <p>Please make sure your microphone is working and speak clearly.</p>
          </div>
        )

      case 'theoretical_question':
      case 'waiting_for_answer':
      case 'evaluating_answer':
      case 'follow_up':
        return (
          <div className="theoretical-section">
            <QuestionDisplay 
              question={currentQuestion}
              isListening={isListening}
              isSpeaking={isSpeaking}
              progress={progress}
            />
          </div>
        )

      case 'coding_intro':
        return (
          <div className="coding-intro-section">
            <h2>Moving to Coding Section</h2>
            <p>Now we'll work on a programming problem. Take your time and think through the solution step by step.</p>
          </div>
        )

      case 'coding_problem':
      case 'monitoring_code':
      case 'providing_hint':
        return (
          <div className="coding-section">
            {currentCodingProblem && (
              <div ref={codeEditorRef}>
                <CodeEditor
                  problem={currentCodingProblem}
                  onCodeChange={handleCodeChange}
                  onAnalysisRequest={handleAnalysisRequest}
                  onSubmit={handleSubmit}
                  isMonitoring={isMonitoring}
                />
              </div>
            )}
            {codeAnalysis && (
              <div className="code-analysis">
                <h4>Progress Analysis</h4>
                <p>Progress: {codeAnalysis.progress}%</p>
                <p>Approach: {codeAnalysis.approach}</p>
                {codeAnalysis.isStuck && (
                  <p className="stuck-indicator">You seem to be stuck. A hint might be coming!</p>
                )}
              </div>
            )}
          </div>
        )

      case 'wrap_up':
        return (
          <div className="wrap-up-section">
            <h2>Interview Complete!</h2>
            <p>Thank you for completing the interview. Your responses have been recorded and will be evaluated.</p>
            <div className="summary">
              <h3>Summary</h3>
              <p>Questions answered: {evaluations.length}</p>
              <p>Average score: {evaluations.length > 0 ? 
                (evaluations.reduce((sum, ev) => sum + ev.score, 0) / evaluations.length).toFixed(1) : 
                'N/A'
              }%</p>
            </div>
          </div>
        )

      default:
        return (
          <div className="loading-section">
            <h2>Preparing Interview...</h2>
            <p>Please wait while we set up your interview session.</p>
          </div>
        )
    }
  }

  // Handle continue unfinished interview
  const handleContinueUnfinishedInterview = async () => {
    console.log('Resuming unfinished interview')
    setShowResumeModal(false)
    setHasCheckedUnfinished(true)
    setUserChoseResume(true)
    // Continue with existing session
  }

  // Handle restart fresh interview
  const handleStartFreshInterview = async () => {
    console.log('Starting fresh interview')
    try {
      // Clear the unfinished session
      await window.electronAPI.clearUnfinishedInterview()
      setShowResumeModal(false)
      setUnfinishedSession(null)
      setHasCheckedUnfinished(true)
      // Proceed with new interview
    } catch (error) {
      console.error('Failed to clear unfinished interview:', error)
    }
  }

  return (
    <>
      <ResumeInterviewModal
        visible={showResumeModal}
        sessionSummary={unfinishedSession ? {
          questionsAnswered: unfinishedSession.questionsAnswered,
          totalQuestions: unfinishedSession.totalQuestions,
          lastActivity: unfinishedSession.lastActivity,
          sessionId: unfinishedSession.sessionId
        } : undefined}
        onResume={handleContinueUnfinishedInterview}
        onRestart={handleStartFreshInterview}
      />
      
      <div className="voice-interview-session">
        <div className="interview-header">
          <InterviewProgress 
            currentState={currentState}
            progress={progress}
            isListening={isListening}
            isSpeaking={isSpeaking}
          />
        
        <div className="interview-controls">
          <button 
            onClick={handlePauseInterview}
            disabled={currentState === 'completed'}
            className="control-btn pause-btn"
          >
            Pause
          </button>
          <button 
            onClick={handleResumeInterview}
            disabled={currentState !== 'paused'}
            className="control-btn resume-btn"
          >
            Resume
          </button>
          <button 
            onClick={handleStopInterview}
            className="control-btn stop-btn"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="interview-content">
        {renderCurrentSection()}
      </div>

      <div className="audio-visualizer">
        <AudioVisualizer 
          isListening={isListening}
          isSpeaking={isSpeaking}
        />
      </div>

      <style>{`
        .voice-interview-session {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: #1a1a1a;
          color: #ffffff;
        }

        .interview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 24px;
          background: #2d2d30;
          border-bottom: 1px solid #333;
        }

        .interview-controls {
          display: flex;
          gap: 12px;
        }

        .control-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .pause-btn {
          background: #ff9800;
          color: white;
        }

        .pause-btn:hover:not(:disabled) {
          background: #f57c00;
        }

        .resume-btn {
          background: #4caf50;
          color: white;
        }

        .resume-btn:hover:not(:disabled) {
          background: #388e3c;
        }

        .stop-btn {
          background: #f44336;
          color: white;
        }

        .stop-btn:hover {
          background: #d32f2f;
        }

        .control-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .interview-content {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }

        .intro-section,
        .coding-intro-section,
        .wrap-up-section,
        .loading-section {
          text-align: center;
          padding: 40px 20px;
        }

        .intro-section h2,
        .coding-intro-section h2,
        .wrap-up-section h2,
        .loading-section h2 {
          margin-bottom: 16px;
          color: #ffffff;
        }

        .intro-section p,
        .coding-intro-section p,
        .wrap-up-section p,
        .loading-section p {
          margin-bottom: 12px;
          color: #cccccc;
          line-height: 1.5;
        }

        .theoretical-section {
          max-width: 800px;
          margin: 0 auto;
        }

        .coding-section {
          max-width: 1000px;
          margin: 0 auto;
        }

        .code-analysis {
          margin-top: 20px;
          padding: 16px;
          background: #2d2d30;
          border-radius: 8px;
          border: 1px solid #333;
        }

        .code-analysis h4 {
          margin: 0 0 12px 0;
          color: #ffffff;
        }

        .code-analysis p {
          margin: 8px 0;
          color: #cccccc;
        }

        .stuck-indicator {
          color: #ff9800 !important;
          font-weight: 500;
        }

        .summary {
          margin-top: 24px;
          padding: 20px;
          background: #2d2d30;
          border-radius: 8px;
          border: 1px solid #333;
        }

        .summary h3 {
          margin: 0 0 16px 0;
          color: #ffffff;
        }

        .summary p {
          margin: 8px 0;
          color: #cccccc;
        }

        .audio-visualizer {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 1000;
        }
      `}</style>
      </div>
    </>
  )
}

export default VoiceInterviewSession


