import React, { useEffect, useRef, useState } from 'react'

interface VideoCaptureProps {
  onStreamReady?: (stream: MediaStream) => void
  onStreamError?: (error: Error) => void
  onVideoElementReady?: (videoElement: HTMLVideoElement) => void
  className?: string
  autoStart?: boolean
}

export const VideoCapture: React.FC<VideoCaptureProps> = ({
  onStreamReady,
  onStreamError,
  onVideoElementReady,
  className = '',
  autoStart = true
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState(false)

  useEffect(() => {
    if (autoStart && !isStreaming && !streamRef.current) {
      startCapture()
    }

    // Only cleanup on unmount, not on autoStart change
    return () => {
      // Only stop if component is actually unmounting
      if (streamRef.current) {
        stopCapture()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - only run on mount/unmount

  const startCapture = async () => {
    try {
      // Request camera permissions via Electron
      if (window.electronAPI?.requestCameraPermissions) {
        const result = await window.electronAPI.requestCameraPermissions()
        if (!result.success) {
          throw new Error(result.error || 'Camera permission denied')
        }
        setHasPermission(true)
      }

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // Handle play() promise to avoid AbortError
        try {
          const playPromise = videoRef.current.play()
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              // Ignore AbortError - it happens when video is interrupted by new load
              if (err.name !== 'AbortError') {
                console.warn('Video play error:', err)
              }
            })
          }
        } catch (err: any) {
          // Ignore AbortError - it happens when video is interrupted by new load
          if (err.name !== 'AbortError') {
            console.warn('Video play error:', err)
          }
        }
        setIsStreaming(true)
        setError(null)
        onStreamReady?.(stream)
        // Notify parent component that video element is ready
        onVideoElementReady?.(videoRef.current)
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to access camera'
      setError(errorMessage)
      setIsStreaming(false)
      onStreamError?.(err)
      console.error('Video capture error:', err)
    }
  }

  const stopCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsStreaming(false)
  }

  // Note: onVideoElementReady is already called in startCapture() after setting srcObject
  // This useEffect was causing duplicate calls and potential issues

  return (
    <div className={`video-capture-container ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="video-capture-element"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)' // Mirror the video
        }}
      />
      {error && (
        <div className="video-capture-error">
          <p>Camera Error: {error}</p>
          <button onClick={startCapture}>Retry</button>
        </div>
      )}
      {!isStreaming && !error && (
        <div className="video-capture-loading">
          <div className="loading-spinner"></div>
          <p>Initializing camera...</p>
        </div>
      )}
      <style>{`
        .video-capture-container {
          position: relative;
          width: 100%;
          height: 100%;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
        }

        .video-capture-element {
          display: block;
        }

        .video-capture-error {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: #ff4d4f;
          z-index: 10;
        }

        .video-capture-error button {
          margin-top: 12px;
          padding: 8px 16px;
          background: #1890ff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .video-capture-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: #ffffff;
          z-index: 10;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top-color: #1890ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 12px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default VideoCapture

