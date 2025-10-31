import { EventEmitter } from 'events'
import { STTService, createSTTService, STTConfig, STTTokenConfig } from './services/stt-service'
import { LLMService, createLLMService, Question, Evaluation } from './services/llm-service'
import { TTSService, createTTSService, TTSConfig } from './services/tts-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, createCodeAnalysisService, CodingProblem } from './services/code-analysis-service'

// SpeechGate: Promise-based TTS wrapper for sequencing
class SpeechGate {
  private current?: Promise<void>
  private interrupted = false

  constructor(private tts: TTSService) {}

  speak(text: string): Promise<void> {
    this.interrupted = false
    this.current = this.tts.playText(text)
    return this.current
  }

  wait(): Promise<void> {
    return this.current ?? Promise.resolve()
  }

  async stop(): Promise<void> {
    this.interrupted = true
    await this.tts.stop().catch(() => {})
  }

  wasInterrupted(): boolean {
    return this.interrupted
  }

  isSpeaking(): boolean {
    return this.tts.isCurrentlyPlaying()
  }
}

// TransitionQueue: Serialize critical actions (concurrency = 1)
class TransitionQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = () => task()
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => {}) as Promise<unknown>
    return next
  }
}

// Barge-in policy types
type BargeInPolicy = 'hard' | 'soft'
interface SpeakOptions {
  interruptible: boolean
  bargeInPolicy: BargeInPolicy
}

interface SpeakResult {
  completed: boolean
  softStopped: boolean
  interrupted: boolean
}

// Helper: Split text into sentences (currently unused, kept for potential future use)
// function splitSentences(text: string): string[] {
//   const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text]
//   return sentences.map(s => s.trim()).filter(s => s.length > 0)
// }

export interface InterviewConfig {
  stt: STTConfig | STTTokenConfig
  llm: { serverUrl: string }
  tts: TTSConfig
  codeAnalysis: { serverUrl: string }
}

export interface InterviewSession {
  id: string
  sessionId?: string // Optional session ID for tracking
  candidateId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  startTime: Date
  endTime?: Date
  status: 'scheduled' | 'in_progress' | 'completed'
  maxTheoreticalQuestions?: number
}

export class InterviewOrchestrator extends EventEmitter {
  private stt!: STTService
  private llm!: LLMService
  private tts!: TTSService
  private stateMachine: InterviewStateMachine
  private codeAnalysis!: CodeAnalysisService
  private currentSession: InterviewSession | null = null
  private isInitialized = false
  private speechGate!: SpeechGate
  private transitionQueue!: TransitionQueue
  private currentSpeakOptions?: SpeakOptions
  private softStopRequested = false
  private micPaused = false
  private suppressAutoMicResume = false

  constructor() {
    super()
    this.stateMachine = new InterviewStateMachine()
    this.setupStateMachineListeners()
  }

  async initialize(config: InterviewConfig): Promise<void> {
    try {
      // Initialize services
      this.stt = createSTTService(config.stt)
      this.llm = createLLMService(config.llm.serverUrl)
      this.tts = createTTSService(config.tts)
      this.codeAnalysis = createCodeAnalysisService(config.codeAnalysis.serverUrl)

      // Initialize SpeechGate and TransitionQueue
      this.speechGate = new SpeechGate(this.tts)
      this.transitionQueue = new TransitionQueue()

      // Set up service listeners
      this.setupServiceListeners()

      this.isInitialized = true
      console.log('Interview orchestrator initialized successfully')

    } catch (error) {
      console.error('Failed to initialize orchestrator:', error)
      throw error
    }
  }

  private setupStateMachineListeners(): void {
    // Re-emit state changes so main process can forward to renderer
    this.stateMachine.on('stateChanged', (payload: any) => {
      this.emit('stateChanged', payload)
    })

    this.stateMachine.on('introStarted', async () => {
      const result = await this.speakWithPolicy("Hello! ", {
        interruptible: true,
        bargeInPolicy: 'hard'
      })
      if (result.completed) {
        // Add a small pause after intro completes
        await this.delay(500)
        // Then transition to first question
        await this.stateMachine.transition('begin_questions')
      }
    })

    this.stateMachine.on('askQuestion', async (question: Question) => {
      this.emit('askQuestion', question)
      await this.speakQuestion(question.question)
    })

    this.stateMachine.on('askFollowUp', async (followUp: string) => {
      this.emit('askFollowUp', followUp)
      console.log('🎯 [Interview] Speaking follow-up question:', followUp.substring(0, 50))
      
      // Increment follow-up depth when asking follow-up question
      this.stateMachine.incrementFollowUpDepth()
      this.llm.incrementFollowUpDepth()
      console.log('🎯 [Interview] Follow-up depth incremented to:', this.stateMachine.getFollowUpDepth())
      
      // Follow-ups are interruptible with hard stop
      const result = await this.speakWithPolicy(followUp, {
        interruptible: true,
        bargeInPolicy: 'hard'
      })
      console.log('🎯 [Interview] Follow-up speech result:', result)
      // Only transition if completed
      if (result.completed) {
        console.log('🎯 [Interview] Follow-up completed, transitioning to follow_up_asked')
        await this.stateMachine.transition('follow_up_asked')
        // Start silence timer for automatic hints on follow-up questions (40 seconds)
        this.stateMachine.startSilenceTimer(40000)
        console.log('🎯 [Interview] Silence timer started for follow-up question')
      } else {
        console.log('🎯 [Interview] Follow-up was interrupted, not transitioning')
      }
    })

    this.stateMachine.on('codingIntroStarted', async () => {
      console.log('🎯 [Interview] Theoretical questions completed, transitioning to coding phase')
      // Speak intro to coding section
      const introText = "Great work on the theoretical questions! Now let's move to the coding section."
      const result = await this.speakWithPolicy(introText, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })
      
      // Check if we have coding problems
      if (this.currentSession?.codingProblems && this.currentSession.codingProblems.length > 0) {
        console.log(`🎯 [Interview] ${this.currentSession.codingProblems.length} coding problem(s) available`)
        // Only transition if intro completed
        if (result.completed || result.softStopped) {
          await this.delay(1000) // Small pause before presenting problem
          await this.stateMachine.transition('coding_problem_presented')
        }
      } else {
        console.log('🎯 [Interview] No coding problems, moving to wrap up')
        await this.stateMachine.transition('no_coding_problems')
      }
    })

    this.stateMachine.on('presentCodingProblem', async () => {
      const problem = this.getCurrentCodingProblem()
      if (problem) {
        this.emit('presentCodingProblem', problem)
        await this.speakCodingProblem(problem)
      }
    })

    this.stateMachine.on('provideHint', () => {
      this.handleHintProvision()
    })

    this.stateMachine.on('handlingTheoreticalHint', () => {
      this.emit('handlingTheoreticalHint')
    })

    this.stateMachine.on('handlingClarification', () => {
      this.emit('handlingClarification')
    })

    this.stateMachine.on('wrapUpStarted', (data: any) => {
      this.emit('wrapUp', data)
      this.speakWrapUp(data)
    })

    this.stateMachine.on('interviewCompleted', (data: any) => {
      this.emit('interviewCompleted', data)
      this.handleInterviewCompletion()
    })

    // Handle silence timeout for automatic hints
    this.stateMachine.on('silence_timeout', async () => {
      await this.handleSilenceTimeout()
    })
  }

  private setupServiceListeners(): void {
    this.setupSTTListeners()
    this.setupLLMListeners()
    this.setupTTSListeners()
    this.setupCodeAnalysisListeners()
  }

  private setupSTTListeners(): void {
    // STT listeners
    this.stt.on('transcript', async (transcript) => {
      // Clear silence timer as soon as user starts speaking (interim or final)
      const currentState = this.stateMachine.getState()
      if (currentState === InterviewState.WAITING_FOR_ANSWER || 
          currentState === InterviewState.THEORETICAL_QUESTION) {
        // User is speaking - clear any silence timeout
        this.stateMachine.clearSilenceTimer()
        console.log('🎯 [Interview] User is speaking - silence timer cleared')
      }
      
      // Only process final transcripts
      if (transcript.isFinal) {
        console.log('🎯 [Interview] Final transcript received:', transcript.text)
        await this.handleTranscript(transcript.text)
      }
    })

    this.stt.on('connected', () => {
      this.emit('sttConnected')
    })

    this.stt.on('disconnected', () => {
      this.emit('sttDisconnected')
    })
  }

  private setupLLMListeners(): void {
    // LLM listeners
    // NOTE: We don't listen to 'evaluation' event here because evaluations are handled
    // directly in handleTranscript() to avoid duplicate processing
    
    this.llm.on('questionChanged', (question: Question) => {
      this.emit('questionChanged', question)
    })

    this.llm.on('transitionToCoding', () => {
      this.stateMachine.transition('all_questions_done')
    })
  }

  private setupTTSListeners(): void {
    // TTS listeners
    this.tts.on('playbackStarted', () => {
      console.log('🎯 [Interview] TTS started - pausing mic')
      this.micPaused = true
      this.emit('speakingStarted')
    })

    this.tts.on('playbackCompleted', () => {
      console.log('🎯 [Interview] TTS completed - resuming mic after 250ms grace period')
      if (this.suppressAutoMicResume) {
        console.log('🎯 [Interview] Mic resume suppressed (batch speaking in progress)')
      } else {
        // Add grace period before resuming mic to avoid echo tail
        setTimeout(() => {
          this.micPaused = false
          console.log('🎯 [Interview] Mic resumed')
        }, 250)
      }
      this.emit('speakingCompleted')
    })
  }

  private setupCodeAnalysisListeners(): void {
    // Code analysis listeners
    this.codeAnalysis.on('analysisComplete', (analysis) => {
      this.emit('codeAnalysisComplete', analysis)
    })
  }

  getSessionInfo(): { sessionId: string; questionsAnswered: number; totalQuestions: number; lastActivity: string; state: string } | null {
    if (!this.currentSession) {
      return null
    }

    const progress = this.stateMachine.getProgress()
    const state = this.stateMachine.getState()

    return {
      sessionId: this.currentSession.sessionId || this.currentSession.id,
      questionsAnswered: progress.current - 1, // current is 1-indexed
      totalQuestions: progress.total,
      lastActivity: new Date().toISOString(),
      state
    }
  }

  clearSession(): void {
    console.log('🎯 [Interview] Clearing session')
    this.currentSession = null
    this.stateMachine.reset()
    this.llm.reset()
    // Stop any ongoing TTS
    if (this.speechGate) {
      this.speechGate.stop()
    }
  }

  async startInterview(session: InterviewSession & { resumeFromIndex?: number; skipIntro?: boolean }): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized')
    }

    this.currentSession = session
    this.llm.setQuestions(session.questions)
    this.stateMachine.setQuestions(session.questions, session.maxTheoreticalQuestions || 10)
    this.llm.setMaxTheoreticalQuestions(session.maxTheoreticalQuestions || 10)
    
    // Handle resume position if provided
    if (typeof session.resumeFromIndex === 'number') {
      const idx = Math.max(0, Math.min(session.resumeFromIndex, session.questions.length - 1))
      this.stateMachine.setCurrentQuestionIndex(idx)
      this.llm.setCurrentQuestionIndex(idx)
    }
    // Initialize coding problem context if provided
    if (session.codingProblems && session.codingProblems.length > 0) {
      this.codeAnalysis.setCurrentProblem(session.codingProblems[0])
    }

    try {
      // Start audio capture
      await this.startAudioCapture()

      // Start STT
      await this.stt.startListening()

      // Check if we have theoretical questions
      const hasTheoreticalQuestions = session.questions && session.questions.length > 0
      const hasCodingProblems = session.codingProblems && session.codingProblems.length > 0
      
      console.log(`🎯 [Interview] Session setup: ${session.questions?.length || 0} theoretical, ${session.codingProblems?.length || 0} coding`)

      // Begin or resume interview
      if (session.skipIntro) {
        // Skip intro; check what type of questions we have
        if (hasTheoreticalQuestions) {
          await this.stateMachine.transition('begin_questions')
        } else if (hasCodingProblems) {
          console.log('🎯 [Interview] No theoretical questions, starting directly with coding')
          // Transition directly to coding intro
          await this.stateMachine.transition('start_interview')
          await this.delay(500)
          // Manual transition since we're bypassing theoretical phase
          await this.stateMachine.setState(InterviewState.CODING_INTRO)
          this.stateMachine.emit('codingIntroStarted')
        }
      } else {
        // Normal flow - check if we have theoretical questions
        if (hasTheoreticalQuestions) {
          // Normal flow with intro and theoretical questions
          await this.stateMachine.transition('start_interview')
        } else if (hasCodingProblems) {
          // Only coding problems - skip theoretical phase entirely
          console.log('🎯 [Interview] Only coding problems, skipping theoretical section')
          const introText = "Welcome! Today we'll focus on coding problems. Let's begin."
          await this.speakWithPolicy(introText, {
            interruptible: false,
            bargeInPolicy: 'soft'
          })
          await this.delay(500)
          // Transition directly to coding intro
          await this.stateMachine.setState(InterviewState.CODING_INTRO)
          this.stateMachine.emit('codingIntroStarted')
        } else {
          throw new Error('No questions or coding problems provided')
        }
      }

    } catch (error) {
      console.error('Failed to start interview:', error)
      throw error
    }
  }

  private async startAudioCapture(): Promise<void> {
    // This would integrate with system audio capture
    // For now, we'll emit events that the renderer can handle
    this.emit('audioCaptureRequired')
  }

  async handleTranscript(text: string): Promise<void> {
    if (!this.currentSession) {
      console.log('🎯 [Interview] No active session, ignoring transcript')
      return
    }

    const currentState = this.stateMachine.getState()
    console.log('🎯 [Interview] Received transcript:', text)
    console.log('🎯 [Interview] Current state:', currentState)
    console.log('🎯 [Interview] Transcript length:', text?.length || 0)
    
    // Skip empty or very short transcripts
    if (!text || text.trim().length < 2) {
      console.log('🎯 [Interview] ⚠️ Skipping empty/short transcript:', text)
      return
    }

    // Implement barge-in: stop TTS if candidate starts speaking
    if (this.speechGate.isSpeaking()) {
      console.log('🎯 [Interview] 🛑 Barge-in detected!')
      if (this.currentSpeakOptions) {
        if (this.currentSpeakOptions.bargeInPolicy === 'soft') {
          console.log('🎯 [Interview] Soft stop requested (finish current sentence)')
          this.softStopRequested = true
        } else {
          console.log('🎯 [Interview] Hard stop requested (stop immediately)')
          await this.speechGate.stop()
        }
      } else {
        // Default to hard stop if no options set
        await this.speechGate.stop()
      }
      this.stateMachine.clearSilenceTimer()
    }
    
    if (currentState === InterviewState.WAITING_FOR_ANSWER || currentState === InterviewState.THEORETICAL_QUESTION) {
      console.log('🎯 [Interview] ✅ Processing transcript with LLM:', text)
      // Clear silence timer since candidate is speaking
      this.stateMachine.clearSilenceTimer()
      
      // Check if we're in follow-up mode
      const followUpDepth = this.stateMachine.getFollowUpDepth()
      const currentState = this.stateMachine.getState()
      console.log('🎯 [Interview] Follow-up depth:', followUpDepth, 'State:', currentState)
      
      let response: any
      
      // First, detect intent to check if this is a hint/clarification request
      console.log('🎯 [Interview] Detecting intent for transcript:', text)
      const intent = await this.llm.detectIntent(text)
      console.log('🎯 [Interview] Detected intent:', intent)
      
      // Handle hint requests with unified escalation (combined with silence timeouts)
      if (intent.intent === 'hint_request') {
        console.log('🎯 [Interview] ✨ Handling hint request')
        const hintEvents = this.stateMachine.incrementHintEventCount()
        console.log('🎯 [Interview] Combined hint event count:', hintEvents)

        const currentQuestion = this.llm.getCurrentQuestion()
        if (!currentQuestion) {
          return
        }

        if (hintEvents === 1) {
          // First hint: provide hint at current level and restart silence timer
          await this.stateMachine.transition('hint_requested')
          const hintLevel = this.stateMachine.getHintLevel()
          console.log('🎯 [Interview] Providing hint at level:', hintLevel)
          // Use generateTheoreticalHint to respect hint level (same as silence timeout)
          const hintText = await this.llm.generateTheoreticalHint(currentQuestion, hintLevel)
          const result = await this.speakWithPolicy(hintText, {
            interruptible: true,
            bargeInPolicy: 'hard'
          })
          if (result.completed) {
            await this.stateMachine.transition('hint_provided')
            this.emit('hintProvided', hintText)
            // Increase hint level for subsequent escalation
            this.stateMachine.incrementHintLevel()
            this.stateMachine.startSilenceTimer(40000)
          }
          return
        }

        // Second or more: provide answer and move to next question (no second hint)
        const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
        const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
        console.log('🎯 [Interview] Second hint event (verbal) - providing answer and moving to next question')
        await this.speakWithPolicy(finalPrompt, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
        await this.forceMoveToNextQuestion()
        return
      }
      
      // Handle clarification requests with escalation
      if (intent.intent === 'clarification_request') {
        console.log('🎯 [Interview] ❓ Handling clarification request')
        const clarifyCount = this.stateMachine.incrementClarificationRequestCount()
        console.log('🎯 [Interview] Clarification request count:', clarifyCount)

        if (clarifyCount === 1) {
          // First time: provide clarification and restart silence timer
          await this.stateMachine.transition('clarification_requested')
          response = await this.llm.handleClarificationRequest()
          if (response && response.text) {
            const result = await this.speakWithPolicy(response.text, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            if (result.completed) {
              await this.stateMachine.transition('clarification_provided')
              this.stateMachine.startSilenceTimer(40000)
            }
          }
          return
        }

        // Second or more: provide answer and move to next
        const currentQuestion = this.llm.getCurrentQuestion()
        if (currentQuestion) {
          const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
          const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
          await this.speakWithPolicy(finalPrompt, {
            interruptible: false,
            bargeInPolicy: 'soft'
          })
          await this.forceMoveToNextQuestion()
        }
        return
      }
      
      // Check if we're in follow-up mode by looking at state or follow-up depth
      if (followUpDepth > 0 || currentState === InterviewState.FOLLOW_UP) {
        // We're evaluating a follow-up answer - use special follow-up evaluation
        console.log('🎯 [Interview] Evaluating follow-up answer with full context')
        const currentEvaluation = this.stateMachine.getCurrentEvaluation()
        const originalQuestion = this.llm.getCurrentQuestion()
        
        console.log('🎯 [Interview] Follow-up context:', {
          currentEvaluation: currentEvaluation ? 'present' : 'missing',
          originalQuestion: originalQuestion ? 'present' : 'missing',
          followUpQuestion: currentEvaluation?.followUpQuestion || 'missing'
        })
        
        if (currentEvaluation && originalQuestion) {
          response = await this.llm.evaluateFollowUpAnswer(
            originalQuestion,
            currentEvaluation.candidateAnswer,
            currentEvaluation.followUpQuestion || '',
            text,
            followUpDepth
          )
        } else {
          // Fallback to regular processing if context is missing
          console.log('🎯 [Interview] Missing context, falling back to regular evaluation')
          response = await this.llm.processTranscript(text)
        }
      } else {
        // Regular answer evaluation
        console.log('🎯 [Interview] Regular answer evaluation')
        response = await this.llm.processTranscript(text)
      }
      
      console.log('🎯 [Interview] LLM response:', response)
      
      if (response.action === 'speak' && response.text) {
        console.log('🎯 [Interview] 🗣️ Speaking LLM response:', response.text)
        await this.speakWithPolicy(response.text, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })

        // Treat generic 'speak' responses during theoretical phase as normal conversation
        const chitChatCount = this.stateMachine.incrementNormalConversationCount()
        console.log('🎯 [Interview] Chit-chat count for current question:', chitChatCount)

        if (chitChatCount === 2) {
          const nudge = "Let's focus on the question. Please share your answer. You can also ask for a hint, or say 'I don't know' if you're unsure."
          await this.speakWithPolicy(nudge, {
            interruptible: true,
            bargeInPolicy: 'hard'
          })
          // Restart silence timer after nudge
          this.stateMachine.startSilenceTimer(40000)
          return
        }

        if (chitChatCount >= 3) {
          console.log('🎯 [Interview] Chit-chat limit reached, providing answer and moving to next question')
          const currentQuestion = this.llm.getCurrentQuestion()
          if (currentQuestion) {
            const answerText = currentQuestion.expectedAnswer || 'Let me provide a concise answer based on best practices.'
            const finalPrompt = `Here's a concise answer: ${answerText}. Let's move to the next question.`
            await this.speakWithPolicy(finalPrompt, {
              interruptible: false,
              bargeInPolicy: 'soft'
            })

            // Force progression to next question (bypass evaluation)
            await this.forceMoveToNextQuestion()
            return
          }
        }
        
        // Check if this is a positive acknowledgement after clarification/hint
        // If so, we should create an evaluation and move to next question
        const lowerText = response.text.toLowerCase()
        const isPositiveAck = lowerText.includes('correct') || 
                             lowerText.includes('good job') || 
                             lowerText.includes('well done') ||
                             lowerText.includes('excellent') ||
                             lowerText.includes('great') ||
                             (lowerText.includes('right') && !lowerText.includes('not right'))
        
        if (isPositiveAck && currentState === InterviewState.WAITING_FOR_ANSWER) {
          console.log('🎯 [Interview] Detected positive acknowledgement, creating evaluation to progress')
          const currentQuestion = this.llm.getCurrentQuestion()
          
          if (currentQuestion) {
            // Create a basic evaluation to allow progression
            const basicEvaluation: Evaluation = {
              questionId: currentQuestion.id,
              candidateAnswer: text,
              keyPointsCovered: [],
              score: 70, // Default passing score
              needsFollowUp: false,
              followUpQuestion: undefined,
              feedback: response.text
            }
            
            console.log('🎯 [Interview] Created basic evaluation for progression')
            await this.handleEvaluation(basicEvaluation)
          }
        }
      } else if (response.action === 'hint' && response.text) {
        console.log('🎯 [Interview] 💡 Providing hint:', response.text)
        // First transition to hint handling state
        await this.stateMachine.transition('hint_requested')
        
        const result = await this.speakWithPolicy(response.text, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
        // Only transition back to waiting if completed
        if (result.completed) {
          await this.stateMachine.transition('hint_provided')
        }
      } else if (response.action === 'clarification' && response.text) {
        console.log('🎯 [Interview] ❓ Providing clarification:', response.text)
        // First transition to clarification handling state
        await this.stateMachine.transition('clarification_requested')
        
        const result = await this.speakWithPolicy(response.text, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
        // Only transition back to waiting if completed
        if (result.completed) {
          await this.stateMachine.transition('clarification_provided')
        }
      } else if (response.action === 'evaluate' && response.evaluation) {
        console.log('🎯 [Interview] 📊 Handling evaluation:', response.evaluation)
        await this.handleEvaluation(response.evaluation)
      }
    } else if (currentState === InterviewState.MONITORING_CODE || currentState === InterviewState.CODING_PROBLEM) {
      // During coding phase - interactive discussion about approach
      console.log('🎯 [Interview] 💻 Processing coding phase interaction:', text)
      
      const problem = this.getCurrentCodingProblem()
      if (!problem) {
        console.log('🎯 [Interview] No current coding problem found')
        return
      }

      // Use LLM to evaluate approach or handle clarification
      try {
        const response = await this.codeAnalysis.evaluateApproach(text, problem)
        
        console.log('🎯 [Interview] 💡 Approach evaluation:', response)
        
        if (response.isApproach) {
          // Candidate is explaining their approach
          if (response.isCorrect) {
            // Correct approach - encourage
            const feedback = response.feedback || "That's a solid approach! Go ahead and implement it."
            await this.speakWithPolicy(feedback, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
          } else {
            // Wrong approach - provide minor hint
            const feedback = response.feedback || "Hmm, that approach might have some issues. Think about the edge cases and constraints."
            await this.speakWithPolicy(feedback, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
          }
        } else if (response.isClarification) {
          // Candidate asking clarifying question
          const clarification = response.clarification || "Let me clarify - check the problem description for those details."
          await this.speakWithPolicy(clarification, {
            interruptible: true,
            bargeInPolicy: 'hard'
          })
        } else {
          // General conversation during coding
          const acknowledgement = "I understand. Keep working on your solution."
          await this.speakWithPolicy(acknowledgement, {
            interruptible: true,
            bargeInPolicy: 'hard'
          })
        }
        
        console.log('🎯 [Interview] ✅ Coding interaction handled, waiting for code or submit')
      } catch (error) {
        console.error('🎯 [Interview] Error evaluating approach:', error)
        // Fallback response
        await this.speakWithPolicy("I see. Continue with your implementation.", {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
      }
    } else {
      console.log('🎯 [Interview] ⚠️ Not in listening state, ignoring transcript. Current state:', currentState)
    }
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    // Enqueue evaluation handling to ensure sequentiality
    return this.transitionQueue.enqueue(async () => {
      console.log('🎯 [Interview] Processing evaluation in queue')
      // Ensure we are in evaluating state before applying evaluation-driven transitions
      const currentStateBeforeEval = this.stateMachine.getState()
      if (currentStateBeforeEval === InterviewState.WAITING_FOR_ANSWER) {
        await this.stateMachine.transition('candidate_finished_speaking')
      }
      
      // Add evaluation to state machine
      this.stateMachine.addEvaluation(evaluation)
      
      // Emit evaluation event
      this.emit('evaluation', evaluation)

      // Update LLM service with current state
      this.llm.setFollowUpDepth(this.stateMachine.getFollowUpDepth())
      this.llm.setMaxTheoreticalQuestions(this.stateMachine.getMaxTheoreticalQuestions())

      // Wait for any current TTS to complete before making transitions
      console.log('🎯 [Interview] Waiting for speech to complete...')
      await Promise.race([
        this.speechGate.wait(),
        new Promise(resolve => setTimeout(resolve, 10000)) // 10s timeout
      ])
      console.log('🎯 [Interview] Speech completed, proceeding with transition')

      // Speak feedback if available
      if (evaluation.feedback && evaluation.feedback.trim().length > 0) {
        console.log('🎯 [Interview] 💬 Speaking feedback:', evaluation.feedback.substring(0, 50) + '...')
        await this.speakWithPolicy(evaluation.feedback, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
      }

      // Decide next action based on new criteria
      console.log('🎯 [Interview] Evaluation decision:', {
        needsFollowUp: evaluation.needsFollowUp,
        canAskFollowUp: this.stateMachine.canAskFollowUp(),
        followUpDepth: this.stateMachine.getFollowUpDepth(),
        totalTheoretical: this.stateMachine.getTotalTheoreticalQuestions(),
        maxTheoretical: this.stateMachine.getMaxTheoreticalQuestions(),
        hasReachedLimit: this.stateMachine.hasReachedTheoreticalLimit()
      })
      
      if (evaluation.needsFollowUp && this.stateMachine.canAskFollowUp()) {
        // Increment total questions (follow-up depth will be incremented when question is asked)
        this.stateMachine.incrementTotalTheoreticalQuestions()
        
        console.log('🎯 [Interview] Transitioning to needs_follow_up')
        await this.stateMachine.transition('needs_follow_up')
      } else {
        // Check if we just finished a follow-up (followUpDepth > 0)
        const currentFollowUpDepth = this.stateMachine.getFollowUpDepth()
        
        // Reset follow-up depth for next question
        this.stateMachine.resetFollowUpDepth()
        this.llm.resetFollowUpDepth()
        
        // If we were in a follow-up, we've now completed the original question + follow-ups
        // So we should move to the next question
        // If we weren't in a follow-up, we just completed a regular question
        // Either way, move to next question or coding
        
        if (this.stateMachine.hasReachedTheoreticalLimit()) {
          console.log('🎯 [Interview] Reached theoretical limit, transitioning to all_questions_done')
          await this.stateMachine.transition('all_questions_done')
        } else {
          console.log('🎯 [Interview] Moving to next_question (was in follow-up:', currentFollowUpDepth > 0, ')')
          // Increment question index in both state machine and LLM service before transitioning
          this.stateMachine.moveToNextQuestion()
          this.llm.moveToNextQuestion()
          await this.stateMachine.transition('next_question')
        }
      }
    })
  }

  // Force progression to the next question without a normal evaluation
  private async forceMoveToNextQuestion(): Promise<void> {
    // Ensure consistent state transitions
    const currentState = this.stateMachine.getState()
    if (currentState === InterviewState.WAITING_FOR_ANSWER) {
      await this.stateMachine.transition('candidate_finished_speaking')
    }

    // Reset per-question counters/depth
    this.stateMachine.resetFollowUpDepth()
    this.llm.resetFollowUpDepth()

    // Move to next or coding if limit reached
    if (this.stateMachine.hasReachedTheoreticalLimit()) {
      await this.stateMachine.transition('all_questions_done')
      return
    }

    this.stateMachine.moveToNextQuestion()
    this.llm.moveToNextQuestion()
    await this.stateMachine.transition('next_question')
  }

  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }): Promise<any> {
    if (!this.currentSession) {
      throw new Error('No active interview session')
    }

    try {
      const problem = this.codeAnalysis.getCurrentProblem() || this.currentSession?.codingProblems?.find(p => p.id === codeData.problemId) || null
      if (!problem) {
        throw new Error('No coding problem context')
      }

      const analysis = await this.codeAnalysis.analyzeCode(codeData.code, problem)

      // If stuck, proactively provide a hint
      if (analysis.isStuck) {
        const hintText = await this.codeAnalysis.getHint(problem, codeData.code)
        const result = await this.speakWithPolicy(hintText, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
        if (result.completed) {
          this.emit('hintProvided', hintText)
        }
      }

      return analysis

    } catch (error) {
      console.error('Code analysis error:', error)
      throw error
    }
  }

  async submitCodingSolution(code: string): Promise<{success: boolean, feedback: string, hasNextProblem: boolean}> {
    if (!this.currentSession) {
      throw new Error('No active interview session')
    }

    try {
      const problem = this.codeAnalysis.getCurrentProblem()
      if (!problem) {
        throw new Error('No current coding problem')
      }

      console.log('🎯 [Interview] 📝 Candidate submitted solution for:', problem.title)

      // Analyze the submitted code
      const analysis = await this.codeAnalysis.analyzeCode(code, problem)
      
      // Provide feedback
      let feedback = ''
      if (analysis.approach === 'correct' && analysis.progress >= 80) {
        feedback = "Great work! Your solution looks good. Let's move on."
      } else if (analysis.progress >= 50) {
        feedback = "You're on the right track, but there are some issues. " + (analysis.issues[0] || "Review your logic.")
      } else {
        feedback = "This needs more work. " + (analysis.suggestedHint || "Think about the problem requirements again.")
      }

      await this.speakWithPolicy(feedback, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })

      // Check if there are more coding problems
      const codingProblems = this.currentSession.codingProblems || []
      const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
      const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1

      if (hasNextProblem && analysis.progress >= 70) {
        // Move to next problem
        const nextProblem = codingProblems[currentProblemIndex + 1]
        this.codeAnalysis.setCurrentProblem(nextProblem)
        console.log('🎯 [Interview] Moving to next coding problem:', nextProblem.title)
        
        // Present next problem
        await this.delay(1000)
        await this.speakCodingProblem(nextProblem)
        this.emit('presentCodingProblem', nextProblem)
      } else if (!hasNextProblem && analysis.progress >= 70) {
        // All coding problems done
        console.log('🎯 [Interview] All coding problems completed')
        await this.delay(1000)
        await this.stateMachine.transition('solution_complete')
      }

      return {
        success: analysis.progress >= 70,
        feedback,
        hasNextProblem: hasNextProblem && analysis.progress >= 70
      }

    } catch (error) {
      console.error('Error submitting solution:', error)
      throw error
    }
  }

  private async speakWithPolicy(text: string, opts: SpeakOptions): Promise<SpeakResult> {
    try {
      this.currentSpeakOptions = opts
      this.softStopRequested = false
      // Suppress automatic mic resume between sentences; resume once after the whole batch
      this.suppressAutoMicResume = true
      this.micPaused = true
      this.emit('speakingStarted')

      // Always send entire text as one TTS call to avoid delays between sentences
      console.log(`🎯 [Speech] Speaking full text with policy:`, opts)
      await this.speechGate.speak(text)
      await this.speechGate.wait()

      const interrupted = this.speechGate.wasInterrupted()
      const softStopped = this.softStopRequested
      const completed = !interrupted && !softStopped

      // Manually resume mic once at the end of batch (if not interrupted early)
      setTimeout(() => {
        this.micPaused = false
        console.log('🎯 [Interview] Mic resumed (batch complete)')
      }, 250)

      this.emit('speakingCompleted')
      this.currentSpeakOptions = undefined
      this.suppressAutoMicResume = false

      return { completed, softStopped, interrupted }

    } catch (error) {
      console.error('TTS error:', error)
      this.emit('ttsError', error)
      this.emit('speakingCompleted')
      this.currentSpeakOptions = undefined
      this.suppressAutoMicResume = false
      return { completed: false, softStopped: false, interrupted: true }
    }
  }

  private async speakQuestion(question: string): Promise<void> {
    // Question stems use soft barge-in (must-deliver)
    const result = await this.speakWithPolicy(question, {
      interruptible: false,
      bargeInPolicy: 'soft'
    })

    // Only transition to waiting_for_answer if completed or soft-stopped
    if (result.completed || result.softStopped) {
      if (this.stateMachine.getState() === InterviewState.THEORETICAL_QUESTION) {
        await this.stateMachine.transition('question_asked')
      }
      // Start silence timer for automatic hints (40 seconds)
      this.stateMachine.startSilenceTimer(40000)
    }
  }

  private async handleSilenceTimeout(): Promise<void> {
    const currentState = this.stateMachine.getState()
    console.log('🎯 [Interview] Silence timeout detected in state:', currentState)
    
    // Only provide hints during theoretical questions or waiting for answers
    if (currentState === InterviewState.THEORETICAL_QUESTION || currentState === InterviewState.WAITING_FOR_ANSWER) {
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        // Use unified hint event counter for silence too
        const hintEvents = this.stateMachine.incrementHintEventCount()
        console.log('🎯 [Interview] Combined hint event count (silence):', hintEvents)
        
        try {
          if (hintEvents === 1) {
            // First silence: provide a hint
            const hintLevel = this.stateMachine.getHintLevel()
            console.log('🎯 [Interview] First hint event (silence) - providing hint at level:', hintLevel)
            const hintText = await this.llm.generateTheoreticalHint(currentQuestion, hintLevel)
            const result = await this.speakWithPolicy(hintText, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            if (result.completed) {
              this.emit('hintProvided', hintText)
              // Increment hint level for potential subsequent hint
              this.stateMachine.incrementHintLevel()
              // Restart timer for potential second silence
              this.stateMachine.startSilenceTimer(40000)
            }
          } else {
            // Second hint-related event: provide answer and move on (no second hint)
            const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
            const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
            console.log('🎯 [Interview] Second hint event (silence) - providing answer and moving to next question')
            await this.speakWithPolicy(finalPrompt, {
              interruptible: false,
              bargeInPolicy: 'soft'
            })
            // Do not restart silence timer; progress to next
            await this.forceMoveToNextQuestion()
          }
        } catch (error) {
          console.error('Error providing automatic hint:', error)
        }
      }
    }
  }

  private async speakCodingProblem(problem: CodingProblem): Promise<void> {
    // Simple intro - problem details shown in editor
    const intro = "Please solve this problem. You can see the details on your screen."
    const result = await this.speakWithPolicy(intro, {
      interruptible: false,
      bargeInPolicy: 'soft'
    })
    
    // Set the problem in code analysis
    this.codeAnalysis.setCurrentProblem(problem)
    
    // Only transition if completed or soft-stopped
    if (result.completed || result.softStopped) {
      await this.stateMachine.transition('coding_problem_presented')
    }
  }

  private async handleHintProvision(): Promise<void> {
    const last = this.codeAnalysis.getObservations().slice(-1)[0]
    const problem = this.codeAnalysis.getCurrentProblem() || (this.currentSession?.codingProblems?.[0] ?? null)
    if (last && problem && last.analysis.isStuck) {
      const hintText = await this.codeAnalysis.getHint(problem, last.code)
      // Coding hints are interruptible with hard stop
      const result = await this.speakWithPolicy(hintText, {
        interruptible: true,
        bargeInPolicy: 'hard'
      })
      if (result.completed) {
        this.emit('hintProvided', hintText)
      }
    }
  }

  private async speakWrapUp(data: any): Promise<void> {
    const summary = this.codeAnalysis.getSessionSummary()
    const wrapUpText = `Thank you for completing the interview! Your theoretical score was ${data.finalScore?.toFixed(1) || 'N/A'}%. The coding section took ${Math.round(summary.totalTime / 1000)} seconds. Great work!`
    // Wrap-up is interruptible with hard stop
    await this.speakWithPolicy(wrapUpText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    })
  }

  private async handleInterviewCompletion(): Promise<void> {
    if (this.currentSession) {
      this.currentSession.endTime = new Date()
      this.currentSession.status = 'completed'
      
      // Stop services
      await this.stt.stopListening()
      await this.tts.stopAudio()
      
      this.emit('interviewCompleted', this.currentSession)
    }
  }

  // Public methods for external control
  getCurrentState(): InterviewState {
    return this.stateMachine.getState()
  }

  getCurrentQuestion(): Question | null {
    return this.llm.getCurrentQuestion()
  }

  getProgress(): { current: number, total: number } {
    return this.llm.getProgress()
  }

  getCurrentCodingProblem(): CodingProblem | null {
    return this.codeAnalysis.getCurrentProblem()
  }

  getSession(): InterviewSession | null {
    return this.currentSession
  }

  async pauseInterview(): Promise<void> {
    await this.tts.stopAudio()
    this.emit('interviewPaused')
  }

  async resumeInterview(): Promise<void> {
    this.emit('interviewResumed')
  }

  async stopInterview(): Promise<void> {
    if (this.currentSession) {
      await this.handleInterviewCompletion()
    }
  }

  // Update STT service with new token
  async updateSTTToken(token: string): Promise<void> {
    try {
      // Stop current STT service if running
      if (this.stt.isListening()) {
        await this.stt.stopListening()
      }

      // Create new STT service with token
      this.stt = createSTTService({
        provider: 'assemblyai',
        token,
        sampleRate: 16000,
        language: 'en'
      })

      // Set up listeners for new service
      this.setupSTTListeners()

      console.log('🎤 [Main] STT service updated with new token')
    } catch (error) {
      console.error('Failed to update STT token:', error)
      throw error
    }
  }

  // Audio capture integration (to be implemented with system audio)
  streamAudio(audioChunk: Buffer): void {
    // Drop audio chunks when mic is paused (during TTS + grace period)
    if (this.micPaused) {
      return
    }
    
    if (this.stt.isListening()) {
      this.stt.streamAudio(audioChunk)
    }
  }

  // Clean up resources
  destroy(): void {
    this.stt?.stopListening()
    this.tts?.destroy()
    this.codeAnalysis?.reset()
    this.currentSession = null
    this.isInitialized = false
  }

  // Utility method for delays
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
