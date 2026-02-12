import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisionSecurity } from '../hooks/useVisionSecurity'
import api from '../services/api'

type VisionSecurityArgs = {
  interviewId?: string
  hiddenVideoElement: HTMLVideoElement | null
  currentState: string
  isSpeaking: boolean
  isEvaluating: boolean
  isListening: boolean
  currentCodingProblem: unknown | null
  onWarning?: (message: string) => void
}

export const useVoiceInterviewVisionSecurity = ({
  interviewId,
  hiddenVideoElement,
  currentState,
  isSpeaking,
  isEvaluating,
  isListening,
  currentCodingProblem,
  onWarning
}: VisionSecurityArgs) => {
  const [visionSecurityStatus, setVisionSecurityStatus] = useState<any>(null)

  // Initialize vision security tracking that stays active throughout the interview
  // This works even when video windows are hidden (like in coding section)
  // Keep it enabled through 'wrap_up' so we can end and persist all active warnings at final evaluation time
  const { status: hiddenVisionStatus, warningStats, endAllActiveWarnings } = useVisionSecurity({
    videoElement: hiddenVideoElement,
    enabled: hiddenVideoElement !== null && currentState !== 'connecting',
    isSpeaking,
    isEvaluating,
    isListening,
    isCodingSection: !!currentCodingProblem,
    onSecurityAlert: (status) => {
      // Just update UI status - TTS is handled in useVisionSecurity hook via onWarning
      setVisionSecurityStatus(status)
    },
    onWarning
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
    const stats = warningStats
    console.log('📊 [sendVisionSecurityToServer] Called with warningStats:', JSON.stringify(stats, null, 2))
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
      // Convert warning stats to events array format for API
      const eventsArray = Object.entries(stats).flatMap(([type, data]: [string, any]) =>
        data.events.map((event: any) => ({
          type,
          severity:
            type === 'multiple_faces' || type === 'face_absent' || type === 'mobile_device_usage'
              ? 'high'
              : 'medium',
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

      const response = await api.put(`/interview/${interviewId}/vision-security`, {
        suspiciousEvents: eventsArray
      })

      if (!response.data.success) {
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

  return {
    visionSecurityStatus,
    warningStats,
    warningStatsRef,
    endAllActiveWarnings,
    sendVisionSecurityToServer,
    handleVisionStatusChange
  }
}

