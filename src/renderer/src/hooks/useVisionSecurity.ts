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
        const service = new VisionSecurityService()
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

          // Emit to main process periodically
          const now = Date.now()
          if (now - lastEmitTime.current >= EMIT_INTERVAL) {
            lastEmitTime.current = now
            
            // Send to main process via IPC
            if (window.electronAPI?.sendVisionSecurityData) {
              window.electronAPI.sendVisionSecurityData(securityStatus)
            }

            // Trigger alert callback if there are suspicious events
            if (securityStatus.suspiciousEvents.length > 0 && onSecurityAlert) {
              onSecurityAlert(securityStatus)
            }
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

  return {
    status,
    isInitialized,
    error,
    getStatus
  }
}

