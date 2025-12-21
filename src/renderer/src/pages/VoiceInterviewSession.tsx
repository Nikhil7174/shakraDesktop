import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSelector } from 'react-redux'
import { CodeEditor } from '../components/CodeEditor'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { QuestionDisplay } from '../components/QuestionDisplay'
import { VideoCapture } from '../components/VideoCapture'
import { useVisionSecurity } from '../hooks/useVisionSecurity'
import { VisionSecurityAlert } from '../components/security/VisionSecurityAlert'
import { ResumeInterviewModal } from '../components/interview/ResumeInterviewModal'
import { ConfirmationModal } from '../components/interview/ConfirmationModal'
import { CodingProblem, Question } from '../../../shared/types'
import type { RootState } from '../store'

interface VoiceInterviewSessionProps {
  interviewId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  resumeFromIndex?: number
  skipIntro?: boolean
  interviewLinkId?: number
  onComplete?: (results: any) => void
  onSaveResults?: (summary: any) => Promise<void>
  onStateChange?: (state: string) => void
}

export const VoiceInterviewSession: React.FC<VoiceInterviewSessionProps> = ({
  interviewId,
  questions,
  codingProblems,
  resumeFromIndex,
  skipIntro,
  interviewLinkId,
  onComplete,
  onSaveResults,
  onStateChange
}) => {
  const [currentState, setCurrentState] = useState<string>('connecting')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [followUpQuestionText, setFollowUpQuestionText] = useState<string | null>(null)
  const [currentCodingProblem, setCurrentCodingProblem] = useState<CodingProblem | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const isListeningRef = useRef(false)
  const [progress, setProgress] = useState({ current: 0, total: questions.length })
  const [evaluations, setEvaluations] = useState<any[]>([])
  const [codeAnalysis, setCodeAnalysis] = useState<any>(null)
  const [complexityNotes, setComplexityNotes] = useState<Record<string, { time: string; space: string }>>({})
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [currentCode, setCurrentCode] = useState<string>('')
  const [hasMicStream, setHasMicStream] = useState(false)
  const isSubmittingTimeoutRef = useRef(false)
  const lastAudioTimeRef = useRef(0)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [unfinishedSession, setUnfinishedSession] = useState<any>(null)
  const [hasCheckedUnfinished, setHasCheckedUnfinished] = useState(false)
  const [userChoseResume, setUserChoseResume] = useState(false)
  const [hiddenVideoElement, setHiddenVideoElement] = useState<HTMLVideoElement | null>(null)
  const [visionSecurityStatus, setVisionSecurityStatus] = useState<any>(null)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [confirmationModalConfig, setConfirmationModalConfig] = useState<{
    message: string
    okText: string
    onConfirm: () => void
    onCancel: () => void
    okButtonProps?: any
  } | null>(null)
  const [pendingSubmission, setPendingSubmission] = useState<{
    code: string
    timeComplexity?: string
    spaceComplexity?: string
  } | null>(null)
  
  const codeEditorRef = useRef<any>(null)
  const hasInitializedRef = useRef(false)
  const hasCompletedRef = useRef(false)

  // Initialize vision security tracking that stays active throughout the interview
  // This works even when video windows are hidden (like in coding section)
  // Keep it enabled through 'wrap_up' so we can end and persist all active warnings at final evaluation time
  const { status: hiddenVisionStatus, warningStats, endAllActiveWarnings, getWarningStats } = useVisionSecurity({
    videoElement: hiddenVideoElement,
    enabled: hiddenVideoElement !== null && currentState !== 'connecting',
    isSpeaking,
    isEvaluating,
    isListening,
    onSecurityAlert: (status) => {
      // Just update UI status - TTS is handled in useVisionSecurity hook
      setVisionSecurityStatus(status)
    }
  })
  
  // Keep warningStats ref for final evaluation (logging stays in renderer)
  const warningStatsRef = useRef(warningStats)
  useEffect(() => {
    warningStatsRef.current = warningStats
  }, [warningStats])
  
  // Update vision security status from hidden tracking
  // This ensures we always have the latest status for the UI,
  // but batching for backend is handled via WarningStateManager stats
  useEffect(() => {
    if (hiddenVisionStatus) {
      setVisionSecurityStatus(hiddenVisionStatus)
    }
  }, [hiddenVisionStatus])

  // Track if vision security data has been sent to prevent duplicates
  const visionSecurityDataSent = useRef(false)
  
  // Modified function to send aggregated vision security data
  const sendVisionSecurityToServer = useCallback(async () => {
    const stats = warningStats;
    console.log('📊 [sendVisionSecurityToServer] Called with warningStats:', JSON.stringify(stats, null, 2));
    if (!interviewId) return
    if (!stats || Object.keys(stats).length === 0) {
      console.log('⚠️ [Renderer] No warning stats available')
      return
    }
    
    // Prevent duplicate sends
    if (visionSecurityDataSent.current) {
      console.log('⚠️ Vision security data already sent, skipping duplicate send')
      return
    }

    try {
      const token = localStorage.getItem('authToken') // Fix: use 'authToken' instead of 'token'
      const { API_BASE_URL } = await import('../constants/api')
      
      // Convert warning stats to events array format for API
      const eventsArray = Object.entries(stats).flatMap(([type, data]: [string, any]) => 
        data.events.map((event: any) => ({
          type,
          severity: type === 'multiple_faces' || type === 'face_absent' || type === 'mobile_device_usage' ? 'high' : 'medium',
          description: `${type.replace(/_/g, ' ')} - ${Math.round(event.duration / 1000)}s`,
          count: 1,
          firstOccurrence: event.startTime,
          lastOccurrence: event.endTime,
          duration: event.duration
        }))
      )
      
      console.log('📤 [Vision Security] ===== SENDING TO BACKEND =====')
      console.log('📤 [Vision Security] Total events to send:', eventsArray.length)
      console.log('📤 [Vision Security] Events array:', JSON.stringify(eventsArray, null, 2))
      console.log('📤 [Vision Security] ===== END BATCH =====')
      

      
      const response = await fetch(`${API_BASE_URL}/interview/${interviewId}/vision-security`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({
          suspiciousEvents: eventsArray
        })
      })

      if (!response.ok) {
        console.error('Failed to send vision security data to server')
      } else {
        visionSecurityDataSent.current = true
        console.log(`✅ Vision security summary sent to server: ${eventsArray.length} events`)
      }
    } catch (error) {
      console.error('Error sending vision security data to server:', error)
    }
  }, [interviewId, warningStats])

  // Memoize the callback to prevent infinite loops
  const handleVisionStatusChange = useCallback((status: any) => {
    setVisionSecurityStatus(status)
  }, [])
  const resumeData = useSelector((state: RootState) => state.interview.resumeData)
  const { user, token } = useSelector((state: RootState) => state.auth)
  const audioContextRef = useRef<AudioContext | null>(null)
  
  // Refs for callbacks/data to avoid stale closures in event listeners
  const onSaveResultsRef = useRef(onSaveResults)
  const onCompleteRef = useRef(onComplete)
  const tokenRef = useRef(token)
  
  // Update refs when props/state change
  useEffect(() => {
    onSaveResultsRef.current = onSaveResults
  }, [onSaveResults])
  
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])
  
  useEffect(() => {
    tokenRef.current = token
  }, [token])

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
    if (hasInitializedRef.current || hasCompletedRef.current) return

    const initializeInterview = async () => {
      hasInitializedRef.current = true
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
        onStateChange?.(state)
      })

      // Question changes - this fires for NEW questions only (not follow-ups)
      window.electronAPI.onQuestionChanged((question: Question) => {
        setCurrentQuestion(question)
        setFollowUpQuestionText(null) // Clear any follow-up when moving to new question
        // Progress will be updated via progressUpdate event, not here
      })

      // Progress updates from main process (for new questions only, not follow-ups)
      window.electronAPI.onProgressUpdate?.((progress: { current: number, total: number }) => {
        setProgress(progress)
      })

      // Follow-up question asked
      window.electronAPI.onFollowUpAsked?.((followUpText: string) => {
        console.log('📝 [Renderer] Follow-up question asked:', followUpText)
        setFollowUpQuestionText(followUpText)
      })

      // Coding problem changes
      window.electronAPI.onCodingProblemChanged((problem: CodingProblem) => {
        setCurrentCodingProblem(problem)
        setIsMonitoring(true)
        setCurrentCode('') // Reset code when problem changes
        isSubmittingTimeoutRef.current = false // Reset submission flag for new problem
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
      
      // Track evaluation state
      window.electronAPI.onInterviewStateChange((state: string) => {
        setIsEvaluating(state === 'evaluating_answer' || state === 'evaluating_approach')
      })

      // Code analysis
      window.electronAPI.onCodeAnalysis((analysis: any) => {
        setCodeAnalysis(analysis)
      })

      // Final evaluation ready
      window.electronAPI.onFinalEvaluationReady(async (payload: any) => {
        console.log('📊 [Renderer] Submitting final evaluation to backend...')
        
        // CRITICAL: End all active warnings BEFORE collecting stats
        console.log('📊 [Renderer] Ending all active warnings before final stats collection...')
        endAllActiveWarnings()
        
        // Use warningStatsRef.current directly - it's updated via useEffect
        const visionWarnings = warningStatsRef.current
        
        console.log('📊 [Renderer] ===== FINAL VISION WARNINGS BATCH =====')
        console.log('📊 [Renderer] Warning types:', Object.keys(visionWarnings).length)
        console.log('📊 [Renderer] Full structure:', JSON.stringify(visionWarnings, null, 2))
        console.log('📊 [Renderer] ===== END BATCH =====')
        
        // Add vision warnings to payload for backend
        payload.visionSecurityWarnings = visionWarnings
        
          try {
          const { API_BASE_URL } = await import('../constants/api')
          // Use token from ref to ensure we have the latest one even if localStorage was cleared
          const authToken = tokenRef.current || localStorage.getItem('authToken')
          
          const response = await fetch(`${API_BASE_URL}/interview/final-evaluation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
          })
          const data = await response.json()
          if (response.ok && data.success) {
            console.log('✅ [Renderer] Final evaluation submitted successfully!')
            await window.electronAPI.markPayloadSent()
          } else {
            console.error('❌ [Renderer] Final evaluation submission failed:', data.error)
          }
        } catch (error: any) {
          console.error('❌ [Renderer] Failed to submit final evaluation:', error.message)
        }
      })

      // Skip question confirmation request from main process
      window.electronAPI.onSkipQuestionRequest(() => {
        console.log('🎯 [Renderer] Received skip question request - showing confirmation modal')
        setConfirmationModalConfig({
          message: 'Are you sure you want to skip this coding problem and move to the next question?',
          okText: 'Skip question',
          onConfirm: handleConfirmSkip,
          onCancel: handleCancelSkip
        })
        setShowConfirmationModal(true)
      })

      // Interview completion
      window.electronAPI.onInterviewCompleted(async (results: any) => {
        hasCompletedRef.current = true
        // For now, rely on WarningStateManager stats which are used in onFinalEvaluationReady
        console.log('📊 [Renderer] Interview completed - final warning stats will be attached in final evaluation payload')
        
        // Note: Final stats will be sent to backend via final evaluation payload
        // No need to send to main process - logging stays in renderer
        
        // Save results if onSaveResults is provided
        if (onSaveResultsRef.current && interviewLinkId) {
          try {
            // Create summary similar to InterviewCompletionModal
            const totalQuestions = questions.length + codingProblems.length
            const theoreticalScore = evaluations.length > 0 
              ? evaluations.reduce((sum, ev) => sum + (ev.score || 0), 0) / evaluations.length 
              : 0
            
            const summary = {
              sessionId: interviewId,
              interviewLinkId: interviewLinkId,
              candidateId: results?.candidateId || 'unknown',
              candidateName: resumeData?.name || user?.fullName || 'Unknown',
              candidateEmail: user?.email || resumeData?.email || 'unknown@example.com',
              candidatePhone: resumeData?.phone || '',
              completedAt: new Date().toISOString(),
              startTime: results?.startTime || new Date().toISOString(),
              endTime: new Date().toISOString(),
              duration: results?.duration || 0,
              score: Math.round(theoreticalScore),
              totalQuestions: totalQuestions,
              correctAnswers: evaluations.filter(ev => ev.score >= 70).length,
              timeSpent: results?.timeSpent || 0,
              strengths: theoreticalScore >= 80 ? ['Excellent technical knowledge'] : ['Good understanding'],
              areasForImprovement: theoreticalScore < 60 ? ['Review fundamentals'] : ['Continue practicing'],
              overallFeedback: `Interview completed with ${Math.round(theoreticalScore)}% average score.`,
              detailedAnswers: evaluations.map(ev => ({
                questionId: ev.questionId || '',
                question: ev.question || '',
                userAnswer: ev.answer || '',
                correctAnswer: '',
                isCorrect: ev.score >= 70,
                timeTaken: ev.timeTaken || 0
              })),
              questionAnalysis: {
                easyQuestions: questions.filter(q => (q as any).difficulty === 'easy').length,
                mediumQuestions: questions.filter(q => (q as any).difficulty === 'medium').length,
                hardQuestions: questions.filter(q => (q as any).difficulty === 'hard').length,
                correctByDifficulty: {
                  easy: 0,
                  medium: 0,
                  hard: 0
                }
              }
            }
            
            console.log('💾 Saving interview results:', summary)
            await onSaveResultsRef.current(summary)
            console.log('✅ Interview results saved successfully')
          } catch (error) {
            console.error('❌ Failed to save interview results:', error)
          }
        }
        
        // NOTE: Don't clear unfinished interview here - the payload needs to be sent first
        // The main process will clear conversations after payload is successfully sent via markPayloadSent()
        // This event (onInterviewCompleted) fires before the final evaluation payload is sent
        
        onCompleteRef.current?.(results)
      })
    }

    setupEventListeners()
    
    // No cleanup needed - IPC listeners are one-time setup
    // Dependencies are intentionally minimal to avoid re-registration
  }, [])

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
      // Request high-quality audio with noise suppression and echo cancellation
      // Request high-quality audio with noise suppression and echo cancellation enabled
      // These improve transcription accuracy by reducing background noise and echo
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        sampleRate: 48000, // browser typical; we'll downsample to 16kHz
        noiseSuppression: true, // Enable to reduce background noise
        echoCancellation: true, // Enable to prevent echo/feedback
        autoGainControl: true   // Enable to normalize volume levels
      } as MediaTrackConstraints })
      
      console.log('🎤 [Mic] Microphone stream obtained:', stream)
      console.log('🎤 [Mic] Audio tracks:', stream.getAudioTracks().length)
      const trackSettings = stream.getAudioTracks()[0]?.getSettings()
      console.log('🎤 [Mic] Track settings:', trackSettings)

      // Use native AudioContext sample rate (don't force 16kHz - let browser handle it)
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const actualSampleRate = audioContext.sampleRate
      console.log('🎤 [Mic] AudioContext sample rate:', actualSampleRate)
      
      const source = audioContext.createMediaStreamSource(stream)
      // Use 4096 buffer size (power of 2) - approximately 80–90ms at 44.1/48kHz.
      // AssemblyAI requires each audio message to represent 50–1000ms of audio.
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      // Improved downsampling with anti-aliasing for better audio quality
      const downsampleTo16k = (input: Float32Array, inputSampleRate: number, targetRate = 16000): Int16Array => {
        // If already at target rate, just convert format
        if (Math.abs(inputSampleRate - targetRate) < 1) {
          const result = new Int16Array(input.length)
          for (let i = 0; i < input.length; i++) {
            const clamped = Math.max(-1, Math.min(1, input[i]))
            result[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7FFF)
          }
          return result
        }
        
        const sampleRateRatio = inputSampleRate / targetRate
        const newLength = Math.round(input.length / sampleRateRatio)
        const result = new Int16Array(newLength)
        let offsetResult = 0
        
        // Use linear interpolation for better quality than simple averaging
        while (offsetResult < result.length) {
          const targetIndex = offsetResult * sampleRateRatio
          const index1 = Math.floor(targetIndex)
          const index2 = Math.min(index1 + 1, input.length - 1)
          const fraction = targetIndex - index1
          
          // Linear interpolation
          const sample = input[index1] * (1 - fraction) + input[index2] * fraction
          // Clamp and convert to 16-bit PCM
          const clamped = Math.max(-1, Math.min(1, sample))
          const int16Value = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7FFF)
          
          // Log first sample conversion occasionally to verify it's working
          if (offsetResult === 0 && Math.random() < 0.01) {
            console.log('🎤 [Renderer] Sample conversion check:', {
              floatSample: sample.toFixed(6),
              clamped: clamped.toFixed(6),
              int16Value: int16Value,
              expectedRange: '[-32768, 32767]'
            })
          }
          
          result[offsetResult] = int16Value
          offsetResult++
        }
        return result
      }

      processor.onaudioprocess = (e) => {
        // Only stream after STT starts listening
        if (!isListeningRef.current) {
          // Log occasionally when not listening to diagnose issues
          if (Math.random() < 0.01) {
            console.log('🎤 [Renderer] Audio chunk skipped - not listening. isListeningRef:', isListeningRef.current)
          }
          return
        }

        // Throttle to prevent sending too many chunks (1024 samples = ~64ms)
        const now = Date.now()
        if (now - lastAudioTimeRef.current < 50) {
          return
        }
        lastAudioTimeRef.current = now

        const input = e.inputBuffer.getChannelData(0)
        
        // Calculate audio level BEFORE downsampling for diagnostics
        const maxSample = Math.max(...Array.from(input).map(Math.abs))
        const rmsLevel = Math.sqrt(input.reduce((sum, val) => sum + val * val, 0) / input.length)
        
        // Simple adaptive gain control: try to normalize RMS towards a target without clipping
        const targetRms = 0.05 // target RMS for clear speech (~-26 dBFS)
        let gain = 1
        if (rmsLevel > 0 && rmsLevel < targetRms) {
          // Cap max gain to avoid insane amplification of pure noise
          gain = Math.min(targetRms / rmsLevel, 8)
        }
        
        const boostedInput =
          gain !== 1
            ? input.map((sample) => {
                const boosted = sample * gain
                return Math.max(-1, Math.min(1, boosted))
              })
            : input
        
        // Log audio levels to diagnose volume issues
        if (Math.random() < 0.1) {
          console.log(
            '🎤 [Renderer] Audio levels',
            '| max:', maxSample.toFixed(6),
            '| RMS:', rmsLevel.toFixed(6),
            '| gain:', gain.toFixed(2),
            '| samples:', input.length,
            '| sampleRate:', actualSampleRate
          )
        }
        
        // Downsample to 16kHz using the actual AudioContext sample rate
        const pcm16 = downsampleTo16k(boostedInput, actualSampleRate)
        
        // Check downsampled audio levels
        const pcmMax = Math.max(...Array.from(pcm16).map(Math.abs))
        const pcmRms = Math.sqrt(Array.from(pcm16).reduce((sum, val) => sum + (val / 32768) ** 2, 0) / pcm16.length)
        
        if (Math.random() < 0.1) {
          console.log('🎤 [Renderer] PCM16 levels - max:', pcmMax, 'RMS (normalized):', pcmRms.toFixed(6), 'expected range: 0-32767')
          
          // Warn if PCM values are suspiciously small
          if (pcmMax < 100) {
            console.warn('🎤 [Renderer] WARNING: PCM16 values are very small! max:', pcmMax, 'Expected hundreds or thousands for normal speech.')
          }
        }
        
        // Convert Int16Array to Uint8Array with proper little-endian byte order
        // Int16Array is already little-endian in JavaScript, so we can use the buffer directly
        const buffer = new Uint8Array(pcm16.buffer)
        
        // Verify buffer size (should be pcm16.length * 2 bytes for 16-bit samples)
        if (buffer.length !== pcm16.length * 2) {
          console.error('🎤 [Renderer] Audio buffer size mismatch!', {
            pcm16Length: pcm16.length,
            bufferLength: buffer.length,
            expected: pcm16.length * 2
          })
        }
        
        // Send all audio chunks - let AssemblyAI handle silence detection and VAD
        // Filtering silence here can cause issues with speech detection
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
    // Track current code for timer expiration
    setCurrentCode(code)
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

  const handleSubmit = useCallback(async (code: string, timeComplexity?: string, spaceComplexity?: string, skipConfirmation = false) => {
    // If skipConfirmation is true (timer expiration), submit directly without modal
    if (skipConfirmation) {
      try {
        console.log('📤 [Interview] Auto-submitting solution (timer expired):', code.length, 'characters')
        // Get complexity from current problem's notes
        const complexity = currentCodingProblem && complexityNotes[currentCodingProblem.id]
          ? complexityNotes[currentCodingProblem.id]
          : { time: timeComplexity || '', space: spaceComplexity || '' }
        
        const result = await window.electronAPI.submitSolution(
          code, 
          true, // isTimeout = true
          complexity.time || undefined, 
          complexity.space || undefined
        )

        if (result.success) {
          console.log('✅ [Interview] Timeout solution submitted successfully')
          setCurrentCode('')
          if (result.hasNextProblem) {
            console.log('➡️ [Interview] Moving to next problem')
          } else {
            console.log('🎉 [Interview] All coding problems completed')
          }
        } else {
          console.log('❌ [Interview] Timeout submission failed:', result.feedback)
        }
      } catch (error) {
        console.error('Failed to submit timeout solution:', error)
      }
      return
    }

    // For manual submissions, show confirmation modal
    console.log('📤 [Interview] Requesting confirmation before submitting solution')
    setPendingSubmission({ code, timeComplexity, spaceComplexity })
    setConfirmationModalConfig({
      message: 'Are you sure you want to submit your solution and move to the next question?',
      okText: 'Submit solution',
      onConfirm: confirmSubmit,
      onCancel: cancelSubmit
    })
    setShowConfirmationModal(true)
  }, [currentCodingProblem, complexityNotes])

  const confirmSubmit = useCallback(async () => {
    if (!pendingSubmission) return
    
    setShowConfirmationModal(false)
    const { code, timeComplexity, spaceComplexity } = pendingSubmission
    setPendingSubmission(null)

    try {
      console.log('📤 [Interview] Submitting solution after confirmation:', code.length, 'characters')
      // Get complexity from current problem's notes
      const complexity = currentCodingProblem && complexityNotes[currentCodingProblem.id]
        ? complexityNotes[currentCodingProblem.id]
        : { time: timeComplexity || '', space: spaceComplexity || '' }
      
      const result = await window.electronAPI.submitSolution(
        code, 
        false, 
        complexity.time || undefined, 
        complexity.space || undefined
      )

      if (result.success) {
        console.log('✅ [Interview] Solution submitted successfully')
        // Feedback will be spoken via TTS
        // Next problem will be presented automatically if exists
        if (result.hasNextProblem) {
          console.log('➡️ [Interview] Moving to next problem')
        } else {
          console.log('🎉 [Interview] All coding problems completed')
        }
        // Reset current code for next problem
        setCurrentCode('')
      } else {
        console.log('❌ [Interview] Solution needs improvement:', result.feedback)
        // Feedback is already spoken by the orchestrator, no need for alert popup
        // Just log and continue - the interview will proceed automatically
      }
    } catch (error) {
      console.error('Failed to submit solution:', error)
      // Don't show blocking alert - error is already logged
      // The interview flow will handle errors gracefully
    }
  }, [pendingSubmission, currentCodingProblem, complexityNotes])

  const cancelSubmit = useCallback(() => {
    setShowConfirmationModal(false)
    setPendingSubmission(null)
  }, [])

  const handleTimerExpire = useCallback(async () => {
    if (!currentCodingProblem) return
    
    // Prevent multiple simultaneous submissions
    if (isSubmittingTimeoutRef.current) {
      console.log('⏰ [Interview] Timer expiration already being handled, ignoring duplicate call')
      return
    }
    
    isSubmittingTimeoutRef.current = true
    console.log('⏰ [Interview] Coding timer expired for problem:', currentCodingProblem.title)
    
    // Submit the current code (or empty if no code written) - skip confirmation for timer expiration
    const codeToSubmit = currentCode.trim() || '// Timeout - no code submitted'
    
    // Get complexity for timeout submission
    const complexity = currentCodingProblem && complexityNotes[currentCodingProblem.id]
      ? complexityNotes[currentCodingProblem.id]
      : { time: '', space: '' }
    
    // Call handleSubmit with skipConfirmation = true to bypass modal
    await handleSubmit(codeToSubmit, complexity.time || undefined, complexity.space || undefined, true)
    
    // Reset the flag after a delay to allow state updates
    setTimeout(() => {
      isSubmittingTimeoutRef.current = false
    }, 2000)
  }, [currentCodingProblem, currentCode, complexityNotes, handleSubmit])


  const currentComplexity =
    currentCodingProblem && complexityNotes[currentCodingProblem.id]
      ? complexityNotes[currentCodingProblem.id]
      : { time: '', space: '' }


  const renderCodingWorkspace = (monitoringMode: boolean) => (
    <div className="coding-section">
      {currentCodingProblem && (
        <div ref={codeEditorRef}>
          <CodeEditor
            problem={currentCodingProblem}
            onCodeChange={handleCodeChange}
            onAnalysisRequest={handleAnalysisRequest}
            onSubmit={handleSubmit}
            onTimerExpire={handleTimerExpire}
            isMonitoring={monitoringMode ? isMonitoring : false}
            timeComplexity={currentComplexity.time}
            spaceComplexity={currentComplexity.space}
            onTimeComplexityChange={(value) => {
              if (currentCodingProblem) {
                setComplexityNotes(prev => ({
                  ...prev,
                  [currentCodingProblem.id]: {
                    time: value,
                    space: prev[currentCodingProblem.id]?.space || ''
                  }
                }))
              }
            }}
            onSpaceComplexityChange={(value) => {
              if (currentCodingProblem) {
                setComplexityNotes(prev => ({
                  ...prev,
                  [currentCodingProblem.id]: {
                    time: prev[currentCodingProblem.id]?.time || '',
                    space: value
                  }
                }))
              }
            }}
          />
        </div>
      )}
    </div>
  )

  const renderCurrentSection = () => {
    switch (currentState) {
      case 'connecting':
        return (
          <div className="loading-section">
            <div className="glassmorphic-card">
              <div className="loading-content">
                <div className="spinner-container">
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                  <div className="spinner-center">
                    <div className="spinner-dot"></div>
                  </div>
                </div>
                <h2 className="loading-title">Preparing Interview</h2>
                <p className="loading-subtitle">Connecting audio and AI services</p>
              </div>
            </div>
          </div>
        )
      case 'intro':
        const introMessage = "Welcome to your AI interview. I'll be conducting your technical interview today. We'll start with some theoretical questions, then move on to a coding problem. Please make sure your microphone is working and speak clearly."
        
        return (
          <div className="theoretical-section">
            <QuestionDisplay 
              question={null}
              introMessage={isSpeaking ? introMessage : null}
              introMeta="Ready to begin"
              isListening={isListening}
              isSpeaking={isSpeaking}
              progress={progress}
              onVisionStatusChange={handleVisionStatusChange}
            />
          </div>
        )

      case 'theoretical_question':
      case 'waiting_for_answer':
      case 'evaluating_answer':
      case 'follow_up':
      case 'handling_theoretical_hint':
      case 'handling_clarification':
        return (
          <div className="theoretical-section">
            <QuestionDisplay 
              question={currentQuestion}
              followUpQuestionText={followUpQuestionText}
              isListening={isListening}
              isSpeaking={isSpeaking}
              progress={progress}
              onVisionStatusChange={handleVisionStatusChange}
            />
          </div>
        )

      case 'coding_intro':
        return (
          <div className="coding-intro-section">
            <h2>Moving to Coding Section</h2>
            <p>Now we'll work on a programming problem. Take your time and think through the solution step by step.</p>
            <p>As you implement, jot down the time and space complexity in the boxes beneath the editor so you can discuss them later.</p>
          </div>
        )

      case 'coding_problem':
        return renderCodingWorkspace(false)

      case 'coding_approach':
      case 'waiting_for_approach':
      case 'evaluating_approach':
        return renderCodingWorkspace(false)

      case 'monitoring_code':
      case 'providing_hint':
        return renderCodingWorkspace(true)

      case 'wrap_up':
      case 'completed':
        return (
          <div className="loading-section">
            <div className="glassmorphic-card wrap-up-card">
              <div className="wrap-up-icon">
                <div className="wrap-up-center">
                  <span>✓</span>
                </div>
              </div>
              <h2 className="loading-title">Interview Complete</h2>
              <p className="loading-subtitle">Thanks for the great conversation. We'll review everything and update you shortly.</p>
            </div>
          </div>
        )

      default:
        return (
          <div className="loading-section">
            <div className="glassmorphic-card">
              <div className="loading-content">
                <div className="spinner-container">
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                  <div className="spinner-ring"></div>
                  <div className="spinner-center">
                    <div className="spinner-dot"></div>
                  </div>
                </div>
                <h2 className="loading-title">Preparing Interview</h2>
                <p className="loading-subtitle">Please wait while we set up your interview session</p>
              </div>
            </div>
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

  // Handle cancel/close modal - user doesn't want to continue
  const handleCancelModal = useCallback(() => {
    console.log('User cancelled resume modal - closing and allowing navigation back')
    setShowResumeModal(false)
    setUnfinishedSession(null)
    setHasCheckedUnfinished(true)
    // Call onComplete to allow parent to handle navigation
    onComplete?.({ cancelled: true })
  }, [onComplete])

  const handleConfirmSkip = useCallback(async () => {
    setShowConfirmationModal(false)
    console.log('🎯 [Renderer] User confirmed skip question')
    await window.electronAPI.confirmSkipQuestion(true)
  }, [])

  const handleCancelSkip = useCallback(async () => {
    setShowConfirmationModal(false)
    console.log('🎯 [Renderer] User cancelled skip question')
    await window.electronAPI.confirmSkipQuestion(false)
  }, [])

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
        onCancel={handleCancelModal}
      />
      
      {confirmationModalConfig && (
        <ConfirmationModal
          visible={showConfirmationModal}
          message={confirmationModalConfig.message}
          okText={confirmationModalConfig.okText}
          onConfirm={confirmationModalConfig.onConfirm}
          onCancel={confirmationModalConfig.onCancel}
          okButtonProps={confirmationModalConfig.okButtonProps}
        />
      )}
      
        <div
          className="voice-interview-session"
          style={{ height: currentState === 'connecting' ? '100vh' : '86vh' }}
        >
        <div className="interview-content">
        {renderCurrentSection()}
      </div>

      {/* Vision Security Alerts - Display warnings for suspicious events */}
      <VisionSecurityAlert 
        status={visionSecurityStatus}
        warningStats={warningStats}
        onDismiss={(eventType) => {
          console.log('🔕 [Vision Security] Alert dismissed:', eventType)
        }}
      />

      {/* Hidden video capture for security tracking during coding section and throughout interview */}
      <div className="hidden-video-tracker">
        <VideoCapture
          onStreamReady={() => {
            console.log('📹 [VoiceInterviewSession] Hidden video stream ready for security tracking')
          }}
          onVideoElementReady={(videoEl) => {
            setHiddenVideoElement(videoEl)
            console.log('📹 [VoiceInterviewSession] Hidden video element ready for vision tracking')
          }}
          onStreamError={(error) => {
            console.error('Hidden video capture error:', error)
          }}
          className="hidden-video-capture"
          autoStart={true}
        />
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
          height: 86vh;
          background: #1a1a1a;
          color: #ffffff;
        }

        .interview-content {
          flex: 1;
          padding: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .coding-intro-section,
        .wrap-up-section {
          text-align: center;
          padding: 40px 20px;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .loading-section {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          position: relative;
          overflow: hidden;
        }

        .loading-section::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(33, 150, 243, 0.1) 0%, transparent 70%);
          animation: rotate 20s linear infinite;
        }

        @keyframes rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .glassmorphic-card {
          position: relative;
          z-index: 1;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 60px 40px;
          box-shadow: 
            0 8px 32px 0 rgba(0, 0, 0, 0.37),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
          max-width: 500px;
          width: 100%;
          animation: fadeInUp 0.6s ease-out;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .loading-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }

        .spinner-container {
          position: relative;
          width: 120px;
          height: 120px;
          margin-bottom: 8px;
        }

        .spinner-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 3px solid transparent;
          border-top-color: #2196f3;
          border-radius: 50%;
          animation: spin 1.5s linear infinite;
        }

        .spinner-ring:nth-child(1) {
          animation-delay: 0s;
          border-top-color: #2196f3;
        }

        .spinner-ring:nth-child(2) {
          animation-delay: 0.3s;
          border-top-color: #4caf50;
          width: 85%;
          height: 85%;
          top: 7.5%;
          left: 7.5%;
        }

        .spinner-ring:nth-child(3) {
          animation-delay: 0.6s;
          border-top-color: #ab47bc;
          width: 70%;
          height: 70%;
          top: 15%;
          left: 15%;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .spinner-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          background: rgba(33, 150, 243, 0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(10px);
        }

        .spinner-dot {
          width: 12px;
          height: 12px;
          background: #2196f3;
          border-radius: 50%;
          animation: pulse 1.5s ease-in-out infinite;
        }


        .loading-title {
          font-size: 28px;
          font-weight: 600;
          color: #ffffff;
          margin: 0;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #b0b0b0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .loading-subtitle {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.7);
          margin: 0;
          font-weight: 400;
          letter-spacing: 0.3px;
        }


        .coding-intro-section h2,
        .wrap-up-section h2 {
          margin-bottom: 16px;
          color: #ffffff;
        }

        .coding-intro-section p,
        .wrap-up-section p {
          margin-bottom: 12px;
          color: #cccccc;
          line-height: 1.5;
        }

        .wrap-up-card {
          text-align: center;
          gap: 24px;
        }

        .wrap-up-icon {
          width: 110px;
          height: 110px;
          margin: 0 auto 8px auto;
          border-radius: 50%;
          background: radial-gradient(circle at top, rgba(76, 175, 80, 0.4), rgba(76, 175, 80, 0.15));
          border: 1px solid rgba(76, 175, 80, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(76, 175, 80, 0.25), inset 0 0 30px rgba(76, 175, 80, 0.15);
        }

        .wrap-up-center {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          background: rgba(76, 175, 80, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4caf50;
          font-size: 32px;
          font-weight: 600;
          border: 1px solid rgba(76, 175, 80, 0.4);
        }


        .theoretical-section {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
        }

        .coding-section {
          margin: 0 auto;
          padding: 24px;
          width: 100%;
          height: 100%;
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
          bottom: 10px;
          right: 20px;
          z-index: 1000;
        }

        .hidden-video-tracker {
          position: fixed;
          top: -9999px;
          left: -9999px;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: -1;
        }

        .hidden-video-tracker video {
          width: 1px;
          height: 1px;
        }
      `}</style>
      </div>
    </>
  )
}

export default VoiceInterviewSession


