import { EventEmitter } from 'events'
import { AssemblyAI } from 'assemblyai'

export interface STTTranscript {
  text: string
  isFinal: boolean
  confidence: number
  timestamp: number
}

export interface STTConfig {
  provider: 'assemblyai'
  apiKey: string
  sampleRate?: number
  language?: string
}

export interface STTTokenConfig {
  provider: 'assemblyai'
  token: string
  sampleRate?: number
  language?: string
}

export class STTService extends EventEmitter {
  private assemblyai: AssemblyAI
  private transcriber: any
  private isConnected = false
  private config: STTConfig | STTTokenConfig
  private reconnectAttempts = 0
  private maxReconnectAttempts = 3
  private reconnectTimeout: NodeJS.Timeout | null = null

  constructor(config: STTConfig | STTTokenConfig) {
    super()
    this.config = config
    // Initialize AssemblyAI client with API key or token
    if ('apiKey' in config) {
      this.assemblyai = new AssemblyAI({ apiKey: config.apiKey })
    } else {
      // For token-based auth, we need to use the streaming client directly
      this.assemblyai = new AssemblyAI({ apiKey: '' }) // Empty API key when using token
    }
  }

  async startListening(): Promise<void> {
    if (this.isConnected) {
      console.log('🎤 [STT] Already connected')
      return
    }

    try {
      console.log('🎤 [STT] Creating transcriber...')
      
      // Create transcriber with proper configuration
      if ('apiKey' in this.config) {
        // Use API key authentication
        this.transcriber = this.assemblyai.streaming.transcriber({
          sampleRate: this.config.sampleRate || 16000,
          encoding: 'pcm_s16le', // 16-bit PCM
          // Optimized for voice agents - faster turn detection
          endOfTurnConfidenceThreshold: 0.8, // Lower threshold for faster detection
          minEndOfTurnSilenceWhenConfident: 2000, // 400ms as recommended
          maxTurnSilence: 3000, // 1.28s as recommended
          formatTurns: false // Use unformatted for lower latency in voice agents
        })
      } else {
        // Use token authentication
        this.transcriber = this.assemblyai.streaming.transcriber({
          token: this.config.token,
          sampleRate: this.config.sampleRate || 16000,
          encoding: 'pcm_s16le', // 16-bit PCM
          // Optimized for voice agents - faster turn detection
          endOfTurnConfidenceThreshold: 0.8, // Lower threshold for faster detection
          minEndOfTurnSilenceWhenConfident: 2000, // 400ms as recommended
          maxTurnSilence: 3000, // 1.28s as recommended
          formatTurns: false // Use unformatted for lower latency in voice agents
        })
      }

      // Set up event handlers
      this.transcriber.on('open', () => {
        console.log('🎤 [STT] Connection opened')
        this.isConnected = true
        this.emit('connected')
      })

      // Handle partial transcripts (interim results)
      this.transcriber.on('transcript', (transcript: any) => {
        if (!transcript.text) {
          console.log('🎤 [STT] Received transcript event but no text:', transcript)
          return
        }
        
        console.log('🎤 [STT] Partial transcript:', transcript.text)
        
        const sttTranscript: STTTranscript = {
          text: transcript.text,
          isFinal: false,
          confidence: transcript.confidence || 0,
          timestamp: Date.now()
        }
        
        this.emit('transcript', sttTranscript)
      })

      // Handle turn events (both partial and final)
      this.transcriber.on('turn', (turn: any) => {
        if (!turn.transcript || turn.transcript.trim().length === 0) {
          console.log('🎤 [STT] Turn event has no transcript text')
          return
        }
        
        console.log('🎤 [STT] Turn transcript:', turn.transcript, 'End of turn:', turn.end_of_turn)
        
        const sttTranscript: STTTranscript = {
          text: turn.transcript,
          isFinal: turn.end_of_turn || false,
          confidence: turn.end_of_turn_confidence || 0,
          timestamp: Date.now()
        }
        
        this.emit('transcript', sttTranscript)
      })

      // Handle session info messages (ignore unknown message types)
      this.transcriber.on('session-info', (info: any) => {
        console.log('🎤 [STT] Session info:', info)
        // This is just informational, no action needed
      })

      this.transcriber.on('error', (error: any) => {
        console.error('🎤 [STT] Error event:', error)
        console.error('🎤 [STT] Error details:', JSON.stringify(error, null, 2))
        this.isConnected = false
        this.attemptReconnect()
        this.emit('error', error)
      })

      this.transcriber.on('close', (code: number, reason: string) => {
        console.log('🎤 [STT] Connection closed:', code, reason)
        this.isConnected = false
        this.attemptReconnect()
        this.emit('disconnected')
      })

      // Connect to AssemblyAI
      console.log('🎤 [STT] Connecting...')
      await this.transcriber.connect()
      console.log('🎤 [STT] Connected successfully')

    } catch (error) {
      console.error('🎤 [STT] Failed to start:', error)
      this.isConnected = false
      throw error
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('🎤 [STT] Max reconnection attempts reached')
      return
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000) // Exponential backoff, max 10s
    
    console.log(`🎤 [STT] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`)
    
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.startListening()
        this.reconnectAttempts = 0 // Reset on successful reconnection
        console.log('🎤 [STT] Reconnected successfully')
      } catch (error) {
        console.error('🎤 [STT] Reconnection failed:', error)
        this.attemptReconnect() // Try again
      }
    }, delay)
  }

  streamAudio(audioChunk: Buffer): void {
    if (!this.isConnected || !this.transcriber) {
      console.warn('🎤 [STT] Not connected, dropping audio chunk. isConnected:', this.isConnected, 'transcriber:', !!this.transcriber)
      return
    }

    try {
      // Send audio directly without delay or filtering
      this.transcriber.sendAudio(audioChunk)
      // Log occasionally to verify audio is being sent (every 50 chunks = ~2.5 seconds)
      if (Math.random() < 0.02) {
        console.log('🎤 [STT] Audio chunk sent, size:', audioChunk.length, 'bytes')
      }
    } catch (error) {
      console.error('🎤 [STT] Error sending audio:', error)
      this.isConnected = false
      this.attemptReconnect()
    }
  }

  async stopListening(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    if (this.transcriber) {
      console.log('🎤 [STT] Closing connection...')
      try {
        await this.transcriber.close()
      } catch (error) {
        console.error('🎤 [STT] Error closing:', error)
      }
      this.transcriber = null
      this.isConnected = false
      this.reconnectAttempts = 0
      console.log('🎤 [STT] Connection closed')
    }
  }

  isListening(): boolean {
    return this.isConnected
  }
}

// Factory function
export function createSTTService(config: STTConfig | STTTokenConfig): STTService {
  return new STTService(config)
}