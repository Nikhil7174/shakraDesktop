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
  const animationFrameRef = useRef<number | null>(null)
  const lastEmitTime = useRef<number>(0)
  const warningOccurrenceCountRef = useRef<Record<string, number>>({})
  const lastSpokenOccurrenceRef = useRef<Record<string, number>>({})
  const isWarningTTSActiveRef = useRef<boolean>(false)
  const pushedOccurrencesRef = useRef<Record<string, Set<number>>>({}) // Track which occurrences we've pushed to stack
  const incrementedWarningsRef = useRef<Record<string, Set<string>>>({}) // Track which warning instances we've incremented (by key: type-startTime)
  const stackProcessTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({}) // Debounce timers for processing stack
  
  // Stack-based warning queue: one stack per warning type (LIFO - latest on top)
  interface WarningStackItem {
    type: string
    message: string
    occurrenceCount: number
    timestamp: number
  }
  const warningStacksRef = useRef<Record<string, WarningStackItem[]>>({})
  
  const EMIT_INTERVAL = 1000 // Emit security data every 1 second
  const STACK_PROCESS_DEBOUNCE_MS = 300 // Wait 300ms after pushing to stack before processing

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

  // Process warning stack: pop latest warning and speak it, then clear ALL stacks
  const processWarningStack = useCallback(() => {
    // Only speak warnings when AI is not speaking, not evaluating, and actively listening for candidate input
    if (isSpeaking || isEvaluating || !isListening || isWarningTTSActiveRef.current) {
      return // Can't speak now - must be listening for candidate to speak warnings
    }

    // Find the warning type with the most recent warning (highest timestamp)
    let latestType: string | null = null
    let latestTimestamp = 0
    
    Object.keys(warningStacksRef.current).forEach(type => {
      const stack = warningStacksRef.current[type]
      if (stack.length > 0) {
        // Get the latest warning (top of stack - LIFO)
        const latest = stack[stack.length - 1]
        if (latest.timestamp > latestTimestamp) {
          latestTimestamp = latest.timestamp
          latestType = type
        }
      }
    })
    
    // Process the most recent warning
    if (latestType) {
      const stack = warningStacksRef.current[latestType]
      const stackSizeBefore = stack.length
      
      // Clear ALL pending timers for ALL types (prevent other types from firing during this TTS)
      Object.keys(stackProcessTimersRef.current).forEach(type => {
        clearTimeout(stackProcessTimersRef.current[type])
        delete stackProcessTimersRef.current[type]
      })
      
      // Pop latest warning (top of stack - LIFO)
      const latestWarning = stack.pop()!
      
      // Clear ALL stacks for ALL types to prevent multiple TTS calls
      // This ensures only ONE warning is spoken at a time, even across different types
      Object.keys(warningStacksRef.current).forEach(type => {
        warningStacksRef.current[type] = []
      })
      
      // Update last spoken occurrence
      lastSpokenOccurrenceRef.current[latestType] = latestWarning.occurrenceCount
      
      // Clear the pushed occurrence tracking for this occurrence (we've spoken it)
      if (pushedOccurrencesRef.current[latestType]) {
        pushedOccurrencesRef.current[latestType].delete(latestWarning.occurrenceCount)
      }
      
      // Mark TTS as active
      isWarningTTSActiveRef.current = true
      
      const clearedCount = stackSizeBefore - 1
      console.log(`🔊 [STACK→TTS] Speaking latest warning for ${latestType} (occurrence ${latestWarning.occurrenceCount})${clearedCount > 0 ? `, cleared ${clearedCount} other warning(s)` : ''}, cleared all stacks`)
      
      if (window.electronAPI?.speakSecurityWarning) {
        window.electronAPI.speakSecurityWarning(latestWarning.message)
        
        // Reset after TTS completes
        setTimeout(() => {
          isWarningTTSActiveRef.current = false
          // Try to process next warning in stack if any
          processWarningStack()
        }, 3000) // 3s to account for TTS duration
      } else {
        isWarningTTSActiveRef.current = false
      }
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
                  // Check if we've already pushed this occurrence to the stack (prevent duplicates)
                  if (!pushedOccurrencesRef.current[warning.type]) {
                    pushedOccurrencesRef.current[warning.type] = new Set()
                  }
                  
                  if (pushedOccurrencesRef.current[warning.type].has(occurrenceCount)) {
                    // Already pushed this occurrence, skip
                    return
                  }
                  
                  const messages = WARNING_MESSAGES[warning.type] || []
                  const message = messages[Math.floor(Math.random() * messages.length)] || `Security alert: ${warning.type}`
                  
                  // Initialize stack for this warning type if needed
                  if (!warningStacksRef.current[warning.type]) {
                    warningStacksRef.current[warning.type] = []
                  }
                  
                  // Mark this occurrence as pushed
                  pushedOccurrencesRef.current[warning.type].add(occurrenceCount)
                  
                  // Push latest warning to stack (LIFO - latest on top)
                  warningStacksRef.current[warning.type].push({
                    type: warning.type,
                    message,
                    occurrenceCount,
                    timestamp: now
                  })
                  
                  console.log(`📥 [STACK] Pushed warning for ${warning.type} (occurrence ${occurrenceCount}), stack size: ${warningStacksRef.current[warning.type].length}`)
                  
                  // Debounce: Wait 300ms before processing stack
                  // If another warning comes within 300ms, reset the timer (only latest will be processed)
                  if (stackProcessTimersRef.current[warning.type]) {
                    clearTimeout(stackProcessTimersRef.current[warning.type])
                  }
                  
                  stackProcessTimersRef.current[warning.type] = setTimeout(() => {
                    processWarningStack()
                    delete stackProcessTimersRef.current[warning.type]
                  }, STACK_PROCESS_DEBOUNCE_MS)
                }
              })
              
              // Also try to process stack in case TTS just became available
              processWarningStack()
              
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
      
      // Clean up any pending stack process timers
      Object.values(stackProcessTimersRef.current).forEach(timer => {
        clearTimeout(timer)
      })
      stackProcessTimersRef.current = {}
    }
  }, [enabled, isInitialized, videoElement, onSecurityAlert, isSpeaking, isEvaluating, isListening, processWarningStack])

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

