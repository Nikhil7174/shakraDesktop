import { EventEmitter } from 'events'
import { LLMService, createLLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, createCodeAnalysisService, CodingProblem } from './services/code-analysis-service'
import { FinalEvaluationPayload, ConversationMessage } from '../shared/types'
import { createFinalEvaluationPayload } from './utils/final-evaluation'
import { InterviewAgent } from './services/livekit-agent'
import { InterviewEngine, SpeakRequest } from './interview-session'

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

type ResponseKind = 'hint' | 'clarification' | 'answer' | 'prompt' | 'system' | 'feedback'

interface SpeechContext {
  kind: ResponseKind
  priority: 'manual' | 'auto'
  source?: string
}

// Helper: Split text into sentences (currently unused, kept for potential future use)
// function splitSentences(text: string): string[] {
//   const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text]
//   return sentences.map(s => s.trim()).filter(s => s.length > 0)
// }

export interface InterviewConfig {
  llm: { serverUrl: string }
  codeAnalysis: { serverUrl: string }
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
    openaiApiKey: string
    sttProvider?: 'assemblyai' | 'openai' | 'whisper'
    sttApiKey?: string
    llmModel?: string
    ttsVoice?: string
    ttsModel?: string
  }
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
  private llm!: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis!: CodeAnalysisService
  // Business-only engine (evaluation, question flow, etc.)
  private engine!: InterviewEngine
  private currentSession: InterviewSession | null = null
  private isInitialized = false
  private transitionQueue!: TransitionQueue
  private currentSpeakOptions?: SpeakOptions
  private softStopRequested = false
  private livekitAgent: InterviewAgent | null = null
  private autoHintInProgress = false // Track if auto-hint is currently being generated
  private userSpeaking = false
  private liveTranscriptTimeout: NodeJS.Timeout | null = null
  private hadTheoreticalQuestions = false // Track if session had theoretical questions
  private currentCode: string = '' // Store latest code from editor for manual hint requests
  private manualResponseInFlight: { kind: ResponseKind; source: string; startedAt: number } | null = null
  private currentSpeechContext: SpeechContext | null = null
  // Track hint/clarification requests and user speech for auto-hint conditions (reset every 60s interval)
  private currentIntervalHasHintClarification: boolean = false // Track if any hint/clarification requested in current 60s interval
  private currentIntervalHasSubstantialSpeech: boolean = false // Track if any substantial speech (>70 chars) in current 60s interval
  private pendingSecurityWarning: string | null = null // Queue for security warnings while other TTS is playing
  private isSecurityWarningInProgress = false // Flag to prevent concurrent security warning TTS
  private skipConfirmationResolve: ((confirmed: boolean) => void) | null = null // For skip question confirmation
  // Track interruption retries per question (resets for each new question)
  private questionInterruptionRetries: number = 0 // Tracks how many times current question was interrupted
  private currentQuestionText: string | null = null // Store current question text for retry
  // Centralized conversation history manager
  // Maintains full conversation history throughout the interview
  private fullConversationHistory: ConversationMessage[] = []
  
  // Track coding conversations per problem (for structured access)
  private codingProblemConversations: Array<{
    problemId: string
    problem: CodingProblem
    conversation: ConversationMessage[]
    finalCode?: string
    timeComplexity?: string
    spaceComplexity?: string
    codeAnalysisHistory: any[]
    submittedAt?: Date
    evaluation?: {
      score: number
      feedback: string
      testResults?: Array<{
        passed: boolean
        input: string
        expectedOutput: string
        actualOutput: string
      }>
    }
  }> = []
  private allEvaluations: Evaluation[] = []
  private visionSecurityWarnings: any = {} // Store warning stats from renderer
  
  // Track current problem/question for organizing conversations
  private currentProblemId: string | null = null
  private currentQuestionId: string | null = null
  
  // Track if final evaluation payload has been sent to prevent premature clearing
  private payloadSent: boolean = false

  constructor() {
    super()
    this.stateMachine = new InterviewStateMachine()
    this.setupStateMachineListeners()
  }

  /**
   * Centralized method to add messages to conversation history
   * This maintains a single source of truth for all conversation messages
   * @deprecated Currently unused - kept for future use
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _addToConversationHistory(
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata: ConversationMessage['metadata']
  ): void {
    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        questionId: metadata.questionId || this.currentQuestionId || undefined,
        codingProblemId: metadata.codingProblemId || this.currentProblemId || undefined,
        section: metadata.section || (this.currentProblemId ? 'coding' : 'theoretical')
      }
    }
    
    this.fullConversationHistory.push(message)
    console.log(`💬 [ConversationHistory] Added ${role} message (${metadata.type || 'unknown'}), total: ${this.fullConversationHistory.length}`)
  }

  /**
   * Get full conversation history (chronological)
   */
  getFullConversationHistory(): ConversationMessage[] {
    return [...this.fullConversationHistory]
  }

  /**
   * Get conversation history for a specific problem
   */
  getProblemConversationHistory(problemId: string): ConversationMessage[] {
    return this.fullConversationHistory.filter(
      msg => msg.metadata.codingProblemId === problemId
    )
  }

  /**
   * Get conversation history for a specific question
   */
  getQuestionConversationHistory(questionId: string): ConversationMessage[] {
    return this.fullConversationHistory.filter(
      msg => msg.metadata.questionId === questionId
    )
  }

  /**
   * Sync conversation history from services to centralized store
   * This ensures we capture all messages even if services reset their history
   */
  private syncConversationHistoryFromServices(): void {
    // Sync from LLM service (theoretical questions)
    const llmHistory = this.llm.getConversationHistory()
    llmHistory.forEach(msg => {
      // Check if message already exists (by timestamp and content)
      const exists = this.fullConversationHistory.some(
        existing => existing.timestamp === msg.timestamp && 
                   existing.content === msg.content &&
                   existing.role === msg.role
      )
      if (!exists) {
        this.fullConversationHistory.push(msg)
        // Update current question ID if this is a question message
        if (msg.metadata.questionId) {
          this.currentQuestionId = msg.metadata.questionId
        }
      }
    })

    // Sync from CodeAnalysis service (coding problems)
    const codeAnalysisHistory = this.codeAnalysis.getConversationHistory()
    const currentProblemInCodeAnalysis = this.codeAnalysis.getCurrentProblem()
    const finalSubmission = this.codeAnalysis.getFinalSubmission()
    
    codeAnalysisHistory.forEach(msg => {
      // First, ensure codingProblemId is set (needed for duplicate detection)
      // If message doesn't have codingProblemId but we have a current problem, add it
      if (!msg.metadata.codingProblemId && currentProblemInCodeAnalysis) {
        console.log('🔧 [ConversationHistory] Adding missing codingProblemId to message:', msg.metadata.type, 'for problem:', currentProblemInCodeAnalysis.id)
        msg.metadata.codingProblemId = currentProblemInCodeAnalysis.id
      }
      
      // If message still doesn't have codingProblemId but we're tracking one, use that
      if (!msg.metadata.codingProblemId && this.currentProblemId) {
        console.log('🔧 [ConversationHistory] Using tracked currentProblemId for message:', this.currentProblemId)
        msg.metadata.codingProblemId = this.currentProblemId
      }
      
      // For question messages, check for duplicates by problem ID and type (not just timestamp)
      // This prevents the same question from being added twice even if timestamps differ
      let existingIndex = -1
      if (msg.metadata.type === 'question' && msg.metadata.codingProblemId) {
        // Check if a question for this problem already exists
        // First check by problem ID and role
        existingIndex = this.fullConversationHistory.findIndex(
          existing => existing.metadata.type === 'question' &&
                     existing.metadata.codingProblemId === msg.metadata.codingProblemId &&
                     existing.role === msg.role
        )
        
        // If not found by problem ID, also check by content similarity (for cases where codingProblemId might not be set)
        // Check if content starts with "Let's work on:" and has similar title
        if (existingIndex === -1 && msg.content.startsWith("Let's work on:")) {
          const titleMatch = msg.content.match(/Let's work on:\s*([^\n.]+)/)
          if (titleMatch) {
            const questionTitle = titleMatch[1].trim()
            existingIndex = this.fullConversationHistory.findIndex(
              existing => existing.metadata.type === 'question' &&
                         existing.role === msg.role &&
                         existing.content.startsWith("Let's work on:") &&
                         existing.content.includes(questionTitle)
            )
          }
        }
        
        if (existingIndex !== -1) {
          console.log('🔧 [ConversationHistory] Duplicate coding question detected for problem:', msg.metadata.codingProblemId || 'unknown', '- skipping')
        }
      }
      
      // If not found by problem ID or content, check by timestamp and exact content (for other message types)
      if (existingIndex === -1) {
        existingIndex = this.fullConversationHistory.findIndex(
          existing => existing.timestamp === msg.timestamp && 
                     existing.content === msg.content &&
                     existing.role === msg.role
        )
      }
      
      if (existingIndex === -1) {
        // New message - add it
        
        // For code submission messages, ensure TC/SC is in metadata
        if (msg.metadata.type === 'code_submission') {
          const metadata = msg.metadata as any
          // If TC/SC is missing from metadata but we have it in finalSubmission, add it
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            console.log('🔧 [ConversationHistory] Adding missing timeComplexity to code submission message')
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            console.log('🔧 [ConversationHistory] Adding missing spaceComplexity to code submission message')
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        this.fullConversationHistory.push(msg)
        // Update current problem ID if this is a problem message
        if (msg.metadata.codingProblemId) {
          this.currentProblemId = msg.metadata.codingProblemId
        }
      } else {
        // Message already exists - update metadata if needed (especially for code submissions)
        const existing = this.fullConversationHistory[existingIndex]
        if (existing.metadata.type === 'code_submission' && msg.metadata.type === 'code_submission') {
          const existingMetadata = existing.metadata as any
          const newMetadata = msg.metadata as any
          
          // Update TC/SC if missing in existing but present in new
          if (!existingMetadata.timeComplexity && newMetadata.timeComplexity) {
            console.log('🔧 [ConversationHistory] Updating existing message with timeComplexity')
            existingMetadata.timeComplexity = newMetadata.timeComplexity
          }
          if (!existingMetadata.spaceComplexity && newMetadata.spaceComplexity) {
            console.log('🔧 [ConversationHistory] Updating existing message with spaceComplexity')
            existingMetadata.spaceComplexity = newMetadata.spaceComplexity
          }
          
          // Also check finalSubmission as fallback
          if (!existingMetadata.timeComplexity && finalSubmission.timeComplexity) {
            console.log('🔧 [ConversationHistory] Adding timeComplexity from finalSubmission to existing message')
            existingMetadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!existingMetadata.spaceComplexity && finalSubmission.spaceComplexity) {
            console.log('🔧 [ConversationHistory] Adding spaceComplexity from finalSubmission to existing message')
            existingMetadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
      }
    })

    // Sort by timestamp to maintain chronological order
    this.fullConversationHistory.sort((a, b) => a.timestamp - b.timestamp)
  }

  async initialize(config: InterviewConfig): Promise<void> {
    try {
      // Initialize services
      this.llm = createLLMService(config.llm.serverUrl)
      this.codeAnalysis = createCodeAnalysisService(config.codeAnalysis.serverUrl)

      this.engine = new InterviewEngine({
        llm: this.llm,
        stateMachine: this.stateMachine,
        codeAnalysis: this.codeAnalysis,
        getCurrentCodingProblem: () => this.getCurrentCodingProblem(),
        getConversationHistory: () => this.fullConversationHistory,
        addConversationMessage: (role, text, metadata) => {
          if (metadata.section === 'coding') {
            this.codeAnalysis.addConversationMessage(role, text, metadata)
          } else {
            this.llm.addConversationMessage(role, text, metadata)
          }
        },
        syncConversationHistoryFromServices: () => this.syncConversationHistoryFromServices(),
        getCurrentSession: () => this.currentSession,
        getFullConversationHistory: () => this.fullConversationHistory,
        getCodingProblemConversations: () => this.codingProblemConversations,
        getAllEvaluations: () => this.allEvaluations,
        getProblemConversationHistory: (problemId) => this.getProblemConversationHistory(problemId),
        userSpeaking: () => this.userSpeaking,
        autoHintInProgress: () => this.autoHintInProgress,
        setAutoHintInProgress: (value) => { this.autoHintInProgress = value; },
        shouldSkipAutoResponse: (trigger) => this.shouldSkipAutoResponse(trigger),
        withManualResponse: (kind, source, handler) => this.withManualResponse(kind, source, handler),
        currentCode: () => this.currentCode,
        setCurrentCode: (code) => { this.currentCode = code; },
        speakRequested: async (text, options, context) => {
          return await this.speakWithPolicy(text, options, context)
        },
        interruptAutoSpeech: (reason) => this.interruptAutoSpeech(reason),
        isManualResponseActive: () => this.isManualResponseActive(),
        getCurrentSpeakOptions: () => this.currentSpeakOptions,
        setSoftStopRequested: (value) => { this.softStopRequested = value; },
        stopLivekitAgent: async () => {
          if (this.livekitAgent) {
            await this.livekitAgent.stop()
          }
        },
        getLivekitAgentIsSpeaking: () => this.livekitAgent?.getIsSpeaking() || false,
        forceMoveToNextQuestion: async () => {
          await this.engine.forceMoveToNextQuestion()
        }
      })

      this.engine.on('evaluation', (evaluation: Evaluation) => {
        this.emit('evaluation', evaluation)
      })

      this.engine.on('progressUpdate', (progress) => {
        this.emit('progressUpdate', progress)
      })

      this.engine.on('speakRequested', async (req: SpeakRequest) => {
        await this.speakWithPolicy(req.text, req.options)
      })

      this.engine.on('hintSpokenRequested', async (hintText: string) => {
        const result = await this.speakWithPolicy(hintText, {
          interruptible: true,
          bargeInPolicy: 'hard'
        }, { kind: 'hint' as ResponseKind, priority: 'auto', source: 'monitoring_auto_hint' })
        if (result.completed) {
          await this.engine.onHintSpokenCompleted(hintText)
        }
      })

      this.engine.on('clarificationSpokenRequested', async (clarificationText: string) => {
        const result = await this.speakWithPolicy(clarificationText, {
          interruptible: true,
          bargeInPolicy: 'hard'
        })
        if (result.completed) {
          await this.engine.onClarificationSpokenCompleted(clarificationText)
        }
      })

      this.engine.on('skipRequested', async ({ problem, text }: { problem: any, text: string }) => {
        const confirmed = await this.requestSkipConfirmation()
        if (!confirmed) {
          return
        }

        await this.withManualResponse('system', 'skip_question', async () => {
          const skipMessage = "Understood. Let's move on to the next problem."
          this.codeAnalysis.addConversationMessage('assistant', skipMessage, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()

          await this.speakWithPolicy(skipMessage, {
            interruptible: false,
            bargeInPolicy: 'soft'
          }, { kind: 'system', priority: 'manual', source: 'skip_question' })

          const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || '// Skipped by candidate'
          const codingProblems = this.currentSession?.codingProblems || []
          try {
            await this.submitCodingSolution(currentCode, false)
          } catch (error) {
            console.error('🎯 [Interview] Error during skip submission:', error)
            const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
            const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1

            if (hasNextProblem) {
              const nextProblem = codingProblems[currentProblemIndex + 1]
              this.codeAnalysis.setCurrentProblem(nextProblem)
              this.currentProblemId = nextProblem.id
              await this.stateMachine.setState(InterviewState.CODING_PROBLEM)
            } else {
              await this.stateMachine.setState(InterviewState.WRAP_UP)
            }
          }
        })
      })

      this.engine.on('solutionSubmitted', async ({ feedback, hasNextProblem }: { feedback: string, hasNextProblem: boolean }) => {
        await this.speakWithPolicy(feedback, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
      })

      // Initialize TransitionQueue
      this.transitionQueue = new TransitionQueue()

      // Initialize LiveKit agent if configured
      if (config.livekit) {
        this.livekitAgent = new InterviewAgent({
          livekitUrl: config.livekit.url,
          livekitApiKey: config.livekit.apiKey,
          livekitApiSecret: config.livekit.apiSecret,
          openaiApiKey: config.livekit.openaiApiKey,
          sttProvider: config.livekit.sttProvider || 'openai',
          sttApiKey: config.livekit.sttApiKey,
          llmModel: config.livekit.llmModel || 'gpt-4o-mini',
          ttsVoice: config.livekit.ttsVoice || 'alloy',
          ttsModel: config.livekit.ttsModel || 'tts-1',
        })

        // Set up agent event listeners
        // Use custom LLMService evaluation - LiveKit agent only handles STT/TTS, not LLM responses
        this.livekitAgent.on('userSpeech', ({ text }) => {
          this.handleTranscript(text).catch(err => {
            console.error('Error handling transcript:', err)
          })
        })

        this.livekitAgent.on('userSpeakingStarted', () => {
          console.log('🎤 [Orchestrator] User started speaking')
          this.userSpeaking = true
          this.emit('userSpeakingStarted')
        })

        this.livekitAgent.on('userSpeakingEnded', () => {
          console.log('🎤 [Orchestrator] User stopped speaking')
          this.userSpeaking = false
          this.emit('userSpeakingEnded')
        })

        this.livekitAgent.on('agentSpeechStarted', () => {
          console.log('🎤 [Orchestrator] Agent started speaking')
          this.emit('speakingStarted')
        })

        this.livekitAgent.on('agentSpeechEnded', () => {
          console.log('🎤 [Orchestrator] Agent stopped speaking')
          this.emit('speakingCompleted')
        })
      }

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
      const introText = "Hello! Welcome to your technical interview. I'll be conducting your interview today. Lets start with some theoretical questions."
      // const introText = "Hello!"

      // LiveKit handles audio automatically
      const result = await this.speakWithPolicy(introText, {
        interruptible: true,
        bargeInPolicy: 'hard'
      })
      if (result.completed) {
        // Transition to first question immediately
        await this.stateMachine.transition('begin_questions')
      }
    })

    this.stateMachine.on('askQuestion', async (question: Question) => {
      await this.engine.onAskQuestion(question)
      this.currentQuestionId = question.id
      this.emit('askQuestion', question)
      await this.speakQuestion(question.question)
    })

    this.stateMachine.on('askFollowUp', async (followUp: string) => {
      await this.engine.onAskFollowUp(followUp)
      this.emit('askFollowUp', followUp)
      this.questionInterruptionRetries = 0
      this.currentQuestionText = followUp
      await this.speakFollowUpQuestion(followUp)
    })

    this.stateMachine.on('codingIntroStarted', async () => {
      console.log('🎯 [Interview] Coding intro started - emitting state change to renderer')
      
      // Emit state change immediately so UI can show transition state
      this.emit('stateChanged', { 
        from: this.stateMachine.getState(), 
        to: InterviewState.CODING_INTRO 
      })
      
      // Debug: Log coding problems availability
      console.log('🎯 [Interview] Debug - currentSession:', !!this.currentSession)
      console.log('🎯 [Interview] Debug - codingProblems:', this.currentSession?.codingProblems)
      console.log('🎯 [Interview] Debug - codingProblems length:', this.currentSession?.codingProblems?.length)
      console.log('🎯 [Interview] Debug - codingProblems array:', JSON.stringify(this.currentSession?.codingProblems?.map(p => ({ id: p.id, title: p.title }))))
      
      // Check if we have coding problems BEFORE speaking
      const hasCodingProblems = this.currentSession?.codingProblems && this.currentSession.codingProblems.length > 0
      
      if (!hasCodingProblems) {
        console.error('❌ [Interview] No coding problems available! Session:', {
          hasSession: !!this.currentSession,
          codingProblemsCount: this.currentSession?.codingProblems?.length || 0,
          codingProblems: this.currentSession?.codingProblems
        })
        console.log('🎯 [Interview] No coding problems, moving to wrap up')
        await this.stateMachine.transition('no_coding_problems')
        return
      }
      
      // Only speak transition message if we actually had theoretical questions
      if (this.hadTheoreticalQuestions) {
        console.log('🎯 [Interview] Theoretical questions completed, transitioning to coding phase')
        // Speak intro to coding section
        const introText = "Great work on the theoretical questions! Now let's move to the coding section."
        const result = await this.speakWithPolicy(introText, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
        
        console.log(`🎯 [Interview] ${this.currentSession?.codingProblems?.length || 0} coding problem(s) available`)
        // Only transition if intro completed
        if (result.completed || result.softStopped) {
          await this.stateMachine.transition('coding_problem_presented')
        }
      } else {
        // Coding-only interview - speak welcome message here (centralized, no duplication)
        console.log('🎯 [Interview] Coding-only interview, speaking welcome message')
        const introText = "Welcome! Today we'll focus on coding problems. Let's begin."
        const result = await this.speakWithPolicy(introText, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
        
        // Only transition if intro completed
        if (result.completed || result.softStopped) {
          await this.stateMachine.transition('coding_problem_presented')
        }
      }
    })

    this.stateMachine.on('presentCodingProblem', async () => {
      // Get the current problem - use codeAnalysis first (most up-to-date), then fallback to session
      let problem = this.codeAnalysis.getCurrentProblem()
      if (!problem) {
        console.warn('⚠️ [Interview] Problem not found in codeAnalysis, trying session...')
        // Get the first problem from session if codeAnalysis doesn't have it
        // This can happen if setCurrentProblem wasn't called during initialization
        if (this.currentSession?.codingProblems && this.currentSession.codingProblems.length > 0) {
          // Use the problem at the current index, or the first one if no index is tracked
          const problemIndex = this.currentProblemId 
            ? this.currentSession.codingProblems.findIndex(p => p.id === this.currentProblemId)
            : 0
          problem = this.currentSession.codingProblems[problemIndex >= 0 ? problemIndex : 0]
          console.log('✅ [Interview] Got problem from session:', problem?.id, problem?.title)
        } else {
          problem = this.getCurrentCodingProblem()
        }
      }
      
      console.log('🎯 [Interview] presentCodingProblem event triggered')
      console.log('🎯 [Interview] Problem from codeAnalysis:', problem?.id, problem?.title)
      console.log('🎯 [Interview] Current problem ID tracked:', this.currentProblemId)
      console.log('🎯 [Interview] Session coding problems count:', this.currentSession?.codingProblems?.length)
      
      if (!problem) {
        console.error('❌ [Interview] No coding problem found when presenting!')
        console.error('❌ [Interview] CodeAnalysis problem:', this.codeAnalysis.getCurrentProblem()?.id)
        console.error('❌ [Interview] Session problems:', this.currentSession?.codingProblems?.length)
        console.error('❌ [Interview] Session problems array:', this.currentSession?.codingProblems)
        console.error('❌ [Interview] Current problem ID:', this.currentProblemId)
        
        // If no problem found, transition to wrap up
        console.error('❌ [Interview] Cannot proceed without coding problem, transitioning to wrap up')
        await this.stateMachine.transition('no_coding_problems')
        return
      }
      
      // Ensure currentProblemId matches
      if (this.currentProblemId !== problem.id) {
        console.log('🎯 [Interview] Updating currentProblemId to match problem:', problem.id)
        this.currentProblemId = problem.id
      }
      
      // Do minimal setup first (must be done before speaking for proper tagging)
      this.stateMachine.resetCodingCounters()
      this.codeAnalysis.setCurrentProblem(problem)
      
      // Start TTS generation immediately (don't await - let it generate in background)
      const intro = "Here's the coding problem. You can see the details on your screen. Before you start coding, please explain your approach to solving this problem. Also feel free to ask any clarifying questions if you need to understand the requirements better. While you work through it, please plan to note the time and space complexity of your final solution as well."
      const speakPromise = this.speakWithPolicy(intro, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })
      
      // Emit to renderer immediately (timer starts right away)
      this.emit('presentCodingProblem', problem)
      console.log('🎯 [Interview] Emitted presentCodingProblem event to renderer with problem:', problem.id, problem.title)
      
      // Sync conversation history in parallel (non-blocking)
      this.syncConversationHistoryFromServices()
      
      // Wait for speech to complete
      await speakPromise
    })

    this.stateMachine.on('askForApproach', async () => {
      console.log('🎯 [Interview] Asking for coding approach')
      await this.askForCodingApproach()
    })

    this.stateMachine.on('waitingForApproach', () => {
      console.log('🎯 [Interview] Waiting for approach explanation')
      // Start 2 minute silence timer for coding questions
      this.stateMachine.startSilenceTimer(120000) // 120 seconds = 2 minutes
    })

    this.stateMachine.on('evaluatingApproach', () => {
      console.log('🎯 [Interview] Evaluating approach')
    })

    this.stateMachine.on('codeMonitoringStarted', () => {
      console.log('🎯 [Interview] Code monitoring started - can begin coding')
      // Start 1-minute silence timer for code monitoring phase
      this.stateMachine.startSilenceTimer(60000) // 60 seconds = 1 minute
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
    this.setupLLMListeners()
    this.setupCodeAnalysisListeners()
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

  private markUserSpeakingActivity(): void {
    this.userSpeaking = true
    if (this.liveTranscriptTimeout) {
      clearTimeout(this.liveTranscriptTimeout)
    }
    this.liveTranscriptTimeout = setTimeout(() => {
      this.userSpeaking = false
      this.liveTranscriptTimeout = null
    }, 1500)
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

  async clearSession(): Promise<void> {
    console.log('🎯 [Interview] Clearing session')
    
    // IMPORTANT: Don't clear conversations if payload hasn't been sent yet
    // This prevents data loss if clearSession() is called prematurely
    if (!this.payloadSent && (this.codingProblemConversations.length > 0 || this.fullConversationHistory.length > 0)) {
      console.log('🎯 [Interview] ⚠️ Blocking session clear - payload not sent yet (coding:', this.codingProblemConversations.length, ', history:', this.fullConversationHistory.length, ')')
      console.log('🎯 [Interview] Only clearing non-critical state, preserving conversations')
      // Only clear non-critical state, preserve conversations
      this.currentSession = null
      this.stateMachine.reset()
      this.currentProblemId = null
      this.currentQuestionId = null
      this.llm.reset()
      // Stop any ongoing TTS
      if (this.livekitAgent) {
        await this.livekitAgent.stop()
      }
      return // Exit early, don't clear conversations
    }
    
    // If payload has been sent, safe to clear everything
    this.currentSession = null
    this.stateMachine.reset()
    this.codingProblemConversations = []
    this.allEvaluations = []
    this.fullConversationHistory = []
    this.currentProblemId = null
    this.currentQuestionId = null
    this.llm.reset()
    this.payloadSent = false // Reset flag for next interview
    // Stop any ongoing TTS
    if (this.livekitAgent) {
      await this.livekitAgent.stop()
    }
    console.log('🎯 [Interview] Session fully cleared (payload was sent)')
  }
  
  /**
   * Mark payload as sent - allows clearSession() to fully clear conversations
   * This should be called from the renderer after successful submission
   */
  markPayloadSent(): void {
    console.log('🎯 [Interview] Marking payload as sent - conversations can now be cleared')
    this.payloadSent = true
  }
  
  /**
   * Clear conversation data after payload is successfully sent
   * This should be called from the renderer after successful submission
   * @deprecated Use markPayloadSent() instead - clearSession() will handle clearing
   */
  clearConversationData(): void {
    console.log('🎯 [Interview] Clearing conversation data after payload sent')
    this.payloadSent = true
    this.codingProblemConversations = []
    this.allEvaluations = []
    this.fullConversationHistory = []
  }

  async startInterview(session: InterviewSession & { resumeFromIndex?: number; skipIntro?: boolean }): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized')
    }

    // Initialize conversation history for new interview
    this.fullConversationHistory = []
    this.codingProblemConversations = []
    this.currentProblemId = null
    this.currentQuestionId = null
    this.payloadSent = false // Reset payload sent flag for new interview
    
    // Ensure startTime is set if not already present
    const sessionWithStartTime: InterviewSession = {
      ...session,
      startTime: session.startTime || new Date(),
      status: session.status || 'in_progress'
    }
    
    this.currentSession = sessionWithStartTime
    this.llm.setQuestions(session.questions)
    this.stateMachine.setQuestions(session.questions, session.maxTheoreticalQuestions || 10)
    this.llm.setMaxTheoreticalQuestions(session.maxTheoreticalQuestions || 10)
    
    // Handle resume position if provided
    if (typeof session.resumeFromIndex === 'number') {
      const idx = Math.max(0, Math.min(session.resumeFromIndex, session.questions.length - 1))
      this.stateMachine.setCurrentQuestionIndex(idx)
      this.llm.setCurrentQuestionIndex(idx)
    }
    // NOTE: Don't call setCurrentProblem during initialization - it will be called when the problem is actually presented
    // This prevents the coding question from being added to conversation history twice
    // The problem will be set in the presentCodingProblem handler when it's actually needed

    try {
      // Start LiveKit agent if configured
      if (this.livekitAgent) {
        const roomName = `interview-${session.id}`
        console.log('🎤 [Orchestrator] Starting LiveKit agent for room:', roomName)
        try {
          await this.livekitAgent.start(roomName, 'interview-agent')
          console.log('🎤 [Orchestrator] LiveKit agent started successfully')
        } catch (error) {
          console.error('🎤 [Orchestrator] Failed to start LiveKit agent:', error)
          // Don't throw - allow interview to continue without agent
        }
      }


      // Check if we have theoretical questions
      const hasTheoreticalQuestions = session.questions && session.questions.length > 0
      const hasCodingProblems = session.codingProblems && session.codingProblems.length > 0
      
      // Track if we had theoretical questions for transition handling
      this.hadTheoreticalQuestions = hasTheoreticalQuestions
      
      console.log(`🎯 [Interview] Session setup: ${session.questions?.length || 0} theoretical, ${session.codingProblems?.length || 0} coding`)

      // Begin or resume interview
      if (session.skipIntro) {
        // Skip intro; check what type of questions we have
        if (hasTheoreticalQuestions) {
          await this.stateMachine.transition('begin_questions')
        } else if (hasCodingProblems) {
          console.log('🎯 [Interview] No theoretical questions, starting directly with coding')
          // For coding-only interviews with skipIntro, go directly to CODING_INTRO (handler will skip transition message)
          if (this.currentSession?.codingProblems && this.currentSession.codingProblems.length > 0) {
            // Skip INTRO state entirely and go directly to CODING_INTRO
            await this.stateMachine.setState(InterviewState.CODING_INTRO)
          }
        }
      } else {
        // Normal flow - check if we have theoretical questions
        if (hasTheoreticalQuestions) {
          // Normal flow with intro and theoretical questions
          await this.stateMachine.transition('start_interview')
        } else if (hasCodingProblems) {
          // Only coding problems - skip theoretical phase entirely
          console.log('🎯 [Interview] Only coding problems, skipping theoretical section')
          // Don't speak here - let CODING_INTRO handler speak (following theoretical question pattern)
          // This prevents duplication - state machine emits event, handler speaks once
          if (this.currentSession?.codingProblems && this.currentSession.codingProblems.length > 0) {
            await this.stateMachine.setState(InterviewState.CODING_INTRO)
          }
        } else {
          throw new Error('No questions or coding problems provided')
        }
      }

    } catch (error) {
      console.error('Failed to start interview:', error)
      throw error
    }
  }


  async handleTranscript(text: string): Promise<void> {
    if (!this.currentSession) {
      return
    }

    const currentState = this.stateMachine.getState()
    await this.engine.handleTranscriptBargeIn(text)

    if (currentState === InterviewState.WAITING_FOR_ANSWER || currentState === InterviewState.THEORETICAL_QUESTION ||
        currentState === InterviewState.WAITING_FOR_APPROACH || currentState === InterviewState.MONITORING_CODE) {
      await this.engine.processTranscript(text, currentState)
    }
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    return this.transitionQueue.enqueue(async () => {
      await this.engine.handleEvaluation(evaluation)
    })
  }

  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }): Promise<any> {
    return await this.engine.analyzeCodeWithBusinessLogic(codeData)
  }

  async submitCodingSolution(
    code: string,
    isTimeout: boolean = false,
    timeComplexity?: string,
    spaceComplexity?: string
  ): Promise<{success: boolean, feedback: string, hasNextProblem: boolean}> {
    if (!this.currentSession) {
      throw new Error('No active interview session')
    }

    const currentState = this.stateMachine.getState()

    try {
      const problem = this.codeAnalysis.getCurrentProblem()
      if (!problem) {
        throw new Error('No current coding problem')
      }

      const codingProblems = this.currentSession.codingProblems || []
      const result = await this.engine.submitCodingSolution(
        code,
        problem,
        codingProblems,
        isTimeout,
        timeComplexity,
        spaceComplexity
      )

      const analysis = this.codeAnalysis.getObservations().slice(-1)[0]?.analysis || { progress: 0, approach: 'incomplete', issues: [], codeQuality: 'poor' }
      const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)

      if (result.hasNextProblem) {
        this.stateMachine.clearSilenceTimer()
        this.syncConversationHistoryFromServices()
        
        const problemConversationHistory = this.getProblemConversationHistory(problem.id)
        const finalSubmission = this.codeAnalysis.getFinalSubmission()
        
        const codeSubmissionMsg = problemConversationHistory.find(
          msg => msg.metadata.type === 'code_submission'
        )
        if (codeSubmissionMsg) {
          const metadata = codeSubmissionMsg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        const problemConversation = {
          problemId: problem.id,
          problem,
          conversation: problemConversationHistory,
          finalCode: finalSubmission.code,
          timeComplexity: finalSubmission.timeComplexity,
          spaceComplexity: finalSubmission.spaceComplexity,
          codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
          submittedAt: new Date(),
          evaluation: {
            score: analysis.progress,
            feedback: result.feedback,
            testResults: []
          }
        }
        this.codingProblemConversations.push(problemConversation)
        
        const nextProblem = codingProblems[currentProblemIndex + 1]
        this.currentProblemId = nextProblem.id
        this.codeAnalysis.setCurrentProblem(nextProblem)
        this.stateMachine.clearSilenceTimer()
        
        const targetState = InterviewState.CODING_PROBLEM
        if (currentState === targetState) {
          await this.stateMachine.setState(InterviewState.IDLE)
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        await this.stateMachine.setState(targetState)
        
        return {
          success: result.success,
          feedback: result.feedback,
          hasNextProblem: true
        }
      }

      console.log('🎯 [Interview] All coding problems completed')
      console.log('🎯 [Interview] Current state before transition:', this.stateMachine.getState())
      console.log('🎯 [Interview] Storing final coding problem conversation')
      console.log('🎯 [Interview] Current problem ID:', problem.id)
      console.log('🎯 [Interview] Existing conversations count:', this.codingProblemConversations.length)
      
      this.stateMachine.clearSilenceTimer()
      
      // Check if this problem's conversation is already stored
      const existingIndex = this.codingProblemConversations.findIndex(
        c => c.problemId === problem.id
      )
      
      if (existingIndex !== -1) {
        console.log('🎯 [Interview] Problem conversation already exists at index:', existingIndex)
        // Sync conversation history from services before updating
        this.syncConversationHistoryFromServices()
        
        // Update the existing conversation with final submission
        const finalSubmission = this.codeAnalysis.getFinalSubmission()
        console.log('🎯 [Interview] Final submission TC/SC:', {
          timeComplexity: finalSubmission.timeComplexity || 'NOT SET',
          spaceComplexity: finalSubmission.spaceComplexity || 'NOT SET'
        })
        
        // Get updated conversation history
        const problemConversationHistory = this.getProblemConversationHistory(problem.id)
        
        // Ensure code submission message in conversation has TC/SC if we have it
        const codeSubmissionMsg = problemConversationHistory.find(
          msg => msg.metadata.type === 'code_submission'
        )
        if (codeSubmissionMsg) {
          const metadata = codeSubmissionMsg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            console.log('🔧 [Interview] Adding TC/SC to code submission message in existing conversation')
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        this.codingProblemConversations[existingIndex] = {
          ...this.codingProblemConversations[existingIndex],
          conversation: problemConversationHistory, // Update with latest history
          finalCode: finalSubmission.code,
          timeComplexity: finalSubmission.timeComplexity,
          spaceComplexity: finalSubmission.spaceComplexity,
          codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
          submittedAt: new Date(),
          evaluation: {
            score: analysis.progress,
            feedback: result.feedback,
            testResults: []
          }
        }
      } else {
        this.syncConversationHistoryFromServices()
        const problemConversationHistory = this.getProblemConversationHistory(problem.id)
        const finalSubmission = this.codeAnalysis.getFinalSubmission()
        
        const codeSubmissionMsg = problemConversationHistory.find(
          msg => msg.metadata.type === 'code_submission'
        )
        if (codeSubmissionMsg) {
          const metadata = codeSubmissionMsg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        const problemConversation = {
          problemId: problem.id,
          problem,
          conversation: problemConversationHistory,
          finalCode: finalSubmission.code,
          timeComplexity: finalSubmission.timeComplexity,
          spaceComplexity: finalSubmission.spaceComplexity,
          codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
          submittedAt: new Date(),
          evaluation: {
            score: analysis.progress,
            feedback: result.feedback,
            testResults: []
          }
        }
        this.codingProblemConversations.push(problemConversation)
      }
      
      this.stateMachine.clearSilenceTimer()
      
      const stateBeforeTransition = this.stateMachine.getState()
      if (stateBeforeTransition !== InterviewState.MONITORING_CODE) {
        await this.stateMachine.setState(InterviewState.MONITORING_CODE)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      const transitionResult = await this.stateMachine.transition('solution_complete')
      if (!transitionResult) {
        await this.stateMachine.setState(InterviewState.WRAP_UP)
      }

      return {
        success: result.success,
        feedback: result.feedback,
        hasNextProblem: false
      }

    } catch (error) {
      console.error('Error submitting solution:', error)
      throw error
    }
  }

  /**
   * Request skip confirmation from renderer
   * Returns a promise that resolves when user confirms or cancels
   */
  private async requestSkipConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      this.skipConfirmationResolve = resolve
      // Emit event to request confirmation from renderer
      this.emit('requestSkipConfirmation')
    })
  }

  /**
   * Set the skip confirmation result (called by main process after renderer responds)
   */
  setSkipConfirmationResult(confirmed: boolean): void {
    if (this.skipConfirmationResolve) {
      this.skipConfirmationResolve(confirmed)
      this.skipConfirmationResolve = null
    }
  }

  private async speakWithPolicy(
    text: string,
    opts: SpeakOptions,
    context: SpeechContext = { kind: 'system', priority: 'auto', source: 'general' }
  ): Promise<SpeakResult> {
    this.currentSpeechContext = context
    try {
      this.currentSpeakOptions = opts
      this.softStopRequested = false

      const isSecurityWarning = context.source === 'security_warning'

      this.emit('speakingStarted')

      if (isSecurityWarning) {
        console.log('🎯 [Security] Speaking security warning')
      }

      // Use LiveKit agent to speak (handles TTS and echo cancellation automatically)
      console.log(`🎯 [Speech] Speaking via LiveKit:`, text.substring(0, 50))
      if (this.livekitAgent) {
        // Pass allowInterruptions based on opts.interruptible
        // If interruptible is false, pass allowInterruptions: false
        // If interruptible is true, pass allowInterruptions: true (default)
        const allowInterruptions = opts.interruptible !== false
        // say() now waits for speech completion
        await this.livekitAgent.say(text, { allowInterruptions })
      } else {
        console.warn('⚠️ [Speech] LiveKit agent not available, speech not played')
      }

      // Play queued security warning if main speech completed successfully
      // Only check softStopRequested if interruptions are allowed
      const interruptionsAllowed = opts.interruptible !== false
      if (this.pendingSecurityWarning && (!this.softStopRequested || !interruptionsAllowed)) {
        const warning = this.pendingSecurityWarning
        this.pendingSecurityWarning = null
        console.log('🔊 [Security] Playing queued security warning:', warning.substring(0, 50))
        await this.speakSecurityWarning(warning)
      }

      // If interruptions are not allowed, ignore softStopRequested (speech completed)
      // If interruptions are allowed, check softStopRequested
      const completed = interruptionsAllowed ? !this.softStopRequested : true
      const softStopped = interruptionsAllowed ? this.softStopRequested : false
      
      this.emit('speakingCompleted')
      this.currentSpeakOptions = undefined

      return { completed, softStopped, interrupted: false }

    } catch (error) {
      console.error('TTS error:', error)
      this.emit('ttsError', error)
      this.emit('speakingCompleted')
      this.currentSpeakOptions = undefined
      return { completed: false, softStopped: false, interrupted: true }
    } finally {
      this.currentSpeechContext = null
    }
  }

  private async speakQuestion(question: string): Promise<void> {
    // Store current question text for potential retry
    this.currentQuestionText = question
    
    // Determine if we should allow interruptions based on retry count
    // After 2 interruptions, don't allow interruption on 3rd attempt
    const maxRetries = 2
    const allowInterruptions = this.questionInterruptionRetries < maxRetries
    
    console.log(`🎯 [Question] Speaking question (retry: ${this.questionInterruptionRetries}/${maxRetries}, allowInterruptions: ${allowInterruptions})`)
    
    // Question stems use soft barge-in (must-deliver)
    // If retry count >= maxRetries, set interruptible: false to prevent interruption
    const result = await this.speakWithPolicy(
      question,
      {
        interruptible: allowInterruptions, // Allow interruptions only if retry count < maxRetries
        bargeInPolicy: 'soft'
      },
      { kind: 'prompt', priority: 'auto', source: 'theoretical_question' }
    )

    // Only transition to waiting_for_answer if question was fully completed
    // Never transition if interrupted (soft-stopped)
    if (result.completed && !result.softStopped) {
      // Question was fully delivered, reset retry counter for next question
      this.questionInterruptionRetries = 0
      this.currentQuestionText = null
      
      if (this.stateMachine.getState() === InterviewState.THEORETICAL_QUESTION) {
        await this.stateMachine.transition('question_asked')
      }
      // Start silence timer for automatic hints (40 seconds)
      this.stateMachine.startSilenceTimer(40000)
    } else if (result.softStopped || result.interrupted) {
      // Question was interrupted
      this.questionInterruptionRetries++
      console.log(`🎯 [Question] Question interrupted (retry count: ${this.questionInterruptionRetries}/${maxRetries})`)
      
      // If we haven't exceeded max retries, repeat the question
      if (this.questionInterruptionRetries <= maxRetries) {
        console.log(`🎯 [Question] Repeating question (attempt ${this.questionInterruptionRetries + 1})`)
        // Wait a brief moment before repeating
        await new Promise(resolve => setTimeout(resolve, 500))
        // Recursively call speakQuestion to repeat
        await this.speakQuestion(question)
      } else {
        // Max retries exceeded, reset counter and let it complete without interruption
        console.log(`🎯 [Question] Max retries reached, will complete without allowing interruption`)
        this.questionInterruptionRetries = 0
        // Retry one more time with interruptions disabled
        await this.speakQuestion(question)
      }
    }
  }

  /**
   * Speak a follow-up question with retry logic (same as speakQuestion)
   */
  private async speakFollowUpQuestion(followUp: string): Promise<void> {
    // Store current follow-up text for potential retry
    this.currentQuestionText = followUp
    
    // Determine if we should allow interruptions based on retry count
    // After 2 interruptions, don't allow interruption on 3rd attempt
    const maxRetries = 2
    const allowInterruptions = this.questionInterruptionRetries < maxRetries
    
    console.log(`🎯 [FollowUp] Speaking follow-up (retry: ${this.questionInterruptionRetries}/${maxRetries}, allowInterruptions: ${allowInterruptions})`)
    
    // Follow-up questions use hard barge-in
    const result = await this.speakWithPolicy(
      followUp,
      {
        interruptible: allowInterruptions, // Allow interruptions only if retry count < maxRetries
        bargeInPolicy: 'hard'
      },
      { kind: 'prompt', priority: 'auto', source: 'followup_question' }
    )
    
    console.log('🎯 [Interview] Follow-up speech result:', result)
    
    // Only transition if follow-up was fully completed (not interrupted)
    if (result.completed && !result.softStopped && !result.interrupted) {
      // Follow-up was fully delivered, reset retry counter
      this.questionInterruptionRetries = 0
      this.currentQuestionText = null
      console.log('🎯 [Interview] Follow-up completed, transitioning to follow_up_asked')
      await this.stateMachine.transition('follow_up_asked')
      // Start silence timer for automatic hints on follow-up questions (40 seconds)
      this.stateMachine.startSilenceTimer(40000)
      console.log('🎯 [Interview] Silence timer started for follow-up question')
    } else if (result.softStopped || result.interrupted) {
      // Follow-up was interrupted
      this.questionInterruptionRetries++
      console.log(`🎯 [FollowUp] Follow-up interrupted (retry count: ${this.questionInterruptionRetries}/${maxRetries})`)
      
      // If we haven't exceeded max retries, repeat the follow-up
      if (this.questionInterruptionRetries <= maxRetries) {
        console.log(`🎯 [FollowUp] Repeating follow-up (attempt ${this.questionInterruptionRetries + 1})`)
        // Wait a brief moment before repeating
        await new Promise(resolve => setTimeout(resolve, 500))
        // Recursively call to repeat follow-up
        await this.speakFollowUpQuestion(followUp)
      } else {
        // Max retries exceeded, reset counter and let it complete without interruption
        console.log(`🎯 [FollowUp] Max retries reached, will complete without allowing interruption`)
        this.questionInterruptionRetries = 0
        // Retry one more time with interruptions disabled
        await this.speakFollowUpQuestion(followUp)
      }
    } else {
      console.log('🎯 [Interview] Follow-up was interrupted, not transitioning')
    }
  }

  /**
   * Speak a security warning to the user
   * This is a public method that can be called from IPC handlers
   * Uses auto priority and is interruptible to not block interview flow
   */
  public async speakSecurityWarning(message: string): Promise<void> {
    try {
      console.log(`🔊 [Security] speakSecurityWarning called with: "${message.substring(0, 50)}..."`)
      
      if (!message || !message.trim()) {
        console.log('🔇 [Security] Empty message, skipping')
        return
      }

      // Queue if TTS is already speaking OR if another security warning is in progress
      if (this.livekitAgent?.getIsSpeaking() || this.isSecurityWarningInProgress) {
        console.log('📝 [Security] Queuing warning TTS (speech active or warning in progress):', message.substring(0, 50))
        this.pendingSecurityWarning = message
        return
      }
      
      // Mark security warning as in progress immediately (before async TTS starts)
      this.isSecurityWarningInProgress = true
      
      // Clear any pending warning since we are speaking now
      this.pendingSecurityWarning = null
      
      console.log('🔊 [Security] Proceeding with TTS...')

      try {
        // Security warnings are interruptible and use auto priority
        // They won't block interview flow and can be interrupted by user
        await this.speakWithPolicy(
          message,
          {
            interruptible: true,  // Can be interrupted by user
            bargeInPolicy: 'hard' // User can interrupt immediately
          },
          { 
            kind: 'system', 
            priority: 'auto',  // Auto priority (system-generated)
            source: 'security_warning' 
          }
        )
      } finally {
        // Always reset the flag when done
        this.isSecurityWarningInProgress = false
      }
    } catch (error) {
      console.error('Failed to speak security warning:', error)
      this.isSecurityWarningInProgress = false
      // Don't throw - security warnings are non-critical
    }
  }

  private async withManualResponse<T>(kind: ResponseKind, source: string, handler: () => Promise<T>): Promise<T> {
    await this.interruptAutoSpeech(`manual ${kind} requested (${source})`)
    this.startManualResponse(kind, source)
    try {
      return await handler()
    } finally {
      this.finishManualResponse(kind, source)
    }
  }

  private startManualResponse(kind: ResponseKind, source: string): void {
    this.manualResponseInFlight = { kind, source, startedAt: Date.now() }
    console.log(`🎯 [Interview] Manual ${kind} response started (${source})`)
  }

  private finishManualResponse(kind: ResponseKind, source: string): void {
    if (this.manualResponseInFlight && this.manualResponseInFlight.kind === kind && this.manualResponseInFlight.source === source) {
      console.log(`🎯 [Interview] Manual ${kind} response finished (${source})`)
      this.manualResponseInFlight = null
    }
  }

  private isManualResponseActive(): boolean {
    return !!this.manualResponseInFlight
  }

  private async interruptAutoSpeech(reason: string): Promise<void> {
    if (this.currentSpeechContext?.priority === 'auto' && this.livekitAgent?.getIsSpeaking()) {
      console.log(`🎯 [Interview] Stopping auto speech due to ${reason}`)
      try {
        await this.livekitAgent.stop()
      } catch (error) {
        console.warn('⚠️ [Interview] Failed to stop auto speech:', error)
      }
    }
  }

  private shouldSkipAutoResponse(trigger: string): boolean {
    return this.engine.shouldSkipAutoResponse(trigger)
  }

  private async handleSilenceTimeout(): Promise<void> {
    await this.engine.handleSilenceTimeout()
  }

  private async askForCodingApproach(): Promise<void> {
    const problem = this.getCurrentCodingProblem()
    if (!problem) {
      console.log('🎯 [Interview] No coding problem to ask approach for')
      return
    }
    
    // Transition to waiting for approach (approach prompt was already spoken in speakCodingProblem)
    await this.stateMachine.transition('approach_asked')
  }

  private async handleHintProvision(): Promise<void> {
    await this.engine.handleHintProvision()
  }

  private async speakWrapUp(_data: any): Promise<void> {
    // Minimal ending statement - no scores or stats
    const wrapUpText = "Thank you for completing the interview. Your responses have been recorded."
    // Wrap-up is interruptible with hard stop
    await this.speakWithPolicy(wrapUpText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    })
    await this.stateMachine.transition('interview_complete')
  }

  private async handleInterviewCompletion(): Promise<void> {
    if (this.livekitAgent) {
      await this.livekitAgent.disconnect()
    }
    await this.engine.handleInterviewCompletion()
  }

  // Get final evaluation payload (can be called after completion)
  getFinalEvaluationPayload(): FinalEvaluationPayload | null {
    if (this.currentSession && (this.currentSession as any).finalEvaluationPayload) {
      return (this.currentSession as any).finalEvaluationPayload
    }
    return null
  }

  private cleanupListeners(): void {
    this.livekitAgent?.removeAllListeners()
    this.llm?.removeAllListeners()
    this.codeAnalysis?.removeAllListeners()
    this.stateMachine.removeAllListeners()
    this.removeAllListeners()
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
    if (this.livekitAgent) {
      await this.livekitAgent.stop()
    }
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


    // Audio streaming removed - LiveKit handles audio directly in renderer
    // No need for manual audio chunk forwarding

  // Receive vision security warnings from renderer
  updateVisionSecurityWarnings(warningStats: any): void {
    console.log('📊 [Orchestrator] Received vision security warnings:', JSON.stringify(warningStats, null, 2))
    console.log('📊 [Orchestrator] Warning stats keys:', Object.keys(warningStats || {}))
    this.visionSecurityWarnings = warningStats
    console.log('📊 [Orchestrator] Stored warnings:', JSON.stringify(this.visionSecurityWarnings, null, 2))
  }

  // Get vision security warnings for final evaluation
  getVisionSecurityWarnings(): any {
    console.log('📊 [Orchestrator] Getting vision security warnings, current value:', JSON.stringify(this.visionSecurityWarnings, null, 2))
    return this.visionSecurityWarnings
  }

  // Clean up resources
  destroy(): void {
    console.log('🧹 [Orchestrator] Cleaning up resources...')
    
    // Clear any pending timeouts
    if (this.liveTranscriptTimeout) {
      clearTimeout(this.liveTranscriptTimeout)
      this.liveTranscriptTimeout = null
    }
    
    // Stop all services
    this.livekitAgent?.disconnect()
    this.codeAnalysis?.reset()
    
    // Clean up event listeners
    this.cleanupListeners()
    
    // Clear session data
    this.currentSession = null
    this.isInitialized = false
    
    // Clear any pending state
    this.softStopRequested = false
    this.userSpeaking = false
    this.currentCode = ''
    this.manualResponseInFlight = null
    this.currentSpeechContext = null
    this.pendingSecurityWarning = null
    this.isSecurityWarningInProgress = false
    
    console.log('✅ [Orchestrator] Cleanup complete')
  }

}

