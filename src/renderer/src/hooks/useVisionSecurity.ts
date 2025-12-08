import { useEffect, useRef, useState, useCallback } from 'react'
import { VisionSecurityService } from '../services/visionSecurityService'
import type { VisionSecurityStatus } from '../../../shared/types'

interface UseVisionSecurityOptions {
  videoElement: HTMLVideoElement | null
  enabled?: boolean
  onSecurityAlert?: (status: VisionSecurityStatus) => void
  isSpeaking?: boolean
  isEvaluating?: boolean
  isListening?: boolean
}

const WARNING_MESSAGES: Record<string, string[]> = {
  gaze_away: [
    "Please maintain focus on the screen",
    "I notice you're looking away. Let's stay focused on the interview",
    "Your attention seems to be drifting. Please focus on the questions"
  ],
  face_absent: [
    "Please ensure your face is visible to the camera",
    "I can't see you clearly. Please position yourself in front of the camera",
    "Your face is not visible. Please adjust your camera"
  ],
  mobile_device_usage: [
    "Please put away your mobile device and focus on the interview",
    "I notice you may be using a mobile device. Please focus on the interview",
    "Let's keep our attention on the interview. Please avoid using other devices"
  ],
  multiple_faces: [
    "Multiple faces detected. Please ensure you are alone during the interview",
    "I see multiple people. This should be a solo interview",
    "Please ensure only you are visible during the interview"
  ]
}

export const useVisionSecurity = ({
  videoElement,
  enabled = true,
  onSecurityAlert,
  isSpeaking = false,
  isEvaluating = false,
  isListening = false
}: UseVisionSecurityOptions) => {
  const [status, setStatus] = useState<VisionSecurityStatus | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warningStats, setWarningStats] = useState<any>({})
  
  const serviceRef = useRef<VisionSecurityService | null>(null)
  const screenshotFilepathRef = useRef<string | null>(null) // Store filepath to survive service cleanup
  const animationFrameRef = useRef<number | null>(null)
  const lastEmitTime = useRef<number>(0)
  const warningOccurrenceCountRef = useRef<Record<string, number>>({})
  const lastSpokenOccurrenceRef = useRef<Record<string, number>>({})
  const isWarningTTSActiveRef = useRef<boolean>(false)
  const pushedOccurrencesRef = useRef<Record<string, Set<number>>>({}) // Track which occurrences we've queued
  const incrementedWarningsRef = useRef<Record<string, Set<string>>>({}) // Track which warning instances we've incremented (by key: type-startTime)
  const evaluationEndTimeRef = useRef<number>(0) // Track when evaluation ended to add grace period
  const prevIsEvaluatingRef = useRef<boolean>(false) // Track previous evaluation state
  
  // Single latest warning queue: only store the most recent warning across all types
  interface QueuedWarning {
    type: string
    message: string
    occurrenceCount: number
    timestamp: number
    startTime: number // Store startTime to check if warning is still active
  }
  const latestQueuedWarningRef = useRef<QueuedWarning | null>(null)
  
  const EMIT_INTERVAL = 1000 // Emit security data every 1 second
  const EVALUATION_END_GRACE_PERIOD_MS = 1000 // Wait 1s after evaluation ends before processing warnings (gives time for evaluation TTS to start)

  // Initialize service
  useEffect(() => {
    if (!enabled) {
      setIsInitialized(false)
      return
    }

    let isMounted = true

    const initService = async () => {
      try {
        const service = new VisionSecurityService((warning) => {
          console.log(`📊 Warning completed: ${warning.type} - ${Math.round(warning.duration / 1000)}s`)
          
          // Only increment occurrence count if warning duration exceeded threshold
          // This prevents short warnings from affecting the count
          const thresholds = {
            gaze_away: 3000,
            face_absent: 5000,
            mobile_device_usage: 3000,
            multiple_faces: 0
          }
          const threshold = thresholds[warning.type] || 0
          
          // Only increment if warning was significant (above threshold)
          if (warning.duration >= threshold) {
            // Check if we've already incremented for this warning instance (when it exceeded threshold)
            const warningKey = `${warning.type}-${warning.startTime}`
            if (!incrementedWarningsRef.current[warning.type]) {
              incrementedWarningsRef.current[warning.type] = new Set()
            }
            
            // Only increment if we haven't already incremented for this instance
            if (!incrementedWarningsRef.current[warning.type].has(warningKey)) {
              const currentCount = warningOccurrenceCountRef.current[warning.type] || 0
              warningOccurrenceCountRef.current[warning.type] = currentCount + 1
              incrementedWarningsRef.current[warning.type].add(warningKey)
              console.log(`📊 [WARNING COMPLETE] Incremented occurrence count for ${warning.type} to ${currentCount + 1}`)
            } else {
              console.log(`📊 [WARNING COMPLETE] Already incremented for ${warning.type} instance ${warningKey}, skipping`)
            }
          } else {
            console.log(`⏭️ [WARNING COMPLETE] Skipping occurrence increment for ${warning.type} - duration ${warning.duration}ms < threshold ${threshold}ms`)
          }
          
          // Update warning stats when a warning completes
          if (serviceRef.current) {
            setWarningStats(serviceRef.current.getWarningStats())
          }
        })
        await service.initialize()
        
        // Only set state if component is still mounted
        if (isMounted) {
          serviceRef.current = service
          setIsInitialized(true)
          setError(null)
        } else {
          // Cleanup if component unmounted during initialization
          service.cleanup()
        }
      } catch (err: any) {
        console.error('Failed to initialize vision security:', err)
        // Don't throw - just log and continue without vision security
        // Video should still work even if vision security fails
        if (isMounted) {
          setError(err.message || 'Failed to initialize vision security')
          setIsInitialized(false)
        }
      }
    }

    initService()

    return () => {
      isMounted = false
      if (serviceRef.current) {
        serviceRef.current.cleanup()
        serviceRef.current = null
      }
      setIsInitialized(false)
    }
  }, [enabled])

  // Track evaluation state changes to detect when evaluation ends
  useEffect(() => {
    // Detect when evaluation transitions from true to false
    if (prevIsEvaluatingRef.current && !isEvaluating) {
      // Evaluation just ended - record the time
      evaluationEndTimeRef.current = Date.now()
      console.log('🔊 [Warning TTS] Evaluation ended, starting grace period')
    }
    prevIsEvaluatingRef.current = isEvaluating
  }, [isEvaluating])

  // Reset grace period when TTS starts (evaluation TTS has begun)
  useEffect(() => {
    if (isSpeaking && evaluationEndTimeRef.current > 0) {
      // TTS has started, clear the grace period
      evaluationEndTimeRef.current = 0
      console.log('🔊 [Warning TTS] TTS started, grace period cleared')
    }
  }, [isSpeaking])

  // Process queued warning: speak it only if still active
  const processQueuedWarning = useCallback(() => {
    // Check if we're in the grace period after evaluation ended
    const timeSinceEvaluationEnd = Date.now() - evaluationEndTimeRef.current
    const inGracePeriod = evaluationEndTimeRef.current > 0 && timeSinceEvaluationEnd < EVALUATION_END_GRACE_PERIOD_MS
    
    // Only speak warnings when AI is not speaking, not evaluating, not in grace period, and actively listening for candidate input
    if (isSpeaking || isEvaluating || inGracePeriod || !isListening || isWarningTTSActiveRef.current) {
      if (inGracePeriod) {
        console.log(`🔊 [Warning TTS] Waiting for grace period to end (${EVALUATION_END_GRACE_PERIOD_MS - timeSinceEvaluationEnd}ms remaining)`)
      }
      return // Can't speak now - must be listening for candidate to speak warnings
    }

    // Get the latest queued warning
    const queuedWarning = latestQueuedWarningRef.current
    
    if (!queuedWarning) {
      return // No warning queued
    }
    
    // Store values before clearing
    const warningType = queuedWarning.type
    const warningMessage = queuedWarning.message
    const warningOccurrenceCount = queuedWarning.occurrenceCount
    const warningStartTime = queuedWarning.startTime
    
    // Clear the queued warning (we're processing it now)
    latestQueuedWarningRef.current = null
    
    // Check if the warning is still active before speaking
    const isStillActive = serviceRef.current?.isWarningStillActive(warningType, warningStartTime) ?? false
    
    if (!isStillActive) {
      console.log(`🔊 [Warning TTS] Queued warning for ${warningType} is no longer active, skipping TTS`)
      return
    }
    
    // Update last spoken occurrence
    lastSpokenOccurrenceRef.current[warningType] = warningOccurrenceCount
    
    // Clear the pushed occurrence tracking for this occurrence (we've spoken it)
    if (pushedOccurrencesRef.current[warningType]) {
      pushedOccurrencesRef.current[warningType].delete(warningOccurrenceCount)
    }
    
    // Mark TTS as active
    isWarningTTSActiveRef.current = true
    
    console.log(`🔊 [QUEUE→TTS] Speaking queued warning for ${warningType} (occurrence ${warningOccurrenceCount})`)
    
    if (window.electronAPI?.speakSecurityWarning) {
      window.electronAPI.speakSecurityWarning(warningMessage)
      
      // Reset after TTS completes
      setTimeout(() => {
        isWarningTTSActiveRef.current = false
      }, 3000) // 3s to account for TTS duration
    } else {
      isWarningTTSActiveRef.current = false
    }
  }, [isSpeaking, isEvaluating, isListening])

  // Process frames
  useEffect(() => {
    if (!enabled || !isInitialized || !videoElement || !serviceRef.current) {
      return
    }

    const processFrame = async () => {
      try {
        const securityStatus = await serviceRef.current!.processFrame(videoElement)
        
        if (securityStatus) {
          setStatus(securityStatus)

          // Update warning stats periodically
          const now = Date.now()
          if (now - lastEmitTime.current >= EMIT_INTERVAL) {
            lastEmitTime.current = now
            
            // Update warning stats periodically
            if (serviceRef.current) {
              setWarningStats(serviceRef.current.getWarningStats())
              
              // Cache screenshot filepath periodically so it survives service cleanup
              const filepath = serviceRef.current.getScreenshotFilepath()
              if (filepath && filepath !== screenshotFilepathRef.current) {
                screenshotFilepathRef.current = filepath
                console.log(`📸 [Hook] Cached screenshot filepath: ${filepath}`)
              }
            }

            // Check active warnings and add to stack when threshold exceeded
            if (serviceRef.current) {
              const activeWarnings = serviceRef.current.getActiveWarnings()
              const now = Date.now()
              const thresholds = {
                gaze_away: 3000,
                face_absent: 5000,
                mobile_device_usage: 3000,
                multiple_faces: 0
              }
              
              // Process each active warning
              activeWarnings.forEach((warning) => {
                const duration = now - warning.startTime
                const threshold = thresholds[warning.type] || 0
                
                // Skip warnings below threshold
                if (duration < threshold) {
                  return
                }
                
                // Validate warning is still active
                if (serviceRef.current && !serviceRef.current.isWarningStillActive(warning.type, warning.startTime)) {
                  return
                }
                
                // Track warning instance by key
                const warningKey = `${warning.type}-${warning.startTime}`
                
                // Initialize tracking sets if needed
                if (!incrementedWarningsRef.current[warning.type]) {
                  incrementedWarningsRef.current[warning.type] = new Set()
                }
                
                // Increment occurrence count if this warning exceeded threshold and we haven't incremented for this instance yet
                // This handles cases where warnings are discarded before completion
                if (!incrementedWarningsRef.current[warning.type].has(warningKey)) {
                  const currentCount = warningOccurrenceCountRef.current[warning.type] || 0
                  warningOccurrenceCountRef.current[warning.type] = currentCount + 1
                  incrementedWarningsRef.current[warning.type].add(warningKey)
                  console.log(`📊 [THRESHOLD] Incremented occurrence count for ${warning.type} to ${currentCount + 1} (warning exceeded threshold)`)
                }
                
                // Get current occurrence count
                const occurrenceCount = warningOccurrenceCountRef.current[warning.type] || 0
                const lastSpoken = lastSpokenOccurrenceRef.current[warning.type] || 0
                
                // Only speak on every 3rd occurrence (1st, 4th, 7th, etc.)
                // AND only if we haven't already spoken for this occurrence count
                const shouldSpeak = occurrenceCount % 3 === 1 && occurrenceCount > lastSpoken
                
                if (shouldSpeak) {
                  // Check if we've already queued this occurrence (prevent duplicates)
                  if (!pushedOccurrencesRef.current[warning.type]) {
                    pushedOccurrencesRef.current[warning.type] = new Set()
                  }
                  
                  if (pushedOccurrencesRef.current[warning.type].has(occurrenceCount)) {
                    // Already queued this occurrence, skip
                    return
                  }
                  
                  const messages = WARNING_MESSAGES[warning.type] || []
                  const message = messages[Math.floor(Math.random() * messages.length)] || `Security alert: ${warning.type}`
                  
                  // Mark this occurrence as queued
                  pushedOccurrencesRef.current[warning.type].add(occurrenceCount)
                  
                  // Update latest queued warning if this one is newer (or if no warning is queued)
                  if (!latestQueuedWarningRef.current || now > latestQueuedWarningRef.current.timestamp) {
                    latestQueuedWarningRef.current = {
                      type: warning.type,
                      message,
                      occurrenceCount,
                      timestamp: now,
                      startTime: warning.startTime
                    }
                    console.log(`📥 [QUEUE] Queued warning for ${warning.type} (occurrence ${occurrenceCount})`)
                  } else {
                    console.log(`📥 [QUEUE] Skipping warning for ${warning.type} (occurrence ${occurrenceCount}) - newer warning already queued`)
                  }
                }
              })
              
              // Also try to process queued warning in case TTS just became available
              processQueuedWarning()
              
              // Trigger alert callback for UI updates
              if (onSecurityAlert && activeWarnings.some(w => {
                const duration = now - w.startTime
                return duration >= (thresholds[w.type] || 0)
              })) {
                onSecurityAlert(securityStatus)
              }
            }
            
            // Note: Removed continuous sendVisionSecurityData to main process
            // This was causing IPC spam and blocking audio chunks
            // TTS is now triggered via speakSecurityWarning when alerts fire
            // Logging stays in renderer and is sent to backend at interview end
          }
        }
      } catch (err) {
        console.error('Error processing vision frame:', err)
      }

      // Continue processing
      animationFrameRef.current = requestAnimationFrame(processFrame)
    }

    animationFrameRef.current = requestAnimationFrame(processFrame)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      
      // Clear any queued warning
      latestQueuedWarningRef.current = null
    }
  }, [enabled, isInitialized, videoElement, onSecurityAlert, isSpeaking, isEvaluating, isListening, processQueuedWarning])

  const getStatus = useCallback((): VisionSecurityStatus | null => {
    return status
  }, [status])

  const endAllActiveWarnings = useCallback(() => {
    if (serviceRef.current) {
      // endAllActiveWarnings() returns the stats directly - use that return value!
      // Don't call getWarningStats() afterwards because endAllActiveWarnings() may clear the data
      const stats = serviceRef.current.endAllActiveWarnings()
      console.log('[Hook] endAllActiveWarnings returned stats:', JSON.stringify(stats, null, 2))
      setWarningStats(stats)
      return stats
    }
    return {}
  }, [])
  
  const getWarningStats = useCallback(() => {
    if (serviceRef.current) {
      return serviceRef.current.getWarningStats()
    }
    return {}
  }, [])
  
  const getActiveWarnings = useCallback(() => {
    if (serviceRef.current) {
      return serviceRef.current.getActiveWarnings()
    }
    return []
  }, [])

  const isWarningStillActive = useCallback((type: string, startTime: number) => {
    if (serviceRef.current) {
      return serviceRef.current.isWarningStillActive(type, startTime)
    }
    return false
  }, [])

  const getScreenshotFilepath = useCallback(() => {
    // Try to get from service first, if available
    if (serviceRef.current) {
      const filepath = serviceRef.current.getScreenshotFilepath()
      if (filepath) {
        screenshotFilepathRef.current = filepath // Cache it
        return filepath
      }
    }
    // If service is gone, return cached filepath
    console.log(`📸 [Hook] Returning cached screenshot filepath: ${screenshotFilepathRef.current}`)
    return screenshotFilepathRef.current
  }, [])

  return {
    status,
    isInitialized,
    error,
    warningStats,
    getStatus,
    endAllActiveWarnings,
    getWarningStats,
    getActiveWarnings,
    isWarningStillActive,
    getScreenshotFilepath
  }
}

