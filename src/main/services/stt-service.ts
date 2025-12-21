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
  private audioChunkCount = 0
  private lastTranscriptTime = 0

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
      console.log('🎤 [STT] Config:', {
        hasApiKey: 'apiKey' in this.config,
        hasToken: 'token' in this.config,
        sampleRate: this.config.sampleRate || 16000,
        language: this.config.language || 'en'
      })
      
      // Create transcriber with proper configuration
      if ('apiKey' in this.config) {
        // Use API key authentication
        if (!this.config.apiKey || this.config.apiKey.trim() === '') {
          throw new Error('AssemblyAI API key is missing or empty')
        }
        console.log('🎤 [STT] Using API key authentication')
        this.transcriber = this.assemblyai.streaming.transcriber({
          sampleRate: this.config.sampleRate || 16000,
          encoding: 'pcm_s16le', // 16-bit PCM
          // Turn detection tuned to avoid cutting the user off mid‑sentence
          endOfTurnConfidenceThreshold: 0.7, // Require higher confidence before ending a turn
          minEndOfTurnSilenceWhenConfident: 700, // Need at least ~0.7s of silence when confident
          maxTurnSilence: 2500, // Up to 2.5s of silence before forcing end of turn
          formatTurns: false // Use unformatted for lower latency in voice agents
        })
      } else {
        // Use token authentication
        if (!this.config.token || this.config.token.trim() === '') {
          throw new Error('AssemblyAI token is missing or empty')
        }
        console.log('🎤 [STT] Using token authentication')
        this.transcriber = this.assemblyai.streaming.transcriber({
          token: this.config.token,
          sampleRate: this.config.sampleRate || 16000,
          encoding: 'pcm_s16le', // 16-bit PCM
          // Same turn‑detection tuning for token auth
          endOfTurnConfidenceThreshold: 0.7,
          minEndOfTurnSilenceWhenConfident: 700,
          maxTurnSilence: 2500,
          formatTurns: false
        })
      }
      
      console.log('🎤 [STT] Transcriber created successfully')

      // Set up event handlers BEFORE connecting
      // Use a promise to wait for the 'open' event
      let connectionResolve: (() => void) | null = null
      let connectionReject: ((error: any) => void) | null = null
      const connectionPromise = new Promise<void>((resolve, reject) => {
        connectionResolve = resolve
        connectionReject = reject
      })
      
      const connectionTimeout = setTimeout(() => {
        if (connectionReject) {
          connectionReject(new Error('STT connection timeout: open event not received within 10 seconds'))
        }
      }, 10000)

      this.transcriber.on('open', () => {
        clearTimeout(connectionTimeout)
        console.log('🎤 [STT] Connection opened - WebSocket is ready')
        this.isConnected = true
        this.emit('connected')
        if (connectionResolve) {
          connectionResolve()
        }
      })

      // Handle partial transcripts (interim results) - these fire earlier than turn events
      this.transcriber.on('transcript', (transcript: any) => {
        this.lastTranscriptTime = Date.now()
        console.log('🎤 [STT] ✅ Received transcript event (partial/interim):', JSON.stringify(transcript))
        if (!transcript.text || transcript.text.trim().length === 0) {
          // Log empty transcripts to see if VAD is detecting speech but not transcribing yet
          if (transcript.words && transcript.words.length > 0) {
            console.log('🎤 [STT] Transcript has words but no text yet:', transcript.words.map((w: any) => w.text).join(' '))
          }
          return
        }
        
        console.log('🎤 [STT] ✅ Partial transcript (interim):', transcript.text)
        
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
        this.lastTranscriptTime = Date.now()
        console.log('🎤 [STT] ✅ Received turn event:', JSON.stringify(turn))
        if (!turn.transcript || turn.transcript.trim().length === 0) {
          console.log('🎤 [STT] Turn event has no transcript text')
          return
        }
        
        console.log('🎤 [STT] ✅ Turn transcript:', turn.transcript, 'End of turn:', turn.end_of_turn)
        
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
        console.log('🎤 [STT] Session info:', JSON.stringify(info))
        // This is just informational, no action needed
      })

      this.transcriber.on('error', (error: any) => {
        clearTimeout(connectionTimeout)
        console.error('🎤 [STT] Error event:', error)
        console.error('🎤 [STT] Error details:', JSON.stringify(error, null, 2))
        this.isConnected = false
        
        // If we're still in the connection phase, reject the promise
        if (connectionReject) {
          connectionReject(error)
          connectionResolve = null
          connectionReject = null
        } else {
          // Otherwise, attempt reconnection
          this.attemptReconnect()
        }
        
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
      console.log('🎤 [STT] Connect() resolved, waiting for open event...')
      
      // Wait for the 'open' event before considering connection ready
      await connectionPromise
      console.log('🎤 [STT] Connection fully established and ready')

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
      // Log more frequently when dropping chunks to diagnose issues
      if (Math.random() < 0.1) {
        console.warn('🎤 [STT] Not connected, dropping audio chunk. isConnected:', this.isConnected, 'transcriber:', !!this.transcriber, 'chunkSize:', audioChunk.length)
      }
      return
    }

    this.audioChunkCount++
    
    // Log audio statistics every 100 chunks (~5 seconds)
    if (this.audioChunkCount % 100 === 0) {
      const timeSinceLastTranscript = this.lastTranscriptTime > 0 ? Date.now() - this.lastTranscriptTime : 0
      console.log(`🎤 [STT] Audio stats: ${this.audioChunkCount} chunks sent, ${timeSinceLastTranscript}ms since last transcript`)
      
      // Check if we've sent a lot of audio but received no transcripts
      if (this.audioChunkCount > 200 && this.lastTranscriptTime === 0) {
        console.warn('🎤 [STT] WARNING: Sent 200+ audio chunks but received no transcripts. Possible issues:')
        console.warn('🎤 [STT] - Audio format might be incorrect')
        console.warn('🎤 [STT] - Audio might be too quiet or contain no speech')
        console.warn('🎤 [STT] - AssemblyAI API might be having issues')
        
        // Log sample of audio data for debugging
        if (audioChunk.length >= 4) {
          const sample = Array.from(audioChunk.slice(0, 8))
          console.log('🎤 [STT] Sample audio bytes (first 8):', sample)
        }
      }
    }

    try {
      // Send audio directly without delay or filtering
      this.transcriber.sendAudio(audioChunk)
      // Log occasionally to verify audio is being sent (every 50 chunks = ~2.5 seconds)
      if (Math.random() < 0.02) {
        console.log('🎤 [STT] Audio chunk sent successfully, size:', audioChunk.length, 'bytes, isConnected:', this.isConnected, 'hasTranscriber:', !!this.transcriber, 'totalChunks:', this.audioChunkCount)
      }
    } catch (error) {
      console.error('🎤 [STT] Error sending audio:', error)
      console.error('🎤 [STT] Error details:', {
        isConnected: this.isConnected,
        hasTranscriber: !!this.transcriber,
        chunkSize: audioChunk.length,
        error: error instanceof Error ? error.message : String(error)
      })
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
    
    // Reset audio statistics
    this.audioChunkCount = 0
    this.lastTranscriptTime = 0
  }

  isListening(): boolean {
    // Check both connection status and transcriber existence
    // A transcriber can be null even if isConnected is true (race condition)
    return this.isConnected && !!this.transcriber
  }
}

// Factory function
export function createSTTService(config: STTConfig | STTTokenConfig): STTService {
  return new STTService(config)
}