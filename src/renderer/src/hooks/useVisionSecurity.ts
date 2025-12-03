import { useEffect, useRef, useState, useCallback } from 'react'
import { VisionSecurityService } from '../services/visionSecurityService'
import type { VisionSecurityStatus } from '../../../shared/types'

interface UseVisionSecurityOptions {
  videoElement: HTMLVideoElement | null
  enabled?: boolean
  onSecurityAlert?: (status: VisionSecurityStatus) => void
  isSpeaking?: boolean
  isEvaluating?: boolean
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
  isEvaluating = false
}: UseVisionSecurityOptions) => {
  const [status, setStatus] = useState<VisionSecurityStatus | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warningStats, setWarningStats] = useState<any>({})
  
  const serviceRef = useRef<VisionSecurityService | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastEmitTime = useRef<number>(0)
  const spokenWarningsRef = useRef<Set<string>>(new Set())
  const warningOccurrenceCountRef = useRef<Record<string, number>>({})
  const lastSpokenOccurrenceRef = useRef<Record<string, number>>({})
  const pendingWarningRef = useRef<{ type: string; message: string } | null>(null)
  const isWarningTTSActiveRef = useRef<boolean>(false)
  const activeTTSRequestsRef = useRef<Set<string>>(new Set()) // Track in-flight TTS requests
  const lastIncrementingWarningKeyRef = useRef<Record<string, string>>({}) // Track last warning key that caused increment per type
  const lastIncrementTimeRef = useRef<Record<string, number>>({}) // Track when we last incremented per type
  const EMIT_INTERVAL = 1000 // Emit security data every 1 second
  const MIN_INCREMENT_INTERVAL = 2000 // Minimum time between increments for same warning type (2 seconds)

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
            }

            // Check active warnings and trigger TTS when threshold exceeded
            if (serviceRef.current) {
              const activeWarnings = serviceRef.current.getActiveWarnings()
              const now = Date.now()
              const thresholds = {
                gaze_away: 3000,
                face_absent: 5000,
                mobile_device_usage: 3000,
                multiple_faces: 0
              }
              
              // Check if we can speak pending warning now
              if (pendingWarningRef.current && !isSpeaking && !isEvaluating && !isWarningTTSActiveRef.current) {
                const pending = pendingWarningRef.current
                console.log(`🔍 [PENDING CHECK] Processing pending: ${pending.type}, isSpeaking=${isSpeaking}, isEvaluating=${isEvaluating}, isWarningTTSActive=${isWarningTTSActiveRef.current}`)
                pendingWarningRef.current = null // Clear immediately to prevent re-processing
                
                const occurrenceCount = warningOccurrenceCountRef.current[pending.type] || 0
                const lastSpoken = lastSpokenOccurrenceRef.current[pending.type] || 0
                
                console.log(`🔍 [PENDING CHECK] ${pending.type}: occurrenceCount=${occurrenceCount}, lastSpoken=${lastSpoken}`)
                
                // Only speak if we haven't spoken for this occurrence count yet
                if (occurrenceCount > lastSpoken) {
                  // Create unique request ID for deduplication
                  const requestId = `${pending.type}-${occurrenceCount}`
                  
                  console.log(`🔍 [PENDING CHECK] Checking requestId: ${requestId}, inFlight: ${activeTTSRequestsRef.current.has(requestId)}, activeTTS: [${Array.from(activeTTSRequestsRef.current).join(', ')}]`)
                  
                  // Check if this exact request is already in flight
                  if (activeTTSRequestsRef.current.has(requestId)) {
                    console.log(`🔇 [PENDING CHECK] Request ${requestId} already in flight, skipping`)
                    return
                  }
                  
                  lastSpokenOccurrenceRef.current[pending.type] = occurrenceCount
                  console.log(`🔊 [PENDING→TTS] Speaking queued warning for ${pending.type} (occurrence ${occurrenceCount})`)
                  
                  if (window.electronAPI?.speakSecurityWarning) {
                    // Mark request as in-flight BEFORE IPC call
                    activeTTSRequestsRef.current.add(requestId)
                    isWarningTTSActiveRef.current = true
                    
                    window.electronAPI.speakSecurityWarning(pending.message)
                    
                    // Remove from in-flight after TTS completes
                    setTimeout(() => {
                      activeTTSRequestsRef.current.delete(requestId)
                      isWarningTTSActiveRef.current = false
                    }, 3000) // 3s to account for TTS duration
                  }
                } else {
                  console.log(`🔍 [PENDING CHECK] Skipping pending ${pending.type} - already spoken for occurrence ${occurrenceCount}`)
                }
              }
              
              // CRITICAL: Validate warnings are still active immediately after getting them
              // This prevents processing warnings that were discarded between getActiveWarnings() and now
              const validActiveWarnings = activeWarnings.filter(w => {
                if (serviceRef.current) {
                  const isStillActive = serviceRef.current.isWarningStillActive(w.type, w.startTime)
                  if (!isStillActive) {
                    console.log(`🔍 [VALIDATION] Warning ${w.type}-${w.startTime} was discarded, removing from processing`)
                    // Clean up tracking for discarded warning
                    const warningKey = `${w.type}-${w.startTime}`
                    spokenWarningsRef.current.delete(warningKey)
                    
                    // If this was the last incrementing warning, roll back the occurrence count
                    const lastIncrementKey = lastIncrementingWarningKeyRef.current[w.type]
                    if (lastIncrementKey === warningKey) {
                      const currentCount = warningOccurrenceCountRef.current[w.type] || 0
                      if (currentCount > 0) {
                        warningOccurrenceCountRef.current[w.type] = currentCount - 1
                        console.log(`🔍 [VALIDATION] Rolling back occurrenceCount for ${w.type} from ${currentCount} to ${currentCount - 1} (discarded warning was last increment)`)
                        // Also clear the last increment key so a new warning can increment
                        delete lastIncrementingWarningKeyRef.current[w.type]
                        lastIncrementTimeRef.current[w.type] = 0
                      }
                    }
                    
                    return false
                  }
                }
                return true
              })
              
              // Deduplicate by type - only process the oldest instance of each type
              const warningsByType = new Map<string, typeof validActiveWarnings[0]>()
              validActiveWarnings.forEach(w => {
                if (!warningsByType.has(w.type) || w.startTime < warningsByType.get(w.type)!.startTime) {
                  warningsByType.set(w.type, w)
                }
              })
              
              // Filter out warnings that have already been spoken to avoid unnecessary processing
              const unprocessedWarnings = Array.from(warningsByType.values()).filter(warning => {
                const duration = now - warning.startTime
                const threshold = thresholds[warning.type] || 0
                if (duration < threshold) return false // Skip warnings below threshold
                
                const warningKey = `${warning.type}-${warning.startTime}`
                return !spokenWarningsRef.current.has(warningKey) // Only include unprocessed warnings
              })
              
              // Only log if there are unprocessed warnings to avoid console spam
              if (unprocessedWarnings.length > 0) {
                console.log(`🔍 [LOOP] Processing ${unprocessedWarnings.length} unprocessed warnings`)
              }
              
              unprocessedWarnings.forEach((warning) => {
                const duration = now - warning.startTime
                const warningKey = `${warning.type}-${warning.startTime}`
                
                // CRITICAL: Validate that this warning is still active before processing
                // A warning might have been discarded between getActiveWarnings() and now
                if (serviceRef.current && !serviceRef.current.isWarningStillActive(warning.type, warning.startTime)) {
                  console.log(`🔍 [ACTIVE CHECK] Warning ${warningKey} was discarded, cleaning up tracking`)
                  // Clean up tracking for discarded warning
                  spokenWarningsRef.current.delete(warningKey)
                  // If this was the last incrementing warning, we might want to rollback, but that's complex
                  // For now, just skip processing
                  return
                }
                
                // Mark as processing immediately to prevent duplicate processing in same or next iteration
                // This must happen BEFORE any other processing to prevent race conditions
                if (spokenWarningsRef.current.has(warningKey)) {
                  return // Skip if already being processed (shouldn't happen due to filter, but safety check)
                }
                
                // Mark as spoken IMMEDIATELY to prevent duplicate processing
                spokenWarningsRef.current.add(warningKey)
                
                // Get current occurrence count
                let occurrenceCount = warningOccurrenceCountRef.current[warning.type] || 0
                const lastSpoken = lastSpokenOccurrenceRef.current[warning.type] || 0
                
                // Only increment occurrence count if:
                // 1. This is a different warning instance than the last one that caused an increment, AND
                // 2. Enough time has passed since the last increment (prevents rapid-fire increments)
                const lastIncrementKey = lastIncrementingWarningKeyRef.current[warning.type]
                const lastIncrementTime = lastIncrementTimeRef.current[warning.type] || 0
                const timeSinceLastIncrement = now - lastIncrementTime
                const isDifferentWarning = lastIncrementKey !== warningKey
                const enoughTimePassed = timeSinceLastIncrement >= MIN_INCREMENT_INTERVAL
                
                if (isDifferentWarning && (enoughTimePassed || lastIncrementTime === 0)) {
                  warningOccurrenceCountRef.current[warning.type] = occurrenceCount + 1
                  occurrenceCount = occurrenceCount + 1
                  lastIncrementingWarningKeyRef.current[warning.type] = warningKey
                  lastIncrementTimeRef.current[warning.type] = now
                }
                
                console.log(`🔍 [ACTIVE CHECK] New warning instance: ${warning.type}, key=${warningKey}, occurrenceCount=${occurrenceCount}, lastSpoken=${lastSpoken}`)
                
                // Only speak on every 3rd occurrence (1st, 4th, 7th, etc.)
                // AND only if we haven't already spoken for this occurrence count
                const shouldSpeak = occurrenceCount % 3 === 1 && occurrenceCount > lastSpoken
                
                console.log(`🔍 [ACTIVE CHECK] ${warning.type}: shouldSpeak=${shouldSpeak} (${occurrenceCount} % 3 === 1 && ${occurrenceCount} > ${lastSpoken})`)
                
                if (shouldSpeak) {
                  const messages = WARNING_MESSAGES[warning.type] || []
                  const message = messages[Math.floor(Math.random() * messages.length)] || `Security alert: ${warning.type}`
                  
                  // Skip if already pending for this type (prevents duplicate in same iteration)
                  const isAlreadyPending = pendingWarningRef.current?.type === warning.type
                  
                  console.log(`🔍 [ACTIVE CHECK] ${warning.type}: isSpeaking=${isSpeaking}, isEvaluating=${isEvaluating}, isWarningTTSActive=${isWarningTTSActiveRef.current}, isAlreadyPending=${isAlreadyPending}`)
                  
                  // Create unique request ID for deduplication (check FIRST)
                  const requestId = `${warning.type}-${occurrenceCount}`
                  
                  console.log(`🔍 [ACTIVE CHECK] Checking requestId: ${requestId}, inFlight: ${activeTTSRequestsRef.current.has(requestId)}, activeTTS: [${Array.from(activeTTSRequestsRef.current).join(', ')}]`)
                  
                  // Check if this exact request is already in flight
                  if (activeTTSRequestsRef.current.has(requestId)) {
                    console.log(`🔇 [ACTIVE CHECK] Request ${requestId} already in flight, skipping`)
                    return
                  }
                  
                  if (!isSpeaking && !isEvaluating && !isWarningTTSActiveRef.current && !isAlreadyPending) {
                    lastSpokenOccurrenceRef.current[warning.type] = occurrenceCount
                    console.log(`🔊 [ACTIVE→TTS] Speaking warning for ${warning.type} (occurrence ${occurrenceCount}/3) after ${Math.round(duration / 1000)}s`)
                    
                    if (window.electronAPI?.speakSecurityWarning) {
                      // Mark request as in-flight BEFORE IPC call
                      activeTTSRequestsRef.current.add(requestId)
                      isWarningTTSActiveRef.current = true
                      
                      window.electronAPI.speakSecurityWarning(message)
                      
                      // Remove from in-flight after TTS completes
                      setTimeout(() => {
                        activeTTSRequestsRef.current.delete(requestId)
                        isWarningTTSActiveRef.current = false
                      }, 3000) // 3s to account for TTS duration
                    }
                  } else if (!isAlreadyPending) {
                    // Only queue if not already queued for this type
                    pendingWarningRef.current = { type: warning.type, message }
                    console.log(`⏳ [ACTIVE→QUEUE] Queuing warning for ${warning.type} (occurrence ${occurrenceCount}/3) - AI is busy`)
                  } else {
                    console.log(`🔍 [ACTIVE CHECK] Skipping ${warning.type} - already pending`)
                  }
                } else {
                  console.log(`⏭️ [ACTIVE CHECK] Skipping TTS for ${warning.type} (occurrence ${occurrenceCount}, last spoken: ${lastSpoken})`)
                }
              })
              
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
    }
  }, [enabled, isInitialized, videoElement, onSecurityAlert])

  const getStatus = useCallback((): VisionSecurityStatus | null => {
    return status
  }, [status])

  const endAllActiveWarnings = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.endAllActiveWarnings()
      const stats = serviceRef.current.getWarningStats()
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

  return {
    status,
    isInitialized,
    error,
    warningStats,
    getStatus,
    endAllActiveWarnings,
    getWarningStats,
    getActiveWarnings,
    isWarningStillActive
  }
}

