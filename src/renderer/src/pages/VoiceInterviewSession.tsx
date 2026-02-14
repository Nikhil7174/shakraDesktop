import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSelector } from 'react-redux'
import { AudioOutlined, AudioMutedOutlined, PhoneOutlined } from '@ant-design/icons'
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from '@livekit/components-react'
import { RoomEvent, LogLevel, setLogLevel } from 'livekit-client'
import { CodeEditor } from '../components/CodeEditor'
import { AudioVisualizer } from '../components/AudioVisualizer'
import { QuestionDisplay } from '../components/QuestionDisplay'
import { VideoCapture } from '../components/VideoCapture'
import { VisionSecurityAlert } from '../components/security/VisionSecurityAlert'
import { ResumeInterviewModal } from '../components/interview/ResumeInterviewModal'
import { ConfirmationModal } from '../components/interview/ConfirmationModal'
import { InterviewFeedback } from '../components/interview/InterviewFeedback'
import { useVoiceInterviewVisionSecurity } from './visionSecurity'
import { CodingProblem, Question } from '../../../shared/types'
import type { RootState } from '../store'
import type { InterviewSession } from '../types'

interface VoiceInterviewSessionProps {
  interviewId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  resumeFromIndex?: number
  skipIntro?: boolean
  interviewLinkId?: number
  livekitToken?: string
  livekitUrl?: string
  roomName?: string
  onComplete?: (results: any) => void
  onSaveResults?: (summary: any) => Promise<void>
  onStateChange?: (state: string) => void
  onQuitInterview?: () => void
}

export const VoiceInterviewSession: React.FC<VoiceInterviewSessionProps> = ({
  interviewId,
  questions,
  codingProblems,
  resumeFromIndex,
  skipIntro,
  interviewLinkId,
  livekitToken: tokenFromProps,
  livekitUrl: urlFromProps,
  roomName: roomNameFromProps,
  onComplete,
  onSaveResults,
  onStateChange,
  onQuitInterview
}) => {
  useEffect(() => {
    setLogLevel(LogLevel.error)
  }, [])
  const [currentState, setCurrentState] = useState<string>('connecting')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [followUpQuestionText, setFollowUpQuestionText] = useState<string | null>(null)
  const [currentCodingProblem, setCurrentCodingProblem] = useState<CodingProblem | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const isListeningRef = useRef(false)
  const [progress, setProgress] = useState({ current: 0, total: questions.length })
  const [evaluations, setEvaluations] = useState<any[]>([])
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [isHint, setIsHint] = useState(false)
  const [isClarification, setIsClarification] = useState(false)
  const evaluationsRef = useRef<any[]>([])
  const [complexityNotes, setComplexityNotes] = useState<Record<string, { time: string; space: string }>>({})
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [currentCode, setCurrentCode] = useState<string>('')
  const currentCodeRef = useRef<string>('')
  const [currentNotepad, setCurrentNotepad] = useState<string>('')
  const currentNotepadRef = useRef<string>('')
  const [hasMicStream, setHasMicStream] = useState(false)
  const isSubmittingTimeoutRef = useRef<boolean>(false)
  const broadcastDataRef = useRef<((data: any) => void) | null>(null)
  const [livekitToken, setLivekitToken] = useState<string | null>(null)
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null)
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [unfinishedSession, setUnfinishedSession] = useState<any>(null)
  const [hasCheckedUnfinished, setHasCheckedUnfinished] = useState(false)
  const [userChoseResume, setUserChoseResume] = useState(false)
  const [hiddenVideoElement, setHiddenVideoElement] = useState<HTMLVideoElement | null>(null)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [confirmationModalConfig, setConfirmationModalConfig] = useState<{
    message: string
    okText: string
    onConfirm: () => void
    onCancel: () => void
    okButtonProps?: any
  } | null>(null)
  const pendingSubmissionRef = useRef<{
    code: string
    timeComplexity?: string
    spaceComplexity?: string
  } | null>(null)
  const agentSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const codeEditorRef = useRef<any>(null)
  const hasInitializedRef = useRef(false)
  const hasCompletedRef = useRef(false)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [sessionForModals, setSessionForModals] = useState<InterviewSession | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [saveRetryCount, setSaveRetryCount] = useState(0)
  const saveSummaryRef = useRef<any>(null)
  const isInterviewStartedRef = useRef(false)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const livekitRoomRef = useRef<any>(null)

  // Handlers for Agent-triggered confirmation modal
  const handleConfirmNextQuestion = useCallback(() => {
    setShowConfirmationModal(false)
    if (broadcastDataRef.current) {
      broadcastDataRef.current({ type: 'confirm_next_question' })
    }
  }, [])

  const handleCancelNextQuestion = useCallback(() => {
    setShowConfirmationModal(false)
    // Optional: Send cancel event if needed
  }, [])

  // Handle mic mute toggle
  const handleMicToggle = useCallback(async () => {
    const newMutedState = !isMicMuted
    setIsMicMuted(newMutedState)

    // Toggle actual microphone via LiveKit using setMicrophoneEnabled
    if (livekitRoomRef.current?.localParticipant) {
      try {
        // Use LiveKit's built-in method to enable/disable microphone
        await livekitRoomRef.current.localParticipant.setMicrophoneEnabled(!newMutedState)
        console.log(`Microphone ${newMutedState ? 'muted' : 'unmuted'}`)
      } catch (error) {
        console.error('Failed to toggle microphone:', error)
        // Revert state if toggle failed
        setIsMicMuted(!newMutedState)
      }
    }
  }, [isMicMuted])



  const LiveKitRoomEventBridge: React.FC = () => {
    const room = useRoomContext()

    // Expose data broadcasting to parent and store room ref
    useEffect(() => {
      if (room && room.localParticipant) {
        livekitRoomRef.current = room
        broadcastDataRef.current = (data: any) => {
          const encoded = new TextEncoder().encode(JSON.stringify(data))
          room.localParticipant.publishData(encoded, { reliable: true })
        }
      } else {
        broadcastDataRef.current = null
      }
      return () => {
        broadcastDataRef.current = null
      }
    }, [room])

    useEffect(() => {
      if (!room) return

      // Broadcast code changes to agent (debounced)
      // Notepad is bundled with code sync; also synced immediately when user speaks
      const isCodingState = currentState === 'coding_problem' || currentState === 'coding'
      if (isCodingState && (currentCode || currentComplexity.time || currentComplexity.space)) {
        const timeoutId = setTimeout(() => {
          if (room.localParticipant) {
            const data = new TextEncoder().encode(JSON.stringify({
              type: 'code_snapshot',
              code: currentCode,
              notepad: currentNotepadRef.current || '',
              complexity: {
                time: currentComplexity.time,
                space: currentComplexity.space
              },
              timestamp: Date.now()
            }))
            room.localParticipant.publishData(data, { reliable: true })
          }
        }, 2000) // 2 second debounce

        return () => clearTimeout(timeoutId)
      }
      return
    }, [currentCode, currentComplexity.time, currentComplexity.space, room, currentState])

    // Keep currentCodeRef and currentNotepadRef in sync with state
    useEffect(() => {
      currentCodeRef.current = currentCode
    }, [currentCode])

    useEffect(() => {
      currentNotepadRef.current = currentNotepad
    }, [currentNotepad])

    useEffect(() => {
      if (!room) return

      const checkForAgentAndEnableListening = () => {
        const remoteParticipants = Array.from(room.remoteParticipants.values())

        if (remoteParticipants.length > 0) {
          const hasAgent = remoteParticipants.some(p =>
            (p as any).isAgent ||
            (p as any).identity?.toLowerCase().includes('agent') ||
            (p as any).identity?.startsWith('agent-')
          )

          if (hasAgent || remoteParticipants.length > 0) {
            isListeningRef.current = true
            setIsListening(true)
            setCurrentState(prev => (prev === 'connecting' ? 'intro' : prev))

            // Also send request state here if we found the agent
            // This covers the case where the agent was already in the room
            // Note: Caller might also do it, but deduplication is fine
            // We'll trust the caller to handle the sending to avoid duplication
            return true
          }
        }
        return false
      }

      const isAgentParticipant = (participant: any) => {
        return !!participant?.isAgent ||
          participant?.identity?.toLowerCase().includes('agent') ||
          participant?.identity?.startsWith('agent-')
      }

      if (checkForAgentAndEnableListening()) {
        // If agent is already there, request state immediately
        const requestData = new TextEncoder().encode(JSON.stringify({ type: 'request-state' }))
        room.localParticipant.publishData(requestData, { reliable: true })
      }

      const handleParticipantConnected = (participant: any) => {
        console.log('🎤 [LiveKit] Participant connected:', participant.identity, 'isAgent:', participant.isAgent)
        if (checkForAgentAndEnableListening()) {
          console.log('🔄 [LiveKit] Agent connected, requesting state sync...')
          const requestData = new TextEncoder().encode(JSON.stringify({ type: 'request-state' }))
          room.localParticipant.publishData(requestData, { reliable: true })
        }
      }

      const handleDataReceived = (payload: Uint8Array) => {
        try {
          const decoder = new TextDecoder()
          const messageText = decoder.decode(payload)
          const messageData = JSON.parse(messageText)

          if (messageData.type === 'question-changed' && messageData.question) {
            // Only reset badges if this is a different question
            const isDifferentQuestion = currentQuestion?.id !== messageData.question.id

            setCurrentQuestion(messageData.question)
            setFollowUpQuestionText(null)

            // Only reset badges when switching to a different question
            if (isDifferentQuestion) {
              setIsFollowUp(false)
              setIsHint(false)
              setIsClarification(false)
            }

            setCurrentState('theoretical_question')
            onStateChange?.('theoretical_question')
            setIsListening(true)
            isListeningRef.current = true
            if (messageData.questionIndex !== undefined) {
              setProgress({ current: messageData.questionIndex + 1, total: questions.length })
            }
          }

          if (messageData.type === 'coding-problem-changed' && messageData.codingProblem) {
            // Only reset badges if this is a different problem
            const isDifferentProblem = currentCodingProblem?.id !== messageData.codingProblem.id

            setCurrentCodingProblem(messageData.codingProblem)
            setIsMonitoring(true)

            // Only reset code and badges when switching to a different problem
            if (isDifferentProblem) {
              setCurrentCode('')
              setIsFollowUp(false)
              setIsHint(false)
              setIsClarification(false)
            }

            isSubmittingTimeoutRef.current = false

            // Only show coding_intro transition when coming from non-coding state (e.g., theoretical)
            // For subsequent coding problems, go directly to coding_problem
            const isAlreadyInCodingPhase = currentState === 'coding' || currentState === 'coding_problem' || currentState === 'coding_intro'

            if (isAlreadyInCodingPhase) {
              // Already in coding phase - go directly to coding_problem (no transition screen)
              setCurrentState('coding_problem')
              onStateChange?.('coding_problem')
            } else {
              // First time entering coding phase - show transition intro
              setCurrentState('coding_intro')
              onStateChange?.('coding_intro')
              setTimeout(() => {
                setCurrentState('coding_problem')
                onStateChange?.('coding_problem')
              }, 4000)
            }
          }

          if (messageData.type === 'interview-state-change' && messageData.state) {
            setCurrentState(messageData.state)
            onStateChange?.(messageData.state)
            setIsEvaluating(messageData.state === 'evaluating_answer' || messageData.state === 'evaluating_approach')
          }

          if (messageData.type === 'show_confirmation_modal') {
            setConfirmationModalConfig({
              message: messageData.message || 'Are you sure you want to move to the next question?',
              okText: 'Yes, move on',
              onConfirm: handleConfirmNextQuestion,
              onCancel: handleCancelNextQuestion
            })
            setShowConfirmationModal(true)
          }

          if (messageData.type === 'follow_up') {
            // Clear other badges when follow-up is detected
            setIsHint(false)
            setIsClarification(false)
            setIsFollowUp(true)
          }

          if (messageData.type === 'hint') {
            // Clear other badges when hint is detected
            setIsFollowUp(false)
            setIsClarification(false)
            setIsHint(true)
          }

          if (messageData.type === 'clarification') {
            // Clear other badges when clarification is detected
            setIsFollowUp(false)
            setIsHint(false)
            setIsClarification(true)
          }

          if (messageData.type === 'clear_badges') {
            setIsFollowUp(false)
            setIsHint(false)
            setIsClarification(false)
          }

          // Handle interview completion from agent
          if (messageData.type === 'interview_completed') {
            console.log('🎉 [LiveKit] Interview completed via data channel', messageData)
            saveAndEndInterview(messageData.state, messageData.evaluations)
          }
        } catch (error) {
          console.error('❌ [LiveKit] Failed to parse data channel message:', error)
        }
      }

      const handleActiveSpeakersChanged = (speakers: any[]) => {
        const agentSpeakingInRoom = speakers.some(isAgentParticipant)
        const userSpeakingInRoom = speakers.some(speaker =>
          speaker?.identity && speaker.identity === room.localParticipant?.identity
        )

        // 1. Handle Agent Speaking (Debounced Offset)
        if (agentSpeakingInRoom) {
          // If speaking, clear any pending turn-off timer
          if (agentSpeakingTimeoutRef.current) {
            clearTimeout(agentSpeakingTimeoutRef.current)
            agentSpeakingTimeoutRef.current = null
          }
          setIsSpeaking(true)
          isListeningRef.current = false
          setIsListening(false)
        } else {
          // If silence detected, only turn off after delay if currently indicating active
          if (!agentSpeakingTimeoutRef.current && isSpeaking) {
            agentSpeakingTimeoutRef.current = setTimeout(() => {
              setIsSpeaking(false)
              // Only resume listening if user isn't speaking
              if (!isUserSpeaking) {
                isListeningRef.current = true
                setIsListening(true)
              }
              agentSpeakingTimeoutRef.current = null
            }, 500) // 500ms hysteresis buffer
          }
        }

        // 2. Handle User Speaking (Debounced Offset)
        if (userSpeakingInRoom) {
          if (userSpeakingTimeoutRef.current) {
            clearTimeout(userSpeakingTimeoutRef.current)
            userSpeakingTimeoutRef.current = null
          }
          setIsUserSpeaking(true)
          // Ensure we don't show "listening" while user speaks
          setIsListening(false)
          isListeningRef.current = false

          // IMMEDIATE SYNC: Send current code/notepad when user starts speaking
          // This ensures agent has the latest context before processing user's speech
          const isCodingState = currentState === 'coding_problem' || currentState === 'coding'
          const hasCodeOrNotepad = (currentCodeRef.current && currentCodeRef.current.length > 0) ||
            (currentNotepadRef.current && currentNotepadRef.current.length > 0)
          if (isCodingState && hasCodeOrNotepad && room.localParticipant) {
            const data = new TextEncoder().encode(JSON.stringify({
              type: 'code_snapshot',
              code: currentCodeRef.current || '',
              notepad: currentNotepadRef.current || '',
              timestamp: Date.now(),
              trigger: 'user_speaking'
            }))
            room.localParticipant.publishData(data, { reliable: true })
          }
        } else {
          if (!userSpeakingTimeoutRef.current && isUserSpeaking) {
            userSpeakingTimeoutRef.current = setTimeout(() => {
              setIsUserSpeaking(false)
              // Resume listening if agent isn't speaking
              if (!isSpeaking) {
                isListeningRef.current = true
                setIsListening(true)
              }
              userSpeakingTimeoutRef.current = null
            }, 300) // 300ms buffer
          }
        }
      }

      room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.on(RoomEvent.DataReceived, handleDataReceived)
      room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)

      const fallbackTimeout = setTimeout(() => {
        if (!isListeningRef.current) {
          isListeningRef.current = true
          setIsListening(true)
        }
      }, 3000)

      return () => {
        room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
        room.off(RoomEvent.DataReceived, handleDataReceived)
        room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
        clearTimeout(fallbackTimeout)
      }
    }, [room, livekitRoomName, questions.length])

    return null
  }

  // Cleanup on unmount - disconnect from LiveKit room
  useEffect(() => {
    return () => {
      if (isInterviewStartedRef.current) {
        // no-op
      }
    }
  }, [])

  // Handle security warnings by sending them to the agent via data channel
  const handleSecurityWarning = useCallback((message: string) => {
    if (broadcastDataRef.current) {
      broadcastDataRef.current({
        type: 'security_warning',
        message,
        timestamp: Date.now()
      })
      console.log('📤 [Vision Security] Sent security warning to agent:', message)
    }
  }, [])

  const {

    visionSecurityStatus,
    warningStats,
    warningStatsRef,
    endAllActiveWarnings,
    handleVisionStatusChange
  } = useVoiceInterviewVisionSecurity({
    interviewId,
    hiddenVideoElement,
    currentState,
    isSpeaking,
    isEvaluating,
    isListening,
    currentCodingProblem,
    onWarning: handleSecurityWarning
  })

  // Keep evaluations ref updated
  useEffect(() => {
    evaluationsRef.current = evaluations
  }, [evaluations])
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

        // Token must be provided from /api/interviews/start response
        if (!tokenFromProps || !urlFromProps || !roomNameFromProps) {
          console.error('Missing LiveKit credentials from interview start response')
          return
        }

        // Store token and URL for LiveKitRoom
        // LiveKitRoom expects full URL with wss:// protocol
        let serverUrl = urlFromProps
        // Ensure URL has wss:// protocol
        if (!serverUrl.startsWith('wss://') && !serverUrl.startsWith('ws://')) {
          serverUrl = `wss://${serverUrl.replace(/^(https?):\/\//, '')}`
        } else if (serverUrl.startsWith('https://')) {
          serverUrl = serverUrl.replace('https://', 'wss://')
        } else if (serverUrl.startsWith('http://')) {
          serverUrl = serverUrl.replace('http://', 'ws://')
        }

        setLivekitToken(tokenFromProps)
        setLivekitUrl(serverUrl)
        setLivekitRoomName(roomNameFromProps)
        setHasMicStream(true) // LiveKit handles mic automatically
        isInterviewStartedRef.current = true

        // Note: We no longer start the agent via Electron IPC.
        // The LiveKit Agents process is long-lived and attaches to the room automatically.
        // At this point we've:
        // - Generated questions on the server
        // - Created a LiveKit room + token
        // - Connected this client to the room
        // The agent process will pick up the job when the room is created.
      } catch (error) {
        console.error('Failed to initialize interview:', error)
      }
    }

    initializeInterview()
  }, [interviewId, questions, codingProblems, hasCheckedUnfinished, resumeFromIndex, skipIntro, userChoseResume, unfinishedSession?.questionsAnswered])

  // Save results with retry logic
  const saveResultsWithRetry = useCallback(async (summary: any, retryCount: number) => {
    if (!onSaveResultsRef.current) return

    const maxRetries = 3
    setSaveStatus('saving')
    setSaveRetryCount(retryCount)

    try {
      await onSaveResultsRef.current(summary)
      setSaveStatus('success')
      setSaveRetryCount(0)

      // Show success notification
      window.dispatchEvent(new CustomEvent('dashboard-refresh'))
      localStorage.setItem('dashboard-needs-refresh', Date.now().toString())

      // After success, show feedback modal
      setTimeout(() => {
        setShowFeedbackModal(true)
      }, 1000) // Small delay to show success state

    } catch (error) {
      console.error(`❌ Failed to save interview results (attempt ${retryCount + 1}/${maxRetries}):`, error)

      if (retryCount < maxRetries - 1) {
        // Retry after delay
        setTimeout(() => {
          saveResultsWithRetry(summary, retryCount + 1)
        }, 2000 * (retryCount + 1)) // Exponential backoff: 2s, 4s, 6s
      } else {
        // Max retries reached
        setSaveStatus('error')
        setSaveRetryCount(retryCount + 1)

      }
    }
  }, [])

  // Set up event listeners for final evaluation and completion
  // Note: Question display, speaker states, and interview flow are handled by LiveKit data channels
  // in the LiveKitRoomEventBridge component (lines 96-216)
  useEffect(() => {
    const setupEventListeners = () => {
      // Evaluations - still needed for tracking scores
      window.electronAPI.onEvaluation((evaluation: any) => {
        setEvaluations(prev => {
          const updated = [...prev, evaluation]
          evaluationsRef.current = updated
          return updated
        })
      })

      // NOTE: The following listeners are now handled via LiveKit data channels:
      // - onFinalEvaluationReady -> handled in handleDataReceived 'interview_completed'
      // - onSkipQuestionRequest -> handled in handleDataReceived 'show_confirmation_modal'
      // - onInterviewCompleted -> handled in handleDataReceived 'interview_completed'
      // These IPC events are no longer sent by main process.
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

  // Function to determine if we should send a quit message to the agent
  // We only send it if the USER initiated the end (quit), not if the agent finished it
  const sendUserQuitToAgent = useCallback(async () => {
    if (livekitRoomRef.current && livekitRoomRef.current.localParticipant) {
      try {
        console.log('📤 [VoiceInterview] Sending user_quit to agent...')
        const encoder = new TextEncoder()
        const data = encoder.encode(JSON.stringify({
          type: 'user_quit',
          timestamp: Date.now()
        }))
        await livekitRoomRef.current.localParticipant.publishData(data, { reliable: true })
        console.log('✅ [VoiceInterview] user_quit sent')
        // Give a brief moment for the message to flush
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        console.error('❌ [VoiceInterview] Failed to send user_quit:', error)
      }
    } else {
      console.warn('⚠️ [VoiceInterview] Cannot send user_quit - room/participant not ready')
    }
  }, [])

  // Function to send vision security warnings to backend
  const sendVisionSecurityWarnings = useCallback(async () => {
    try {
      const { default: api } = await import('../services/api')

      // End all active warnings before collecting stats
      endAllActiveWarnings()
      const visionWarnings = warningStatsRef.current

      // Only send if there are warnings to report
      if (visionWarnings && Object.keys(visionWarnings).length > 0) {
        console.log('📤 [VoiceInterview] Sending vision security warnings to backend')

        // Convert stats object to array and ensure type is included
        const suspiciousEvents = Object.entries(visionWarnings).map(([type, stats]: [string, any]) => ({
          type,
          ...stats,
          description: `Detected ${type.replace(/_/g, ' ')}`,
          severity: 'medium' // Default severity
        }))

        const response = await api.put(`/interview/${interviewId}/vision-security`, {
          suspiciousEvents
        })

        if (response.data.success) {
          console.log('✅ [VoiceInterview] Vision warnings sent successfully')
        } else {
          console.error('❌ [VoiceInterview] Vision warnings submission failed:', response.data.error)
        }
      } else {
        console.log('📋 [VoiceInterview] No vision warnings to send')
      }
    } catch (error: any) {
      console.error('❌ [VoiceInterview] Failed to send vision warnings:', error.message)
    }
  }, [interviewId, endAllActiveWarnings])

  const saveAndEndInterview = useCallback(async (stateData?: any, evaluationData?: any, isUserQuit: boolean = false) => {
    if (hasCompletedRef.current) return
    hasCompletedRef.current = true

    console.log('🏁 Ending interview and saving data...')

    // If user quit, notify agent FIRST so it can save history on its side too
    if (isUserQuit) {
      await sendUserQuitToAgent()
    }

    await sendVisionSecurityWarnings()

    // Mark that an interview has been completed in this app session
    sessionStorage.setItem('interviewCompletedInSession', 'true')

    // Update state to completed
    setCurrentState('completed')
    onStateChange?.('completed')

    // Build session object for modals from data
    const agentState = stateData || {}
    const agentEvaluations = evaluationData || []
    const currentEvaluations = evaluationsRef.current

    const sessionObject: InterviewSession = {
      sessionId: interviewId,
      interviewLinkId: interviewLinkId,
      candidateId: agentState.candidateId || 'unknown',
      status: 'completed',
      questions: questions.map((q, idx) => ({
        id: q.id || `q-${idx}`,
        question: q.question || '',
        type: 'technical' as const,
        difficulty: (q as any).difficulty || 'medium',
        timeLimit: 300,
        options: [],
        answeredAt: (q as any).answeredAt,
        correctAnswerId: (q as any).correctAnswerId,
      })),
      answers: (agentEvaluations.length > 0 ? agentEvaluations : currentEvaluations).map((ev: any) => ({
        questionId: ev.questionId || '',
        answer: ev.answer || '',
        answeredAt: new Date(ev.timestamp || Date.now()),
        timeTaken: ev.timeTaken || 0,
        score: ev.score,
        feedback: ev.feedback,
        code: ev.code
      })),
      startTime: new Date(agentState.startTime || Date.now()),
      endTime: new Date(agentState.endTime || Date.now()),
      duration: 0
    }

    // Calculate duration
    if (sessionObject.startTime && sessionObject.endTime) {
      sessionObject.duration = Math.floor((sessionObject.endTime.getTime() - sessionObject.startTime.getTime()) / 1000)
    }

    setSessionForModals(sessionObject)

    // Save results if needed
    if (onSaveResultsRef.current && interviewLinkId) {
      const totalQuestions = questions.length + codingProblems.length
      const allEvaluations = agentEvaluations.length > 0 ? agentEvaluations : currentEvaluations
      const theoreticalScore = allEvaluations.length > 0
        ? allEvaluations.reduce((sum: number, ev: any) => sum + (ev.score || 0), 0) / allEvaluations.length
        : 0

      const summary = {
        sessionId: interviewId,
        interviewLinkId: interviewLinkId,
        candidateId: agentState.candidateId || 'unknown',
        candidateName: resumeData?.name || user?.fullName || 'Unknown',
        candidateEmail: user?.email || resumeData?.email || 'unknown@example.com',
        candidatePhone: resumeData?.phone || '',
        completedAt: new Date().toISOString(),
        startTime: agentState.startTime || new Date().toISOString(),
        endTime: agentState.endTime || new Date().toISOString(),
        duration: sessionObject.duration,
        score: Math.round(theoreticalScore),
        totalQuestions: totalQuestions,
        correctAnswers: allEvaluations.filter((ev: any) => ev.score >= 70).length,
        timeSpent: sessionObject.duration,
        strengths: theoreticalScore >= 80 ? ['Excellent technical knowledge'] : ['Good understanding'],
        areasForImprovement: theoreticalScore < 60 ? ['Review fundamentals'] : ['Continue practicing'],
        overallFeedback: `Interview completed with ${Math.round(theoreticalScore)}% average score.`,
        detailedAnswers: allEvaluations.map((ev: any) => ({
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
          correctByDifficulty: { easy: 0, medium: 0, hard: 0 }
        }
      }

      saveSummaryRef.current = summary
      await saveResultsWithRetry(summary, 0)
    } else {
      // No save needed, go directly to feedback
      setShowFeedbackModal(true)
    }
  }, [interviewId, interviewLinkId, questions, codingProblems, resumeData, user, saveResultsWithRetry, sendUserQuitToAgent, sendVisionSecurityWarnings])

  // Handle end call
  const handleEndCall = useCallback(async () => {
    // Use ConfirmationModal instead of window.confirm
    setConfirmationModalConfig({
      message: 'Are you sure you want to quit the interview? All progress will be saved.',
      okText: 'Quit Interview',
      okButtonProps: { danger: true },
      onConfirm: async () => {
        try {
          console.log('🛑 User initiated interview end')
          setShowConfirmationModal(false)

          // Save data FIRST before disconnecting
          // Pass empty state/evals so it uses current refs
          // Pass true for isUserQuit to trigger agent notification
          await saveAndEndInterview({}, [], true)

          // Disconnect from LiveKit room
          if (livekitRoomRef.current) {
            await livekitRoomRef.current.disconnect()
            livekitRoomRef.current = null
          }

          // Clear any unfinished interview data
          await window.electronAPI?.clearUnfinishedInterview?.()

          // Call the onComplete callback to end the interview (navigation)
          onComplete?.({ userEnded: true })
        } catch (error) {
          console.error('Error ending interview:', error)
          // Still call onComplete even if cleanup fails
          onComplete?.({ userEnded: true })
        }
      },
      onCancel: () => setShowConfirmationModal(false)
    })
    setShowConfirmationModal(true)
  }, [onComplete, saveAndEndInterview])

  const handleCodeChange = useCallback((code: string) => {
    // Track current code for timer expiration
    console.log(`💻 [VoiceInterview] handleCodeChange called: ${code.length} chars, currentState=${currentState}`)
    setCurrentCode(code)
  }, [currentState])

  const handleAnalysisRequest = useCallback(async (code: string, problemId: string) => {
    try {
      // 1. Broadcast to LiveKit Agent (DSA Persona) for real-time context
      if (broadcastDataRef.current) {
        broadcastDataRef.current({
          type: 'code_snapshot',
          code: code,
          problemId: problemId,
          complexity: {
            time: currentComplexity.time,
            space: currentComplexity.space
          },
          timestamp: Date.now()
        })
      }

      // 2. Call local analysis (optional/legacy)
      const result = await window.electronAPI.analyzeCode({
        code,
        problemId,
        timestamp: Date.now()
      })

      if (result.success) {
        // no-op
      }
    } catch (error) {
      console.error('Code analysis failed:', error)
    }
  }, [])

  const handleConfirmSubmit = useCallback(async () => {
    setShowConfirmationModal(false)

    const submission = pendingSubmissionRef.current
    if (!submission) {
      console.warn('⚠️ [Interview] No pending submission found')
      return
    }

    const { code, timeComplexity, spaceComplexity } = submission
    pendingSubmissionRef.current = null

    console.log('📤 [Interview] Submitting via Direct Data Channel (bypassing main process)')

    if (broadcastDataRef.current) {
      // 1. Send final code snapshot
      broadcastDataRef.current({
        type: 'code_snapshot',
        code: code,
        complexity: {
          time: timeComplexity,
          space: spaceComplexity
        },
        timestamp: Date.now()
      })

      // 2. Broadcast confirm_next_question to Agent so it moves on
      // We include complexity stats just in case the agent wants to store them in future
      broadcastDataRef.current({
        type: 'confirm_next_question',
        metadata: {
          forced: true,
          submission: true,
          complexity: { time: timeComplexity, space: spaceComplexity }
        }
      })

      // Clear local code immediately
      setCurrentCode('')
    } else {
      console.error('❌ [Interview] Cannot submit - broadcastDataRef is null')
    }
  }, [])

  const handleCancelSubmit = useCallback(() => {
    setShowConfirmationModal(false)
    pendingSubmissionRef.current = null
  }, [])

  const handleSubmit = useCallback(async (code: string, timeComplexity?: string, spaceComplexity?: string, skipConfirmation = false) => {
    // If skipConfirmation is true (timer expiration), submit directly without modal
    if (skipConfirmation) {
      console.log('⏰ [Interview] Timer expired - submitting via Data Channel')

      if (broadcastDataRef.current) {
        // 1. Send code snapshot
        broadcastDataRef.current({
          type: 'code_snapshot',
          code: code,
          complexity: {
            time: timeComplexity,
            space: spaceComplexity
          },
          timestamp: Date.now()
        })

        // 2. Force next question (Timeout)
        broadcastDataRef.current({
          type: 'confirm_next_question',
          metadata: {
            forced: true,
            timeout: true
          }
        })

        setCurrentCode('')
      }
      return
    }

    // For manual submissions, show confirmation modal
    const submissionData = { code, timeComplexity, spaceComplexity }
    pendingSubmissionRef.current = submissionData
    setConfirmationModalConfig({
      message: 'Are you sure you want to submit your solution and move to the next question?',
      okText: 'Submit solution',
      onConfirm: handleConfirmSubmit,
      onCancel: handleCancelSubmit
    })
    setShowConfirmationModal(true)
  }, [currentCodingProblem, complexityNotes, handleConfirmSubmit, handleCancelSubmit])

  const handleTimerExpire = useCallback(async () => {
    if (!currentCodingProblem) return

    // Prevent multiple simultaneous submissions
    if (isSubmittingTimeoutRef.current) {
      return
    }

    isSubmittingTimeoutRef.current = true

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
            onNotepadChange={(notepad) => {
              setCurrentNotepad(notepad)
              currentNotepadRef.current = notepad
            }}
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
              question={currentQuestion}
              followUpQuestionText={followUpQuestionText}
              introMessage={currentState === 'intro' ? "I'm ready when you are. Just say hello to begin." : null}
              introMeta={currentState === 'intro' ? "Waiting for you to start..." : undefined}
              isListening={isListening}
              isSpeaking={isSpeaking}
              isUserSpeaking={isUserSpeaking}
              progress={progress}
              onVisionStatusChange={handleVisionStatusChange}
              isHint={isHint}
              isClarification={isClarification}
              isFollowUp={isFollowUp}
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
              isUserSpeaking={isUserSpeaking}
              progress={progress}
              onVisionStatusChange={handleVisionStatusChange}
              isHint={isHint}
              isClarification={isClarification}
              isFollowUp={isFollowUp}
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
                  {saveStatus === 'saving' ? (
                    <div style={{
                      width: 24,
                      height: 24,
                      border: '3px solid rgba(76, 175, 80, 0.3)',
                      borderTopColor: '#4caf50',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                  ) : saveStatus === 'success' ? (
                    <span>✓</span>
                  ) : saveStatus === 'error' ? (
                    <span style={{ color: '#ff4d4f', fontSize: '32px' }}>⚠</span>
                  ) : (
                    <span>✓</span>
                  )}
                </div>
              </div>
              <h2 className="loading-title">Interview Complete</h2>
              <p className="loading-subtitle">
                {saveStatus === 'saving'
                  ? `Saving your results${saveRetryCount > 0 ? ` (retry ${saveRetryCount + 1}/3)...` : '...'}`
                  : saveStatus === 'success'
                    ? 'Your results have been saved successfully!'
                    : saveStatus === 'error'
                      ? `Failed to save results after ${saveRetryCount} attempts. Your feedback is still important!`
                      : 'Thanks for the great conversation. We\'ll review everything and update you shortly.'}
              </p>
              {saveStatus === 'error' && saveSummaryRef.current && (
                <button
                  onClick={() => saveResultsWithRetry(saveSummaryRef.current, 0)}
                  style={{
                    marginTop: '16px',
                    padding: '8px 16px',
                    background: 'rgba(9, 88, 217, 0.1)',
                    border: '1px solid rgba(9, 88, 217, 0.3)',
                    borderRadius: '6px',
                    color: '#0958d9',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                  }}
                >
                  Retry Saving
                </button>
              )}
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
    setShowResumeModal(false)
    setHasCheckedUnfinished(true)
    setUserChoseResume(true)
    // Continue with existing session
  }

  // Handle restart fresh interview
  const handleStartFreshInterview = async () => {
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
    setShowResumeModal(false)
    setUnfinishedSession(null)
    setHasCheckedUnfinished(true)
    // Call onComplete to allow parent to handle navigation
    onComplete?.({ cancelled: true })
  }, [onComplete])

  const handleConfirmSkip = useCallback(async () => {
    setShowConfirmationModal(false)
    await window.electronAPI.confirmSkipQuestion(true)
  }, [])

  const handleCancelSkip = useCallback(async () => {
    setShowConfirmationModal(false)
    await window.electronAPI.confirmSkipQuestion(false)
  }, [])

  // Handle feedback modal complete - call onComplete
  const handleFeedbackComplete = useCallback(() => {
    setShowFeedbackModal(false)
    onCompleteRef.current?.({})
  }, [])

  // Handle feedback modal skip - call onComplete
  const handleFeedbackSkip = useCallback(() => {
    setShowFeedbackModal(false)
    onCompleteRef.current?.({})
  }, [])


  // Wrap with LiveKitRoom if token is available
  const content = (
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

      {/* Feedback Modal */}
      {showFeedbackModal && sessionForModals && (
        <InterviewFeedback
          visible={showFeedbackModal}
          session={sessionForModals}
          onComplete={handleFeedbackComplete}
          onSkip={handleFeedbackSkip}
        />
      )}

      <div
        className="voice-interview-session"
      >
        <div className="interview-content">
          {renderCurrentSection()}
        </div>

        {/* Vision Security Alerts - Display warnings for suspicious events */}
        <VisionSecurityAlert
          status={visionSecurityStatus}
          warningStats={warningStats}
          onDismiss={() => {
          }}
        />

        {/* Hidden video capture for security tracking during coding section and throughout interview */}
        <div className="hidden-video-tracker">
          <VideoCapture
            onStreamReady={() => {
            }}
            onVideoElementReady={(videoEl) => {
              setHiddenVideoElement(videoEl)
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
            isMuted={isMicMuted}
          />
        </div>

        {/* Call Controls - Bottom Center - Only show during active interview */}
        {currentState !== 'connecting' && currentState !== 'completed' && (
          <div className="call-controls">
            <button
              className={`control-btn mic-btn ${isMicMuted ? 'muted' : ''}`}
              onClick={handleMicToggle}
              data-tooltip={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMicMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
            </button>

            <button
              className="control-btn end-call-btn"
              onClick={handleEndCall}
              data-tooltip="End interview"
            >
              <PhoneOutlined />
            </button>
          </div>
        )}

        <style>{`
        /* Hide scrollbars globally for interview screens */
        body, html {
          overflow: hidden !important;
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE and Edge */
        }

        body::-webkit-scrollbar,
        html::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }

        .voice-interview-session {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: #1a1a1a;
          color: #ffffff;
          overflow: hidden;
          margin: 0;
          padding: 0;
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE and Edge */
        }

        .voice-interview-session::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
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
          padding: 80px 0px 80px 0px;
          max-width: 1400px;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
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
          bottom: 8px;
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

        /* Call Controls - Bottom Center */
        .call-controls {
          position: fixed;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 16px;
          z-index: 1000;
          align-items: center;
        }

        .control-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .control-btn svg {
          width: 20px;
          height: 20px;
        }

        .control-btn .anticon {
          font-size: 24px;
        }

        .mic-btn {
          background: rgba(45, 45, 48, 0.95);
          color: #ffffff;
          backdrop-filter: blur(10px);
        }

        .mic-btn:hover {
          background: rgba(60, 60, 65, 0.95);
        }

        .mic-btn.muted {
          background: rgba(197, 36, 36, 0.95);
          color: #ffffff;
        }

        .mic-btn.muted:hover {
          background: rgba(185, 28, 28, 0.95);
        }

        .end-call-btn {
          background: rgba(197, 36, 36, 0.95);
          color: #ffffff;
        }

        .end-call-btn:hover {
          background: rgba(185, 28, 28, 0.95);
        }

        .end-call-btn .anticon {
          transform: rotate(225deg);
        }

        /* Tooltip styling for call control buttons */
        .control-btn[data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 4px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.85);
          color: white;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          border: none;
        }

        .control-btn[data-tooltip]:hover::before {
          content: '';
          position: absolute;
          bottom: calc(100% + 2px);
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: rgba(0, 0, 0, 0.85);
          pointer-events: none;
        }

        /* Hide default browser tooltip */
        .control-btn {
          position: relative;
        }
      `}</style>
      </div>

      {/* LiveKit Audio Renderer - handles AI voice playback */}
      {livekitToken && livekitUrl && (
        <RoomAudioRenderer />
      )}
    </>
  )

  // Wrap with LiveKitRoom if we have a token
  if (livekitToken && livekitUrl && livekitRoomName) {
    // Ensure serverUrl has proper wss:// protocol
    let serverUrl = livekitUrl
    if (!serverUrl.startsWith('wss://') && !serverUrl.startsWith('ws://')) {
      serverUrl = `wss://${serverUrl.replace(/^(https?):\/\//, '')}`
    } else if (serverUrl.startsWith('https://')) {
      serverUrl = serverUrl.replace('https://', 'wss://')
    }

    return (
      <LiveKitRoom
        video={false}
        audio={true}
        connect={true}
        token={livekitToken}
        serverUrl={serverUrl}
        options={{
          adaptiveStream: true,
          dynacast: true,
        }}
        onDisconnected={() => {
          setIsListening(false)
        }}
        onError={(error) => {
          console.error('🎤 [LiveKit] Error:', error)
          // Log more details about the error
          if (error instanceof Error) {
            console.error('🎤 [LiveKit] Error message:', error.message)
            console.error('🎤 [LiveKit] Error stack:', error.stack)
          }
        }}
      >
        <LiveKitRoomEventBridge />
        {content}
      </LiveKitRoom>
    )
  }

  // Fallback: render without LiveKit if token not available yet
  return content
}

export default VoiceInterviewSession


