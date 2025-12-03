import { useEffect, useRef, useState, useCallback } from 'react'
import { VisionSecurityService } from '../services/visionSecurityService'
import type { VisionSecurityStatus } from '../../../shared/types'

interface UseVisionSecurityOptions {
  videoElement: HTMLVideoElement | null
  enabled?: boolean
  onSecurityAlert?: (status: VisionSecurityStatus) => void
}

export const useVisionSecurity = ({
  videoElement,
  enabled = true,
  onSecurityAlert
}: UseVisionSecurityOptions) => {
  const [status, setStatus] = useState<VisionSecurityStatus | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warningStats, setWarningStats] = useState<any>({})
  
  const serviceRef = useRef<VisionSecurityService | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastEmitTime = useRef<number>(0)
  const EMIT_INTERVAL = 1000 // Emit security data every 1 second

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

            // Trigger alert callback for active warnings that exceed threshold
            if (serviceRef.current && onSecurityAlert) {
              const activeWarnings = serviceRef.current.getActiveWarnings()
              const now = Date.now()
              const thresholds = {
                gaze_away: 3000,
                face_absent: 5000,
                mobile_device_usage: 3000,
                multiple_faces: 0
              }
              
              const alertWarnings = activeWarnings.filter(w => {
                const duration = now - w.startTime
                return duration >= (thresholds[w.type] || 0)
              })
              
              if (alertWarnings.length > 0) {
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

  return {
    status,
    isInitialized,
    error,
    warningStats,
    getStatus,
    endAllActiveWarnings,
    getWarningStats,
    getActiveWarnings
  }
}

