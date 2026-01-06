import { 
  voice,
  log,
  initializeLogger
} from '@livekit/agents'
import { VAD } from '@livekit/agents-plugin-silero'
import { STT, TTS, LLM } from '@livekit/agents-plugin-openai'
import { AccessToken } from 'livekit-server-sdk'
import { EventEmitter } from 'events'
import { Room } from '@livekit/rtc-node'

const { AgentSession, AgentSessionEventTypes } = voice

// Note: AssemblyAI plugin (@livekit/agents-plugin-assemblyai) has version conflicts
// with @livekit/agents@1.0.31. For now, we use OpenAI STT as default.
// AssemblyAI support can be added when the plugin is updated or a custom wrapper is implemented.

// Agent configuration interface
export interface AgentConfig {
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  openaiApiKey: string
  // STT provider config
  sttProvider?: 'assemblyai' | 'openai' | 'whisper'
  sttApiKey?: string // For AssemblyAI, if different from OpenAI
  assemblyaiApiKey?: string // AssemblyAI API key (fallback if sttApiKey not provided)
  // LLM config
  llmModel?: string // e.g., 'gpt-4', 'gpt-3.5-turbo'
  // TTS config
  ttsVoice?: string // e.g., 'alloy', 'echo', 'fable', etc.
  ttsModel?: string // e.g., 'tts-1', 'tts-1-hd'
}

export class InterviewAgent extends EventEmitter {
  private config: AgentConfig
  private session: voice.AgentSession | null = null
  private room: Room | null = null
  private isSpeaking: boolean = false
  private isInitialized: boolean = false
  private stt: STT | null = null
  private tts: TTS | null = null
  private llm: LLM | null = null
  private userSpeakingStartTime: number | null = null
  private userSpeakingTimeout: NodeJS.Timeout | null = null
  private lastUserSpeechTime: number = 0
  private userSpeakingEndTime: number | null = null // Track when user stopped speaking (for end-of-turn confidence)
  private readonly MIN_USER_SPEECH_DURATION_MS = 2000 // 2 seconds minimum continuous speech before interrupting AI
  private readonly END_OF_TURN_GRACE_PERIOD_MS = 1500 // 1.5 seconds grace period after user stops before AI can speak (increases end-of-turn confidence)

  constructor(config: AgentConfig) {
    super()
    this.config = config
  }

  /**
   * Initialize and start the agent
   */
  async start(roomName: string, participantName: string = 'interview-agent'): Promise<void> {
    if (this.isInitialized) {
      console.log('🎤 [Agent] Agent already initialized')
      return
    }

    try {
      console.log('🎤 [Agent] Starting LiveKit Interview Agent...')

      // Initialize logger (required by LiveKit agents framework)
      // This must be called before creating any agent components
      initializeLogger({
        level: 'info',
        pretty: false
      })

      // Configure STT provider
      // Note: AssemblyAI plugin has version conflicts, using OpenAI STT for now
      // When sttProvider is 'assemblyai', we'll use OpenAI as fallback until plugin is updated
      if (this.config.sttProvider === 'assemblyai') {
        console.warn('🎤 [Agent] AssemblyAI STT requested but plugin has version conflicts. Using OpenAI Whisper STT instead.')
        console.warn('🎤 [Agent] To use AssemblyAI, wait for @livekit/agents-plugin-assemblyai to be updated for @livekit/agents@1.0.31')
      }
      
      // Use OpenAI Whisper STT (default and fallback)
      this.stt = new STT({ 
        apiKey: this.config.openaiApiKey 
      })
      console.log('🎤 [Agent] Using OpenAI Whisper STT')

      // Configure TTS provider
      this.tts = new TTS({ 
        apiKey: this.config.openaiApiKey,
        voice: (this.config.ttsVoice || 'alloy') as any,
        model: this.config.ttsModel || 'tts-1'
      })
      console.log('🎤 [Agent] Using OpenAI TTS with voice:', this.config.ttsVoice || 'alloy')

      // Configure LLM
      this.llm = new LLM({
        apiKey: this.config.openaiApiKey,
        model: this.config.llmModel || 'gpt-4'
      })
      console.log('🎤 [Agent] Using OpenAI LLM with model:', this.config.llmModel || 'gpt-4')

      // Generate access token for the agent
      const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
        identity: participantName,
      })
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      })

      const jwt = await token.toJwt()

      // Connect to room using @livekit/rtc-node (required by AgentSession)
      const { Room: LiveKitRoom } = await import('@livekit/rtc-node')
      this.room = new LiveKitRoom()
      
      // Connect to room (connect takes url and token, opts is optional)
      await this.room.connect(this.config.livekitUrl, jwt)
      
      console.log('🎤 [Agent] Connected to room:', roomName)
      this.emit('connected', roomName)

      // Create AgentSession with STT and TTS only (no LLM to prevent automatic responses)
      // Custom LLMService handles all response generation via orchestrator's handleTranscript
      // Load VAD (this is async and may take time)
      // Note: VAD sensitivity is handled via debounce mechanism in orchestrator
      const vad = await VAD.load()
      this.session = new AgentSession({
        stt: this.stt,
        tts: this.tts,
        // llm: undefined, // Don't pass LLM - prevents automatic responses
        vad: vad,
      })

      // Set up session event handlers
      this.setupSessionHandlers()

      // Start the session without LLM (only STT/TTS)
      // Custom LLMService handles all response generation via handleTranscript
      await this.session.start({
        room: this.room,
        agent: new voice.Agent({
          instructions: `You are a technical interview assistant providing STT and TTS services only.
          Do not generate any responses - all responses are handled by the custom evaluation system.
          Your role is limited to speech-to-text transcription and text-to-speech playback.`,
          stt: this.stt,
          tts: this.tts,
          // llm: undefined, // No LLM - prevents automatic responses
          vad: vad,
        })
      })
      
      console.log('🎤 [Agent] AgentSession started without LLM - automatic responses disabled')

      this.isInitialized = true
      console.log('🎤 [Agent] Interview Agent started successfully')
      this.emit('started')

    } catch (error) {
      console.error('🎤 [Agent] Failed to start agent:', error)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Set up session event handlers
   */
  private setupSessionHandlers(): void {
    if (!this.session) return

    // Handle user speech transcription
    // Track user speaking state with debounce to prevent false positives
    this.session.on(AgentSessionEventTypes.UserInputTranscribed, (event) => {
      const text = event.transcript
      const now = Date.now()
      
      // Track when user first started speaking (if not already tracked)
      if (!this.userSpeakingStartTime) {
        this.userSpeakingStartTime = now
        // Clear end time if user starts speaking again (they're continuing, not done)
        if (this.userSpeakingEndTime) {
          this.userSpeakingEndTime = null
          console.log('🎤 [Agent] User resumed speaking, clearing end-of-turn grace period')
        }
        console.log('🎤 [Agent] User speech detected, starting debounce timer')
      }
      
      this.lastUserSpeechTime = now
      // Clear end time if user continues speaking (they haven't finished)
      if (this.userSpeakingEndTime) {
        this.userSpeakingEndTime = null
      }
      
      // Clear any existing timeout
      if (this.userSpeakingTimeout) {
        clearTimeout(this.userSpeakingTimeout)
        this.userSpeakingTimeout = null
      }
      
      // Only emit userSpeakingStarted after minimum duration to prevent false positives
      this.userSpeakingTimeout = setTimeout(() => {
        if (this.userSpeakingStartTime && (Date.now() - this.userSpeakingStartTime) >= this.MIN_USER_SPEECH_DURATION_MS) {
          console.log('🎤 [Agent] User speaking confirmed (after 2s debounce)')
          this.emit('userSpeakingStarted')
        }
      }, this.MIN_USER_SPEECH_DURATION_MS)
      
      console.log('🎤 [Agent] User speech transcribed:', text)
      this.emit('userSpeech', { text })
      this.emit('transcript', {
        text,
        isFinal: event.isFinal,
        confidence: 1,
        timestamp: now,
      })
    })
    
    // Reset user speaking state after a period of no transcription
    // This handles the case where user stops speaking
    setInterval(() => {
      if (this.userSpeakingStartTime && this.lastUserSpeechTime) {
        const timeSinceLastSpeech = Date.now() - this.lastUserSpeechTime
        // If no speech for 1 second and user was speaking, emit end event
        if (timeSinceLastSpeech > 1000 && (this.lastUserSpeechTime - this.userSpeakingStartTime) >= this.MIN_USER_SPEECH_DURATION_MS) {
          console.log('🎤 [Agent] User speaking ended (no speech for 1s)')
          this.userSpeakingEndTime = Date.now() // Record when user stopped speaking (for end-of-turn confidence)
          this.emit('userSpeakingEnded')
          this.userSpeakingStartTime = null
          this.lastUserSpeechTime = 0
          if (this.userSpeakingTimeout) {
            clearTimeout(this.userSpeakingTimeout)
            this.userSpeakingTimeout = null
          }
        }
      }
    }, 500) // Check every 500ms

    // Handle agent speech start
    // Note: No LLM in AgentSession, so all speech comes from explicit say() calls
    this.session.on(AgentSessionEventTypes.SpeechCreated, (event) => {
      console.log('🎤 [Agent] Agent started speaking (from explicit say() call)')
      this.isSpeaking = true
      this.emit('agentSpeechStarted')
    })

    // Handle session events
    this.session.on(AgentSessionEventTypes.AgentStateChanged, (event) => {
      if (event.newState === 'idle' && this.isSpeaking) {
        console.log('🎤 [Agent] Agent finished speaking')
        this.isSpeaking = false
        this.emit('agentSpeechEnded')
      }
    })

    // Handle errors
    this.session.on(AgentSessionEventTypes.Error, (error) => {
      console.error('🎤 [Agent] Session error:', error)
      this.emit('error', error)
    })

    // Handle close
    this.session.on(AgentSessionEventTypes.Close, () => {
      console.log('🎤 [Agent] Session closed')
      this.emit('disconnected')
    })
  }

  /**
   * Make the agent speak
   * Implements end-of-turn confidence: Waits grace period after user stops speaking before starting
   * This prevents the AI from jumping in too quickly if the user is just pausing briefly
   */
  async say(text: string, options?: { allowInterruptions?: boolean }): Promise<void> {
    if (!this.session) {
      throw new Error('Agent not initialized - call start() first')
    }

    if (!this.room) {
      throw new Error('Agent not connected to room')
    }

    try {
      const allowInterruptions = options?.allowInterruptions !== false
      
      // End-of-turn confidence: If user recently stopped speaking, wait grace period before starting
      // This ensures the user has actually finished speaking and isn't just pausing briefly
      if (this.userSpeakingEndTime) {
        const timeSinceUserStopped = Date.now() - this.userSpeakingEndTime
        if (timeSinceUserStopped < this.END_OF_TURN_GRACE_PERIOD_MS) {
          const remainingGracePeriod = this.END_OF_TURN_GRACE_PERIOD_MS - timeSinceUserStopped
          console.log(`🎤 [Agent] User stopped ${timeSinceUserStopped}ms ago, waiting ${remainingGracePeriod}ms grace period for end-of-turn confidence`)
          await new Promise(resolve => setTimeout(resolve, remainingGracePeriod))
          
          // Re-check if user started speaking again during grace period
          if (this.userSpeakingStartTime) {
            console.log(`🎤 [Agent] User resumed speaking during grace period, canceling AI speech`)
            // User started speaking again, don't speak (they're continuing)
            return
          }
          
          // Clear end time after grace period completes
          this.userSpeakingEndTime = null
          console.log(`🎤 [Agent] Grace period completed, user did not resume - confirming end of turn`)
        } else {
          // Grace period has passed, clear it
          this.userSpeakingEndTime = null
        }
      }
      
      console.log('🎤 [Agent] Speaking (from custom LLMService):', text.substring(0, 50) + '...', allowInterruptions ? '(interruptible)' : '(non-interruptible)')
      // Use the session's say method with allowInterruptions option
      // Note: The 2-second policy is enforced in stop() method when user tries to interrupt
      await this.session.say(text, {
        allowInterruptions: allowInterruptions
      })
    } catch (error) {
      console.error('🎤 [Agent] Error during say():', error)
      throw error
    }
  }

  /**
   * Stop current speech
   * Implements 2-second policy: Only stops if user has been speaking continuously for at least 2 seconds
   * This prevents false interruptions from brief noises, coughs, or "um" sounds
   */
  async stop(): Promise<void> {
    if (!this.session) {
      return
    }

    try {
      // 2-second policy: Only interrupt if user has been speaking continuously for at least 2 seconds
      // This prevents the AI from stopping for brief noises, coughs, or "um" sounds
      if (this.userSpeakingStartTime) {
        const userSpeakingDuration = Date.now() - this.userSpeakingStartTime
        if (userSpeakingDuration < this.MIN_USER_SPEECH_DURATION_MS) {
          console.log(`🎤 [Agent] User speech too short (${userSpeakingDuration}ms < ${this.MIN_USER_SPEECH_DURATION_MS}ms), not interrupting - waiting for 2s continuous speech`)
          return // Don't interrupt yet - wait for 2 seconds of continuous speech
        }
        console.log(`🎤 [Agent] User has been speaking for ${userSpeakingDuration}ms (>= ${this.MIN_USER_SPEECH_DURATION_MS}ms), allowing interruption`)
      } else {
        // No user speech detected, allow stop (user might have stopped speaking already)
        console.log(`🎤 [Agent] No active user speech detected, allowing stop`)
      }
      
      await this.session.interrupt()
      this.isSpeaking = false
      this.emit('agentSpeechEnded')
    } catch (error) {
      console.error('🎤 [Agent] Error during stop():', error)
    }
  }

  /**
   * Check if agent is speaking
   */
  getIsSpeaking(): boolean {
    return this.isSpeaking
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    try {
      if (this.session) {
        await this.session.close()
        this.session = null
      }
      
      if (this.room) {
        await this.room.disconnect()
        this.room = null
      }
      
      // Clean up timeouts
      if (this.userSpeakingTimeout) {
        clearTimeout(this.userSpeakingTimeout)
        this.userSpeakingTimeout = null
      }
      
      this.userSpeakingStartTime = null
      this.lastUserSpeechTime = 0
      this.userSpeakingEndTime = null
      this.isInitialized = false
      this.emit('disconnected')
      console.log('🎤 [Agent] Disconnected and cleaned up')
    } catch (error) {
      console.error('🎤 [Agent] Error during disconnect():', error)
    }
  }
}

// Factory function
export function createInterviewAgent(config: AgentConfig): InterviewAgent {
  return new InterviewAgent(config)
}
