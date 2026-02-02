import React, { useEffect, useRef, useState } from 'react'

interface AudioVisualizerProps {
  isListening: boolean
  isSpeaking: boolean
  isMuted?: boolean
  audioData?: Uint8Array
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isListening,
  isSpeaking,
  isMuted = false,
  audioData
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawVisualizer = () => {
      const width = canvas.width
      const height = canvas.height

      // Clear canvas
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.fillRect(0, 0, width, height)

      if ((isListening || isSpeaking) && !isMuted) {
        // Create audio visualization
        const barCount = 32
        const barWidth = width / barCount
        const maxBarHeight = height * 0.8

        for (let i = 0; i < barCount; i++) {
          // Simulate audio data if not provided
          const audioValue = audioData ?
            (audioData[i] || 0) / 255 :
            Math.random() * (isListening ? 0.8 : 0.6)

          const barHeight = audioValue * maxBarHeight
          const x = i * barWidth
          const y = height - barHeight

          // Create gradient
          const gradient = ctx.createLinearGradient(0, y, 0, height)
          if (isSpeaking) {
            gradient.addColorStop(0, '#2196f3')
            gradient.addColorStop(1, '#1565c0')
          } else if (isListening) {
            gradient.addColorStop(0, '#4caf50')
            gradient.addColorStop(1, '#2e7d32')
          }

          ctx.fillStyle = gradient
          ctx.fillRect(x, y, barWidth - 2, barHeight)

          // Add glow effect
          ctx.shadowColor = isSpeaking ? '#2196f3' : '#4caf50'
          ctx.shadowBlur = 10
          ctx.fillRect(x, y, barWidth - 2, barHeight)
          ctx.shadowBlur = 0
        }

        // Update audio level for pulse effect
        const currentLevel = audioData ?
          Array.from(audioData).reduce((sum, val) => sum + val, 0) / audioData.length / 255 :
          Math.random() * 0.5 + 0.3
        setAudioLevel(currentLevel)
      }

      animationFrameRef.current = requestAnimationFrame(drawVisualizer)
    }

    drawVisualizer()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isListening, isSpeaking, isMuted, audioData])

  const getStatusText = () => {
    if (isMuted) return 'Muted'
    if (isSpeaking) return 'Interviewer'
    if (isListening) return 'Listening...'
    return 'Ready'
  }

  const getStatusColor = () => {
    if (isMuted) return '#666666'
    if (isSpeaking) return '#2196f3'
    if (isListening) return '#4caf50'
    return '#666666'
  }

  return (
    <div className="audio-visualizer">
      <div className="visualizer-container">
        <canvas
          ref={canvasRef}
          width={120}
          height={60}
          className="visualizer-canvas"
        />
        <div className="status-indicator">
          <div
            className="status-dot"
            style={{
              backgroundColor: getStatusColor(),
              transform: `scale(${1 + audioLevel * 0.5})`,
              opacity: 0.8 + audioLevel * 0.2
            }}
          />
          <span className="status-text">{getStatusText()}</span>
        </div>
      </div>

      <style>{`
        .audio-visualizer {
          /* Position is controlled by parent component */
        }

        .visualizer-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: rgba(0, 0, 0, 0.8);
          border-radius: 12px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .visualizer-canvas {
          height: 30px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.3);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .status-text {
          font-size: 12px;
          color: #ffffff;
          font-weight: 500;
        }

        @keyframes pulse {
          0% { opacity: 0.8; }
          50% { opacity: 1; }
          100% { opacity: 0.8; }
        }

        .status-dot {
          animation: pulse 2s infinite;
        }
      `}</style>
    </div>
  )
}

export default AudioVisualizer


