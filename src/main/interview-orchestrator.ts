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

type ResponseKind = 'hint' | 'clarification' | 'answer' | 'prompt' | 'system'

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
        codeAnalysis: this.codeAnalysis
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

  private updateListeningState(state: InterviewState): void {
    // With LiveKit, VAD handles listening automatically
    // This method is kept for state tracking but doesn't need to manage mic state
    const shouldListen = 
      state === InterviewState.WAITING_FOR_ANSWER ||
      state === InterviewState.WAITING_FOR_APPROACH ||
      state === InterviewState.INTRO ||
      state === InterviewState.HANDLING_THEORETICAL_HINT ||
      state === InterviewState.HANDLING_CLARIFICATION ||
      state === InterviewState.MONITORING_CODE ||
      state === InterviewState.CODING_PROBLEM ||
      state === InterviewState.FOLLOW_UP

    console.log(`🎤 [Main] Listening state: ${shouldListen} for ${state} state`)
    // LiveKit agent handles VAD automatically, no manual mic management needed
  }

  private setupStateMachineListeners(): void {
    // Re-emit state changes so main process can forward to renderer
    this.stateMachine.on('stateChanged', (payload: any) => {
      this.emit('stateChanged', payload)
      // Automatically update listening state based on interview state
      this.updateListeningState(payload.to)
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
      this.emit('askQuestion', question)
      // Emit progress update when asking a NEW question (not follow-up)
      const progress = this.stateMachine.getProgress()
      this.emit('progressUpdate', progress)
      
      // IMPORTANT: Add question to LLM conversation history
      this.llm.addConversationMessage('assistant', question.question, {
        type: 'question',
        questionId: question.id,
        section: 'theoretical'
      })
      // Update current question ID
      this.currentQuestionId = question.id
      // Sync to centralized history
      this.syncConversationHistoryFromServices()
      
      await this.speakQuestion(question.question)
    })

    this.stateMachine.on('askFollowUp', async (followUp: string) => {
      this.emit('askFollowUp', followUp)
      console.log('🎯 [Interview] Speaking follow-up question:', followUp.substring(0, 50))
      
      // IMPORTANT: Add follow-up question to LLM conversation history
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        // Add follow-up question as assistant message with type 'followup'
        this.llm.addConversationMessage('assistant', followUp, {
          type: 'followup',
          questionId: currentQuestion.id,
          section: 'theoretical'
        })
        console.log('🎯 [Interview] Added follow-up question to conversation history for question:', currentQuestion.id)
        // Sync to centralized history
        this.syncConversationHistoryFromServices()
      }
      
      // Reset hint and clarification counts for the follow-up question
      // Follow-up questions should start fresh with their own counts
      this.stateMachine.resetHintEventCount()
      this.stateMachine.resetClarificationRequestCount()
      this.stateMachine.resetHintLevel()
      this.stateMachine.resetNormalConversationCount()
      this.stateMachine.resetSilenceTimeoutCount()
      console.log('🎯 [Interview] Reset hint/clarification counts for follow-up question')
      
      // Increment follow-up depth when asking follow-up question
      this.stateMachine.incrementFollowUpDepth()
      this.llm.incrementFollowUpDepth()
      console.log('🎯 [Interview] Follow-up depth incremented to:', this.stateMachine.getFollowUpDepth())
      
      // Reset interruption retry counter for follow-up question
      this.questionInterruptionRetries = 0
      this.currentQuestionText = followUp
      
      // Call helper method to handle follow-up with retry logic
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
    // STT/TTS listeners removed - LiveKit agent handles these
  }

  // STT listeners removed - LiveKit agent handles transcription events

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

  // TTS listeners removed - LiveKit agent handles TTS events

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

  // Mic management removed - LiveKit handles echo cancellation automatically

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

      // Start audio capture
      await this.startAudioCapture()

      // LiveKit agent handles audio/STT automatically when connected

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

    // Ignore transcripts that arrive during auto-hint generation (they're likely from speech that started before mic was paused)
    if (this.autoHintInProgress) {
      console.log('🎯 [Interview] ⚠️ Ignoring transcript during auto-hint generation:', text)
      return
    }

    try {
      // Implement barge-in: stop TTS if candidate starts speaking
      // LiveKit handles barge-in automatically via VAD, but we can still stop explicitly
      // Only stop if interruptions are allowed AND user has been speaking for at least 2 seconds
      // The agent's stop() method now handles the 2-second check internally
      if (this.livekitAgent?.getIsSpeaking() && this.userSpeaking) {
        console.log('🎯 [Interview] 🛑 Barge-in detected (user has been speaking)')
        if (this.currentSpeakOptions) {
          // Check if interruptions are allowed
          if (this.currentSpeakOptions.interruptible === false) {
            console.log('🎯 [Interview] Interruptions not allowed, ignoring barge-in')
            // Don't stop, but still clear silence timer since user is speaking
            this.stateMachine.clearSilenceTimer()
          } else if (this.currentSpeakOptions.bargeInPolicy === 'soft') {
            console.log('🎯 [Interview] Soft stop requested (finish current sentence)')
            this.softStopRequested = true
            this.stateMachine.clearSilenceTimer()
          } else {
            console.log('🎯 [Interview] Hard stop requested (stop immediately)')
            // Agent's stop() method will check if user has been speaking for 2+ seconds
            await this.livekitAgent.stop()
            this.stateMachine.clearSilenceTimer()
          }
        } else {
          // Default to hard stop if no options set (interruptions allowed by default)
          // Agent's stop() method will check if user has been speaking for 2+ seconds
          await this.livekitAgent.stop()
          this.stateMachine.clearSilenceTimer()
        }
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
        
        // IMPORTANT: Add user's hint request to conversation history FIRST
        const currentQuestion = this.llm.getCurrentQuestion()
        if (currentQuestion) {
          this.llm.addConversationMessage('user', text, {
            type: 'hint',
            questionId: currentQuestion.id,
            section: 'theoretical'
          })
          this.syncConversationHistoryFromServices()
        }
        
        const hintEvents = this.stateMachine.incrementHintEventCount()
        console.log('🎯 [Interview] Combined hint event count:', hintEvents)

        const questionForHint = this.llm.getCurrentQuestion()
        if (!questionForHint) {
          return
        }

        if (hintEvents === 1) {
          // First hint: provide hint at current level and restart silence timer
          await this.stateMachine.transition('hint_requested')
          const hintLevel = this.stateMachine.getHintLevel()
          console.log('🎯 [Interview] Providing hint at level:', hintLevel)
          // Use generateTheoreticalHint to respect hint level (same as silence timeout)
          const hintText = await this.llm.generateTheoreticalHint(questionForHint, hintLevel)
          
          // IMPORTANT: Add hint response to LLM conversation history
          this.llm.addConversationMessage('assistant', hintText, {
            type: 'hint',
            questionId: questionForHint.id,
            hintLevel: hintLevel as 1 | 2,
            section: 'theoretical'
          })
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
          const result = await this.speakWithPolicy(
            hintText,
            {
              interruptible: true,
              bargeInPolicy: 'hard'
            },
            { kind: 'hint', priority: 'auto', source: 'monitoring_auto_hint' }
          )
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
        // If in follow-up mode, provide answer to follow-up; otherwise answer to original
        const currentEvaluation = this.stateMachine.getCurrentEvaluation()
        const isFollowUp = followUpDepth > 0
        
        let answerText: string
        let answerContext: string
        
        if (isFollowUp && currentEvaluation?.followUpQuestion) {
          // In follow-up: explain what the follow-up was asking about
          answerText = currentEvaluation.followUpQuestion
          answerContext = `Since you've asked for help twice, here's what I was asking: ${answerText}. This was a follow up question to your previous answer. Let's move to the next question.`
        } else {
          // Original question: provide the expected answer
          answerText = questionForHint.expectedAnswer || 'Here is the concise answer based on best practices.'
          answerContext = `Here's the answer: ${answerText}. Let's move to the next question.`
        }
        
        console.log('🎯 [Interview] Second hint event - providing answer (isFollowUp:', isFollowUp, ')')
        
        // IMPORTANT: Record the answer in conversation history
        this.llm.addConversationMessage('assistant', answerContext, {
          type: 'answer',
          questionId: questionForHint.id,
          section: 'theoretical',
          hintLevel: 2 // Second hint escalation
        } as any)
        // Sync to centralized history
        this.syncConversationHistoryFromServices()
        
        await this.speakWithPolicy(answerContext, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
        await this.forceMoveToNextQuestion()
        return
      }
      
      // Handle clarification requests with escalation
      if (intent.intent === 'clarification_request') {
        console.log('🎯 [Interview] ❓ Handling clarification request')
        
        // IMPORTANT: Add user's clarification request to conversation history FIRST
        const currentQuestion = this.llm.getCurrentQuestion()
        if (currentQuestion) {
          this.llm.addConversationMessage('user', text, {
            type: 'clarification',
            questionId: currentQuestion.id,
            section: 'theoretical'
          })
          this.syncConversationHistoryFromServices()
        }
        
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
        // If in follow-up mode, provide answer to follow-up; otherwise answer to original
        const questionForAnswer = this.llm.getCurrentQuestion()
        const currentEvaluation = this.stateMachine.getCurrentEvaluation()
        const isFollowUp = followUpDepth > 0
        
        if (questionForAnswer) {
          let answerText: string
          let finalPrompt: string
          
          if (isFollowUp && currentEvaluation?.followUpQuestion) {
            // In follow-up: explain what the follow-up was asking about
            answerText = currentEvaluation.followUpQuestion
            finalPrompt = `Since you've asked for clarification twice, here's what I was asking: ${answerText}. This was a follow up question to your previous answer. Let's move to the next question.`
          } else {
            // Original question: provide the expected answer
            answerText = questionForAnswer.expectedAnswer || 'Here is the concise answer based on best practices.'
            finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
          }
          
          console.log('🎯 [Interview] Second clarification (isFollowUp:', isFollowUp, ') - speaking answer:', finalPrompt.substring(0, 100))
          
          // IMPORTANT: Record the answer in conversation history
          this.llm.addConversationMessage('assistant', finalPrompt, {
            type: 'answer',
            questionId: questionForAnswer.id,
            section: 'theoretical'
          } as any)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
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
          // IMPORTANT: Add user's follow-up answer to conversation history FIRST
          // This ensures the follow-up answer is captured before evaluation
          this.llm.addConversationMessage('user', text, {
            type: 'answer',
            questionId: originalQuestion.id,
            section: 'theoretical'
          })
          console.log('🎯 [Interview] Added follow-up answer to conversation history for question:', originalQuestion.id)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
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
          // Pass detected intent to avoid duplicate detection
          response = await this.llm.processTranscript(text, intent)
        }
      } else {
        // Regular answer evaluation
        console.log('🎯 [Interview] Regular answer evaluation')
        // Pass detected intent to avoid duplicate detection
        response = await this.llm.processTranscript(text, intent)
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
          
          // IMPORTANT: Record nudge in conversation history
          const currentQuestion = this.llm.getCurrentQuestion()
          if (currentQuestion) {
            this.llm.addConversationMessage('assistant', nudge, {
              type: 'feedback',
              questionId: currentQuestion.id,
              section: 'theoretical'
            } as any)
            this.syncConversationHistoryFromServices()
          }
          
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
            
            // IMPORTANT: Record the answer in conversation history
            this.llm.addConversationMessage('assistant', finalPrompt, {
              type: 'answer',
              questionId: currentQuestion.id,
              section: 'theoretical'
            } as any)
            this.syncConversationHistoryFromServices()
            
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
        
        // If we're in a coding problem context, add hint to codeAnalysis conversation history
        const currentProblem = this.getCurrentCodingProblem()
        if (currentProblem) {
          // IMPORTANT: Add user's hint request to conversation history FIRST
          // The user's request text is the 'text' parameter from handleTranscript
          // We need to add it here before adding the hint response
          // Note: 'text' is available in the handleTranscript scope, so we can use it
          this.codeAnalysis.addHintRequest(text) // This adds the user's request as a user message with type 'hint'
          console.log('🎯 [Interview] Added user hint request to conversation history')
          
          console.log('🎯 [Interview] Adding hint to coding problem conversation history')
          // Determine hint level (default to 1 if not specified)
          const hintLevel = (response as any).hintLevel || 1
          
          // Add hint response to conversation history
          this.codeAnalysis.addHint(response.text, hintLevel as 1 | 2)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
        }
        
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
        
        // If we're in a coding problem context, add clarification to codeAnalysis conversation history
        const currentProblem = this.getCurrentCodingProblem()
        if (currentProblem) {
          console.log('🎯 [Interview] Adding clarification to coding problem conversation history')
          this.codeAnalysis.addClarification(response.text)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
        }
        
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
      } else if (response.action === 'skip') {
        console.log('🎯 [Interview] ⏭️ Skipping question')
        
        // If there's text to speak, speak it first (if not included in evaluation feedback)
        // If evaluation is present, handleEvaluation will speak the feedback
        if (response.text && (!response.evaluation || !response.evaluation.feedback)) {
          const speakResult = await this.speakWithPolicy(response.text, {
            interruptible: false,
            bargeInPolicy: 'soft'
          })
          
          // Only proceed if speech completed
          if (!speakResult.completed && !speakResult.softStopped) {
            console.log('🎯 [Interview] Skip message not completed, waiting...')
            return
          }
        }
        
        // Handle evaluation if present (records score 0 and transitions)
        if (response.evaluation) {
          console.log('🎯 [Interview] Handling skip evaluation:', response.evaluation)
          await this.handleEvaluation(response.evaluation)
        } else {
          // Fallback if no evaluation provided - create one and handle it
          console.log('🎯 [Interview] No evaluation provided for skip, creating default evaluation')
          const currentQuestion = this.llm.getCurrentQuestion()
          if (currentQuestion) {
            const skipEvaluation: Evaluation = {
              questionId: currentQuestion.id,
              candidateAnswer: "User requested to skip this question",
              keyPointsCovered: [],
              score: 0,
              needsFollowUp: false,
              feedback: response.text || "Alright, let's move to the next question."
            }
            await this.handleEvaluation(skipEvaluation)
          } else {
            // Last resort: force move to next question
            await this.forceMoveToNextQuestion()
          }
        }
      } else if (response.action === 'evaluate' && response.evaluation) {
        console.log('🎯 [Interview] 📊 Handling evaluation:', response.evaluation)
        await this.handleEvaluation(response.evaluation)
      }
    } else if (currentState === InterviewState.WAITING_FOR_APPROACH) {
      // Candidate is providing their approach
      console.log('🎯 [Interview] 💭 Processing approach explanation:', text)
      this.stateMachine.clearSilenceTimer()
      
      const problem = this.getCurrentCodingProblem()
      if (!problem) {
        console.log('🎯 [Interview] No current coding problem found')
        return
      }

      // Check if user is actively writing code
      const currentCode = this.stateMachine.getPreviousCode()
      const isWritingCode = currentCode && currentCode.trim().length > 0
      
      // First, detect intent to check if this is a hint/clarification request
      // This should be done BEFORE calling evaluateApproach to properly handle hint requests
      console.log('🎯 [Interview] Detecting intent for approach phase transcript:', text)
      const intent = await this.llm.detectIntent(text)
      console.log('🎯 [Interview] Detected intent during approach phase:', intent)
      
      // Handle hint requests during approach phase
      if (intent.intent === 'hint_request') {
        console.log('🎯 [Interview] ✨ Handling hint request during approach phase')
        await this.withManualResponse('hint', 'approach_manual_hint', async () => {
          if (!this.stateMachine.canProvideCodingHint()) {
            console.log('🎯 [Interview] Coding hint limit reached, informing candidate')
            const limitMessage = "I've provided the maximum number of hints. Please continue with your approach."
            
            // IMPORTANT: Record limit message in conversation history
            if (problem) {
              this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
                type: 'feedback',
                codingProblemId: problem.id,
                section: 'coding'
              } as any)
              this.syncConversationHistoryFromServices()
            }
            
            await this.speakWithPolicy(
              limitMessage,
              {
                interruptible: false,
                bargeInPolicy: 'soft'
              },
              { kind: 'hint', priority: 'manual', source: 'approach_manual_hint_limit' }
            )
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          const hintNumber = this.stateMachine.incrementCodingHintCount()
          const hintLevel = Math.min(hintNumber, 2) as 1 | 2
          console.log('🎯 [Interview] Providing manual coding hint at level:', hintLevel)
          
          // IMPORTANT: Add user's hint request to conversation history FIRST
          this.codeAnalysis.addHintRequest(text) // This adds the user's request as a user message with type 'hint'
          console.log('🎯 [Interview] Added user hint request to conversation history')
          
          // Use approach-phase hint method (no code context) for approach phase
          const hint = await this.codeAnalysis.getApproachHint(problem, hintLevel)
          
          // Add hint response to conversation history
          this.codeAnalysis.addHint(hint, hintLevel)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
          const result = await this.speakWithPolicy(
            hint,
            {
              interruptible: true,
              bargeInPolicy: 'hard'
            },
            { kind: 'hint', priority: 'manual', source: 'approach_manual_hint' }
          )
          if (result.completed) {
            this.emit('hintProvided', hint)
            // Restart 2-minute silence timer and wait for approach again
            this.stateMachine.startSilenceTimer(120000)
            await this.stateMachine.transition('approach_needs_retry')
          }
        })
        return
      }
      
      // Handle clarification requests during approach phase
      if (intent.intent === 'clarification_request') {
        console.log('🎯 [Interview] ✨ Handling clarification request during approach phase')
        await this.withManualResponse('clarification', 'approach_manual_clarification', async () => {
          if (!this.stateMachine.canAskCodingClarification()) {
            console.log('🎯 [Interview] Coding clarification limit reached')
            const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
            
            // IMPORTANT: Record limit message in conversation history
            if (problem) {
              this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
                type: 'feedback',
                codingProblemId: problem.id,
                section: 'coding'
              } as any)
              this.syncConversationHistoryFromServices()
            }
            
            await this.speakWithPolicy(
              limitMessage,
              {
                interruptible: false,
                bargeInPolicy: 'soft'
              },
              { kind: 'clarification', priority: 'manual', source: 'approach_manual_clarification_limit' }
            )
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          this.stateMachine.incrementCodingClarificationCount()
          
          // IMPORTANT: Add user's clarification request to conversation history FIRST
          this.codeAnalysis.addClarificationRequest(text) // This adds the user's request as a user message with type 'clarification'
          console.log('🎯 [Interview] Added user clarification request to conversation history')
          
          // Call LLM service to generate clarification
          const clarification = await this.llm.generateCodingClarification(
            problem,
            text,
            this.stateMachine.getCodingClarificationCount(),
            currentCode
          )
          
          // Add clarification response to conversation history
          this.codeAnalysis.addClarification(clarification)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
          const result = await this.speakWithPolicy(
            clarification,
            {
              interruptible: false,
              bargeInPolicy: 'soft'
            },
            { kind: 'clarification', priority: 'manual', source: 'approach_manual_clarification' }
          )
          if (result.completed || result.softStopped) {
            // Restart 2-minute silence timer and wait for approach again
            this.stateMachine.startSilenceTimer(120000)
            await this.stateMachine.transition('approach_needs_retry')
          }
        })
        return
      }
      
      // Handle skip_question intent during approach phase (when user says "I don't know" or "skip")
      // Just show the modal - no verbal response until user confirms
      if (intent.intent === 'skip_question') {
        console.log('🎯 [Interview] ✨ Skip question requested during approach phase - showing confirmation modal')
        
        // Request confirmation from renderer (this will show the modal)
        const confirmed = await this.requestSkipConfirmation()
        
        if (!confirmed) {
          console.log('🎯 [Interview] User cancelled skip question request during approach phase')
          return
        }
        
        // Only proceed with skip if user confirmed in modal
        console.log('🎯 [Interview] User confirmed skip during approach phase - proceeding with skip')
        await this.withManualResponse('system', 'approach_skip_question', async () => {
          // Acknowledge the skip (only after confirmation)
          const skipMessage = "Understood. Let's move on to the next problem."
          
          // Record in conversation history
          this.codeAnalysis.addConversationMessage('assistant', skipMessage, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()
          
          await this.speakWithPolicy(
            skipMessage,
            {
              interruptible: false,
              bargeInPolicy: 'soft'
            },
            { kind: 'system', priority: 'manual', source: 'approach_skip_question' }
          )
          
          // Submit an empty solution with score 0 to move to the next problem
          // This properly handles the transition to next problem or end of coding section
          try {
            await this.submitCodingSolution('// Skipped by candidate', false)
          } catch (error) {
            console.error('🎯 [Interview] Error during skip submission:', error)
            // Fallback: try to transition to next problem or end interview
            const codingProblems = this.currentSession?.codingProblems || []
            const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
            const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1
            
            if (hasNextProblem) {
              const nextProblem = codingProblems[currentProblemIndex + 1]
              this.codeAnalysis.setCurrentProblem(nextProblem)
              this.currentProblemId = nextProblem.id
              await this.stateMachine.setState(InterviewState.CODING_PROBLEM)
            } else {
              // No more problems - go to wrap up
              await this.stateMachine.setState(InterviewState.WRAP_UP)
            }
          }
        })
        return
      }
      
      // For other intents (answer/approach), proceed with normal approach evaluation
      // Transition to evaluating approach FIRST (before length check)
      // This allows sentiment analysis to detect hints/clarifications even for short text
      await this.stateMachine.transition('approach_provided')
      
      // Add verbal explanation to conversation history
      this.codeAnalysis.addVerbalExplanation(text)
      // Sync to centralized history
      this.syncConversationHistoryFromServices()
      
      // Evaluate the approach with current code
      // Check if this is the first approach before evaluation
      const isFirstApproach = !this.stateMachine.hasCodingApproachSpoken()
      try {
        const response = await this.codeAnalysis.evaluateApproach(text, problem, currentCode, isFirstApproach)
        
        console.log('🎯 [Interview] 💡 Approach evaluation:', response)
        
        // Check text length AFTER sentiment analysis
        const textLength = text.trim().length
        const isShortText = textLength < 80
        
        // If user is writing code, treat any speech as approach attempt (don't disturb them)
        if (isWritingCode) {
          console.log('🎯 [Interview] User is writing code - treating speech as approach attempt')
          
          // Always respond to clarifications/hints, even if short
          if (response.isClarification) {
            // IMPORTANT: Add user's clarification request to conversation history FIRST
            this.codeAnalysis.addClarificationRequest(text) // This adds the user's request as a user message with type 'clarification'
            console.log('🎯 [Interview] Added user clarification request to conversation history')
            
            const clarification = response.clarification || response.feedback || "Let me clarify that for you."
            // Add clarification response to conversation history
            this.codeAnalysis.addClarification(clarification)
            // Sync to centralized history
            this.syncConversationHistoryFromServices()
            
            await this.speakWithPolicy(clarification, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            await this.stateMachine.transition('approach_approved')
            return
          }
          
          // For approach explanations while coding: if short and unclear, don't respond
          if (isShortText && !response.isApproach) {
            console.log('🎯 [Interview] Short unclear text (< 80 chars) while coding - not responding')
            this.stateMachine.setCodingApproachSpoken(true)
            await this.stateMachine.transition('approach_approved')
            return
          }
          
          // Mark approach as spoken to prevent further prompts
          this.stateMachine.setCodingApproachSpoken(true)
          
          if (response.isApproach && response.isCorrect) {
            // Good approach - give brief positive feedback
            const feedback = response.feedback || "Good approach! Keep implementing."
            await this.speakWithPolicy(feedback, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            // Transition to monitoring code
            await this.stateMachine.transition('approach_approved')
          } else if (response.isApproach && !response.isCorrect) {
            // Wrong approach but they're coding - just acknowledge, don't interrupt
            const feedback = response.feedback || "I see. Keep working on your solution."
            await this.speakWithPolicy(feedback, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            // Still transition to monitoring - let them code
            await this.stateMachine.transition('approach_approved')
          } else {
            // Not clear approach but they're coding - just acknowledge silently
            // Don't speak anything, just transition
            await this.stateMachine.transition('approach_approved')
          }
        } else {
          // User is NOT writing code - normal flow
          
          // Always respond to clarifications/hints, even if short
          if (response.isClarification) {
            // IMPORTANT: Add user's clarification request to conversation history FIRST
            this.codeAnalysis.addClarificationRequest(text) // This adds the user's request as a user message with type 'clarification'
            console.log('🎯 [Interview] Added user clarification request to conversation history')
            
            const clarification = response.clarification || response.feedback || "Let me clarify that for you."
            // Add clarification response to conversation history
            this.codeAnalysis.addClarification(clarification)
            // Sync to centralized history
            this.syncConversationHistoryFromServices()
            
            const result = await this.speakWithPolicy(clarification, {
              interruptible: false,
              bargeInPolicy: 'soft'
            })
            if (result.completed || result.softStopped) {
              // Restart 2-minute silence timer and wait for approach again
              this.stateMachine.startSilenceTimer(120000)
              await this.stateMachine.transition('approach_needs_retry')
            }
            return
          }
          
          // Check if sentiment is unclear (not approach, not clarification)
          const isUnclear = !response.isApproach && !response.isClarification
          
          // For approach explanations: reject if short AND unclear
          // But allow short text if it's a valid approach (let sentiment analysis decide)
          if (isUnclear) {
            console.log('🎯 [Interview] Unclear sentiment - not replying')
            // Don't reply, just restart silence timer and continue waiting
            this.stateMachine.startSilenceTimer(120000)
            await this.stateMachine.transition('approach_needs_retry')
            return
          }
          
          // For approach explanations: reject if short (only for approach, not clarifications)
          if (response.isApproach && isShortText) {
            console.log('🎯 [Interview] Short approach explanation (< 80 chars) - not responding')
            // Don't reply, just restart silence timer and continue waiting
            this.stateMachine.startSilenceTimer(120000)
            await this.stateMachine.transition('approach_needs_retry')
            return
          }
          
          if (response.isApproach) {
            // Mark that approach has been spoken (whether correct or not)
            this.stateMachine.setCodingApproachSpoken(true)
            console.log('🎯 [Interview] ✅ Approach spoken flag set to true')
            
            if (response.isCorrect) {
              // Correct approach - encourage and move to coding
              const feedback = response.feedback || "That's a solid approach! Go ahead and implement it."
              const result = await this.speakWithPolicy(feedback, {
                interruptible: false,
                bargeInPolicy: 'soft'
              })
              if (result.completed || result.softStopped) {
                await this.stateMachine.transition('approach_approved')
              }
            } else {
              // Wrong approach - provide feedback but still let them code
              // Code monitoring should work regardless of approach quality
              const feedback = response.feedback || "That's an interesting approach. Let's proceed with the implementation and see how it goes."
              const result = await this.speakWithPolicy(feedback, {
                interruptible: false,
                bargeInPolicy: 'soft'
              })
              if (result.completed || result.softStopped) {
                // Always transition to monitoring_code - let them code and monitor
                await this.stateMachine.transition('approach_approved')
              }
            }
          } else {
            // Not a clear approach - ask them to explain approach (ONLY if no code written)
            // But limit this to once to avoid continuous disturbance
            const approachPromptCount = this.stateMachine.getApproachPromptCount()
            if (approachPromptCount === 0) {
              // First time asking - can ask once
              this.stateMachine.incrementApproachPromptCount()
              const acknowledgement = "I'd like to hear your approach to solving this problem. How do you plan to tackle it?"
              
              // IMPORTANT: Record approach prompt in conversation history
              const problem = this.getCurrentCodingProblem()
              if (problem) {
                this.codeAnalysis.addConversationMessage('assistant', acknowledgement, {
                  type: 'feedback',
                  codingProblemId: problem.id,
                  section: 'coding'
                } as any)
                this.syncConversationHistoryFromServices()
              }
              
              const result = await this.speakWithPolicy(acknowledgement, {
                interruptible: false,
                bargeInPolicy: 'soft'
              })
              if (result.completed || result.softStopped) {
                // Restart 2-minute silence timer and wait for approach again
                this.stateMachine.startSilenceTimer(120000)
                await this.stateMachine.transition('approach_needs_retry')
              }
            } else {
              // Already asked once - don't ask again, just mark approach as spoken and move on
              console.log('🎯 [Interview] Already prompted for approach once, treating as approach and moving on')
              this.stateMachine.setCodingApproachSpoken(true)
              await this.stateMachine.transition('approach_approved')
            }
          }
        }
      } catch (error) {
        console.error('🎯 [Interview] Error evaluating approach:', error)
        // Fallback - accept and move forward
        const feedback = "I understand. Let's proceed with the implementation."
        
        // IMPORTANT: Record fallback feedback in conversation history
        const problem = this.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', feedback, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()
        }
        
        const result = await this.speakWithPolicy(feedback, {
          interruptible: false,
          bargeInPolicy: 'soft'
        })
        if (result.completed || result.softStopped) {
          await this.stateMachine.transition('approach_approved')
        }
      }
    } else if (currentState === InterviewState.MONITORING_CODE) {
      // During coding phase - detect intent first, then handle accordingly
      console.log('🎯 [Interview] 💻 Processing coding phase interaction:', text)
      
      // First, detect intent to check if this is a hint/clarification request
      console.log('🎯 [Interview] Detecting intent for coding phase transcript:', text)
      const intent = await this.llm.detectIntent(text)
      console.log('🎯 [Interview] Detected intent during coding:', intent)
      
      // Track hint/clarification requests immediately when intent is detected (for current 60s interval)
      if (intent.intent === 'hint_request' || intent.intent === 'clarification_request') {
        this.currentIntervalHasHintClarification = true
        console.log(`🎯 [Interview] Tracked ${intent.intent} request in current 60s interval`)
      }
      
      // Track user transcript length (for substantial speech >70 chars) in current 60s interval
      const transcriptLength = text.trim().length
      if (transcriptLength > 70) {
        this.currentIntervalHasSubstantialSpeech = true
        console.log(`🎯 [Interview] Tracked substantial user speech (${transcriptLength} chars) in current 60s interval`)
      }
      
      // Handle hint requests during coding
      if (intent.intent === 'hint_request') {
        console.log('🎯 [Interview] ✨ Handling hint request during coding phase')
        await this.withManualResponse('hint', 'coding_manual_hint', async () => {
          if (!this.stateMachine.canProvideCodingHint()) {
            console.log('🎯 [Interview] Coding hint limit reached, informing candidate')
            const limitMessage = "I've provided the maximum number of hints. Please continue with your implementation."
            
            // IMPORTANT: Record limit message in conversation history
            const problem = this.getCurrentCodingProblem()
            if (problem) {
              this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
                type: 'feedback',
                codingProblemId: problem.id,
                section: 'coding'
              } as any)
              this.syncConversationHistoryFromServices()
            }
            
            await this.speakWithPolicy(
              limitMessage,
              {
                interruptible: false,
                bargeInPolicy: 'soft'
              },
              { kind: 'hint', priority: 'manual', source: 'coding_manual_hint_limit' }
            )
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          const problem = this.getCurrentCodingProblem()
          if (!problem) {
            console.log('🎯 [Interview] No coding problem available for hint')
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          const hintNumber = this.stateMachine.incrementCodingHintCount()
          const hintLevel = Math.min(hintNumber, 2) as 1 | 2
          console.log('🎯 [Interview] Providing manual coding hint at level:', hintLevel)
          
          // IMPORTANT: Add user's hint request to conversation history FIRST
          this.codeAnalysis.addHintRequest(text) // This adds the user's request as a user message with type 'hint'
          console.log('🎯 [Interview] Added user hint request to conversation history')
          
          // Get current code from stored value (latest from editor) or fallback
          const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || ''
          console.log(`🎯 [Interview] Using current code for manual hint (length: ${currentCode.length})`)
          const hintText = await this.codeAnalysis.getHint(problem, currentCode, hintLevel)
          // Add hint response to conversation history
          this.codeAnalysis.addHint(hintText, hintLevel)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
          const result = await this.speakWithPolicy(
            hintText,
            {
              interruptible: true,
              bargeInPolicy: 'hard'
            },
            { kind: 'hint', priority: 'manual', source: 'coding_manual_hint' }
          )
          
          if (result.completed) {
            this.emit('hintProvided', hintText)
          }
          
          this.stateMachine.startSilenceTimer(120000)
        })
        return
      }
      
      // Handle clarification requests during coding
      if (intent.intent === 'clarification_request') {
        console.log('🎯 [Interview] ✨ Handling clarification request during coding phase')
        
        await this.withManualResponse('clarification', 'coding_manual_clarification', async () => {
          if (!this.stateMachine.canAskCodingClarification()) {
            console.log('🎯 [Interview] Coding clarification limit reached')
            const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
            
            // IMPORTANT: Record limit message in conversation history
            const problem = this.getCurrentCodingProblem()
            if (problem) {
              this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
                type: 'feedback',
                codingProblemId: problem.id,
                section: 'coding'
              } as any)
              this.syncConversationHistoryFromServices()
            }
            
            await this.speakWithPolicy(
              limitMessage,
              {
                interruptible: false,
                bargeInPolicy: 'soft'
              },
              { kind: 'clarification', priority: 'manual', source: 'coding_manual_clarification_limit' }
            )
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          const problem = this.getCurrentCodingProblem()
          if (!problem) {
            console.log('🎯 [Interview] No coding problem available for clarification')
            this.stateMachine.startSilenceTimer(120000)
            return
          }
          
          this.stateMachine.incrementCodingClarificationCount()
          
          // IMPORTANT: Add user's clarification request to conversation history FIRST
          this.codeAnalysis.addClarificationRequest(text) // This adds the user's request as a user message with type 'clarification'
          console.log('🎯 [Interview] Added user clarification request to conversation history')
          
          // Get current code from state machine or use empty string
          const currentCode = this.stateMachine.getPreviousCode() || ''
          
          // Call LLM service to generate clarification
          const clarification = await this.llm.generateCodingClarification(
            problem,
            text,
            this.stateMachine.getCodingClarificationCount(),
            currentCode
          )
          
          // Add clarification response to conversation history
          this.codeAnalysis.addClarification(clarification)
          // Sync to centralized history
          this.syncConversationHistoryFromServices()
          
          const result = await this.speakWithPolicy(
            clarification,
            {
              interruptible: true,
              bargeInPolicy: 'hard'
            },
            { kind: 'clarification', priority: 'manual', source: 'coding_manual_clarification' }
          )
          
          if (result.completed || result.softStopped) {
            this.stateMachine.startSilenceTimer(120000)
          }
        })
        return
      }
      
      // Handle skip_question intent during coding phase (when user says "I don't know" or "skip")
      // Just show the modal - no verbal response until user confirms
      if (intent.intent === 'skip_question') {
        console.log('🎯 [Interview] ✨ Skip question requested during coding phase - showing confirmation modal')
        
        // Request confirmation from renderer (this will show the modal)
        const confirmed = await this.requestSkipConfirmation()
        
        if (!confirmed) {
          console.log('🎯 [Interview] User cancelled skip question request')
          return
        }
        
        // Only proceed with skip if user confirmed in modal
        console.log('🎯 [Interview] User confirmed skip - proceeding with skip')
        await this.withManualResponse('system', 'coding_skip_question', async () => {
          const problem = this.getCurrentCodingProblem()
          
          // Acknowledge the skip (only after confirmation)
          const skipMessage = "Understood. Let's move on to the next problem."
          
          // Record in conversation history
          if (problem) {
            this.codeAnalysis.addConversationMessage('assistant', skipMessage, {
              type: 'feedback',
              codingProblemId: problem.id,
              section: 'coding'
            } as any)
            this.syncConversationHistoryFromServices()
          }
          
          await this.speakWithPolicy(
            skipMessage,
            {
              interruptible: false,
              bargeInPolicy: 'soft'
            },
            { kind: 'system', priority: 'manual', source: 'coding_skip_question' }
          )
          
          // Get current code (or empty if none) and submit to move to next problem
          const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || '// Skipped by candidate'
          
          try {
            await this.submitCodingSolution(currentCode, false)
          } catch (error) {
            console.error('🎯 [Interview] Error during skip submission:', error)
            // Fallback: try to transition to next problem or end interview
            if (problem) {
              const codingProblems = this.currentSession?.codingProblems || []
              const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
              const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1
              
              if (hasNextProblem) {
                const nextProblem = codingProblems[currentProblemIndex + 1]
                this.codeAnalysis.setCurrentProblem(nextProblem)
                this.currentProblemId = nextProblem.id
                await this.stateMachine.setState(InterviewState.CODING_PROBLEM)
              } else {
                // No more problems - go to wrap up
                await this.stateMachine.setState(InterviewState.WRAP_UP)
              }
            }
          }
        })
        return
      }
      
      // For other intents (answer, etc.), check length before acknowledging
      const trimmed = text.trim()
      if (trimmed.length < 80) {
        console.log('🎯 [Interview] Short utterance during coding (< 80 chars) - no acknowledgement')
        // IMPORTANT: Still record short utterances in conversation history
        const problem = this.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('user', text, {
            type: 'answer',
            codingProblemId: problem.id,
            section: 'coding'
          })
          this.syncConversationHistoryFromServices()
        }
        this.stateMachine.startSilenceTimer(120000)
        return
      }

      // IMPORTANT: Record user's speech in conversation history
      const problem = this.getCurrentCodingProblem()
      if (problem) {
        this.codeAnalysis.addConversationMessage('user', text, {
          type: 'answer',
          codingProblemId: problem.id,
          section: 'coding'
        })
        this.syncConversationHistoryFromServices()
      }

      const acknowledgement = "I understand. Keep working on your solution."
      await this.speakWithPolicy(acknowledgement, {
        interruptible: true,
        bargeInPolicy: 'hard'
      })
      this.stateMachine.startSilenceTimer(120000)
    } else {
      console.log('🎯 [Interview] ⚠️ Not in listening state, ignoring transcript. Current state:', currentState)
    }
    } finally {
      // LiveKit handles audio automatically, no manual mic management needed
    }
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    // Enqueue evaluation handling to ensure sequentiality (business handled in InterviewSession)
    return this.transitionQueue.enqueue(async () => {
      await this.engine.handleEvaluation(evaluation)
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

    // First, check if there are more theoretical questions available
    const progress = this.llm.getProgress()
    const hasMoreQuestions = progress.current < progress.total
    
    if (!hasMoreQuestions) {
      // No more questions in the array, move to coding regardless of limit
      console.log('🎯 [Interview] No more theoretical questions available, transitioning to all_questions_done')
      await this.stateMachine.transition('all_questions_done')
      return
    }

    // Check if reached theoretical limit (for preventing too many follow-ups)
    if (this.stateMachine.hasReachedTheoreticalLimit()) {
      console.log('🎯 [Interview] Reached theoretical limit, transitioning to all_questions_done')
      await this.stateMachine.transition('all_questions_done')
      return
    }

    // More questions available and under limit, move to next question
    this.stateMachine.moveToNextQuestion()
    this.llm.moveToNextQuestion()
    await this.stateMachine.transition('next_question')
  }

  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }): Promise<any> {
    if (!this.currentSession) {
      throw new Error('No active interview session')
    }

    // Store current code for manual hint requests
    this.currentCode = codeData.code

    try {
      const problem = this.codeAnalysis.getCurrentProblem() || this.currentSession?.codingProblems?.find(p => p.id === codeData.problemId) || null
      if (!problem) {
        throw new Error('No coding problem context')
      }

      // Always analyze code regardless of whether it's meaningful or not
      // The 60-second timer from frontend ensures we check every 60 seconds
      console.log('🎯 [Interview] Requesting code analysis (code length:', codeData.code?.length || 0, ')')
      const analysis = await this.codeAnalysis.analyzeCode(codeData.code || '', problem)

      // Only provide hints if LLM detected stuck (LLM is only called every 60s, so if isStuck is true, 60s have passed)
      // IMPORTANT: Only provide automatic hints when actually in MONITORING_CODE state
      // Don't provide hints during approach phase (WAITING_FOR_APPROACH, CODING_APPROACH, etc.)
      const currentState = this.stateMachine.getState()
      const isMonitoringCode = currentState === InterviewState.MONITORING_CODE
      
      if (!isMonitoringCode) {
        console.log(`🎯 [Interview] Skipping automatic hint - not in MONITORING_CODE state (current: ${currentState})`)
        return analysis
      }

      // Check additional conditions for auto-hint:
      // 1. No hint/clarification requests in current 60s interval
      // 2. No substantial user speech (>70 chars) in current 60s interval
      const shouldProvideHint = analysis.isStuck && !this.currentIntervalHasHintClarification && !this.currentIntervalHasSubstantialSpeech
      
      console.log(`🎯 [Interview] Stuck check - LLM isStuck: ${analysis.isStuck}, Progress: ${analysis.progress}%`)
      console.log(`🎯 [Interview] Auto-hint conditions - Has hint/clarification in interval: ${this.currentIntervalHasHintClarification}, Has substantial speech (>70 chars): ${this.currentIntervalHasSubstantialSpeech}`)
      console.log(`🎯 [Interview] Should provide auto-hint: ${shouldProvideHint}`)
      
      // Reset tracking flags for next 60s interval (after checking current interval)
      this.currentIntervalHasHintClarification = false
      this.currentIntervalHasSubstantialSpeech = false
      console.log(`🎯 [Interview] Reset tracking flags for next 60s interval`)
      
      if (shouldProvideHint) {
        if (this.userSpeaking) {
          console.log('🎯 [Interview] User currently speaking during stuck detection - deferring monitoring hint until next interval')
          return analysis
        }
        // LiveKit handles audio automatically
        this.autoHintInProgress = true
        try {
          if (this.shouldSkipAutoResponse('monitoring_auto_hint')) {
            return analysis
          }
          if (!this.stateMachine.canProvideCodingHint()) {
            console.log('🎯 [Interview] Candidate stuck but hint limit reached, skipping hint')
          } else {
            console.log(`🎯 [Interview] Candidate stuck (detected by LLM after 60s), providing monitoring hint`)
            const hintNumber = this.stateMachine.incrementCodingHintCount()
            const hintLevel = Math.min(hintNumber, 2) as 1 | 2
            const hintText = await this.codeAnalysis.getHint(problem, codeData.code, hintLevel)
            // Add hint to conversation history
            this.codeAnalysis.addHint(hintText, hintLevel)
            // Sync to centralized history
            this.syncConversationHistoryFromServices()
            
            const result = await this.speakWithPolicy(hintText, {
              interruptible: true,
              bargeInPolicy: 'hard'
            })
            if (result.completed) {
              this.emit('hintProvided', hintText)
            }
          }
        } finally {
          this.autoHintInProgress = false
          // LiveKit handles audio automatically
        }
      }

      return analysis

    } catch (error) {
      console.error('Code analysis error:', error)
      throw error
    }
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
    console.log('🎯 [Interview] submitCodingSolution called, current state:', currentState)

    try {
      const problem = this.codeAnalysis.getCurrentProblem()
      if (!problem) {
        throw new Error('No current coding problem')
      }

      console.log('🎯 [Interview] 📝 Candidate submitted solution for:', problem.title, isTimeout ? '(timeout)' : '')
      console.log('🎯 [Interview] 📊 TC/SC received:', {
        timeComplexity: timeComplexity || 'NOT PROVIDED',
        spaceComplexity: spaceComplexity || 'NOT PROVIDED',
        timeComplexityType: typeof timeComplexity,
        spaceComplexityType: typeof spaceComplexity,
        timeComplexityLength: timeComplexity?.length || 0,
        spaceComplexityLength: spaceComplexity?.length || 0
      })

      // Store final code and complexity in CodeAnalysisService
      this.codeAnalysis.setFinalCode(code, timeComplexity, spaceComplexity)
      
      // Verify what was stored
      const storedSubmission = this.codeAnalysis.getFinalSubmission()
      console.log('🎯 [Interview] 📊 TC/SC stored in service:', {
        timeComplexity: storedSubmission.timeComplexity || 'NOT STORED',
        spaceComplexity: storedSubmission.spaceComplexity || 'NOT STORED'
      })
      
      // Sync to centralized history
      this.syncConversationHistoryFromServices()
      
      // Check if message was created with TC/SC
      const codeAnalysisHistory = this.codeAnalysis.getConversationHistory()
      const codeSubmissionMsg = codeAnalysisHistory.find(msg => msg.metadata.type === 'code_submission')
      if (codeSubmissionMsg) {
        const metadata = codeSubmissionMsg.metadata as any
        console.log('🎯 [Interview] 📊 Code submission message metadata:', {
          hasTimeComplexity: !!metadata.timeComplexity,
          hasSpaceComplexity: !!metadata.spaceComplexity,
          timeComplexity: metadata.timeComplexity || 'MISSING',
          spaceComplexity: metadata.spaceComplexity || 'MISSING'
        })
      }

      // Analyze the submitted code
      const analysis = await this.codeAnalysis.analyzeCode(code, problem)
      // Sync again after analysis (analysis adds a message)
      this.syncConversationHistoryFromServices()
      
      console.log('🎯 [Interview] Code analysis result:', {
        progress: analysis.progress,
        approach: analysis.approach,
        issues: analysis.issues,
        codeQuality: analysis.codeQuality
      })
      
      // Generate detailed feedback based on code analysis
      let feedback = ''
      if (isTimeout) {
        // Brief feedback for timeout
        if (analysis.progress >= 50) {
          feedback = "Time's up. Moving on."
        } else {
          feedback = "Time's up. Let's continue."
        }
      } else {
        // Generate detailed feedback using LLM service
        try {
          feedback = await this.llm.generateSubmissionFeedback(
            problem,
            code,
            {
              progress: analysis.progress,
              approach: analysis.approach,
              issues: analysis.issues,
              codeQuality: analysis.codeQuality
            }
          )
          console.log('🎯 [Interview] Generated detailed feedback:', feedback)
        } catch (error) {
          console.error('🎯 [Interview] Error generating detailed feedback, using fallback:', error)
          // Fallback to basic feedback if LLM call fails
          if (analysis.approach === 'correct' && analysis.progress >= 80) {
            feedback = "Your solution is correct. Well done."
          } else if (analysis.approach === 'incorrect') {
            const mainIssue = analysis.issues[0] || "there's a logic error in your approach"
            feedback = `Your solution has issues. ${mainIssue}.`
          } else if (analysis.approach === 'incomplete') {
            const mainIssue = analysis.issues[0] || "some parts are missing"
            feedback = `Your solution is incomplete. ${mainIssue}.`
          } else if (analysis.progress >= 50) {
            const mainIssue = analysis.issues[0] || "there are some issues to address"
            feedback = `You've made good progress, but ${mainIssue}.`
          } else {
            feedback = "Your solution needs more work. Let's move on."
          }
        }
      }

      await this.speakWithPolicy(feedback, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })

      // Check if there are more coding problems
      const codingProblems = this.currentSession.codingProblems || []
      const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
      const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1
      console.log('🎯 [Interview] Checking for next problem:')
      console.log('🎯 [Interview]   Current problem index:', currentProblemIndex)
      console.log('🎯 [Interview]   Total problems:', codingProblems.length)
      console.log('🎯 [Interview]   Has next problem:', hasNextProblem)

      if (hasNextProblem) {
        const nextProblem = codingProblems[currentProblemIndex + 1]
        console.log('🎯 [Interview] Moving to next coding problem:', nextProblem.title)
        console.log('🎯 [Interview] Current problem being stored:', problem.title, 'ID:', problem.id)

        this.stateMachine.clearSilenceTimer()
        
        // Sync conversation history from services before storing
        // IMPORTANT: Do this BEFORE we set the next problem, otherwise codeAnalysis history gets cleared
        console.log('🎯 [Interview] Syncing conversation history before storing problem:', problem.id)
        this.syncConversationHistoryFromServices()
        
        // Log centralized history state before filtering
        console.log('🎯 [Interview] Full centralized history before filtering:', this.fullConversationHistory.length, 'messages')
        console.log('🎯 [Interview] Messages with codingProblemId:', this.fullConversationHistory.filter(m => m.metadata.codingProblemId).length)
        console.log('🎯 [Interview] Messages for problem', problem.id, ':', this.fullConversationHistory.filter(m => m.metadata.codingProblemId === problem.id).length)
        
        // Store coding conversation for current problem before moving to next
        // Use centralized conversation history instead of codeAnalysis history
        const problemConversationHistory = this.getProblemConversationHistory(problem.id)
        console.log('🎯 [Interview] Storing conversation for problem:', problem.id, problem.title)
        console.log('🎯 [Interview] Conversation history from centralized store:', problemConversationHistory.length)
        console.log('🎯 [Interview] Existing conversations before storing:', this.codingProblemConversations.length)
        
        // Log what messages we're storing
        if (problemConversationHistory.length > 0) {
          console.log('🎯 [Interview] Messages being stored:')
          problemConversationHistory.forEach((msg, idx) => {
            const metadata = msg.metadata as any
            let logLine = `  [${idx + 1}] ${msg.role} (${msg.metadata.type}) - ${msg.content.substring(0, 60)}...`
            if (msg.metadata.type === 'code_submission') {
              if (metadata.timeComplexity || metadata.spaceComplexity) {
                logLine += ` [TC: ${metadata.timeComplexity || 'N/A'}, SC: ${metadata.spaceComplexity || 'N/A'}]`
              } else {
                logLine += ` [TC/SC: MISSING in metadata]`
              }
            }
            console.log(logLine)
          })
        } else {
          console.warn('⚠️ [Interview] WARNING: No conversation history found for problem:', problem.id)
          console.warn('⚠️ [Interview] This might mean messages were not properly tagged with codingProblemId')
        }
        
        const finalSubmission = this.codeAnalysis.getFinalSubmission()
        console.log('🎯 [Interview] Final submission TC/SC:', {
          timeComplexity: finalSubmission.timeComplexity || 'NOT SET',
          spaceComplexity: finalSubmission.spaceComplexity || 'NOT SET'
        })
        
        // Ensure code submission message in conversation has TC/SC if we have it
        const codeSubmissionMsg = problemConversationHistory.find(
          msg => msg.metadata.type === 'code_submission'
        )
        if (codeSubmissionMsg) {
          const metadata = codeSubmissionMsg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            console.log('🔧 [Interview] Adding TC/SC to code submission message in conversation')
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        const problemConversation = {
          problemId: problem.id,
          problem,
          conversation: problemConversationHistory, // Use centralized history
          finalCode: finalSubmission.code,
          timeComplexity: finalSubmission.timeComplexity,
          spaceComplexity: finalSubmission.spaceComplexity,
          codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
          submittedAt: new Date(),
          evaluation: {
            score: analysis.progress,
            feedback,
            testResults: [] // TODO: Add test results if available
          }
        }
        this.codingProblemConversations.push(problemConversation)
        console.log('🎯 [Interview] ✅ Stored conversation for problem:', problem.id, 'Title:', problem.title)
        console.log('🎯 [Interview] Total conversations after storing:', this.codingProblemConversations.length)
        console.log('🎯 [Interview] Stored conversation has', problemConversation.conversation.length, 'messages')
        
        // Set the next problem and reset code analysis for it
        console.log('🎯 [Interview] Moving to next problem:', nextProblem.id, nextProblem.title)
        this.currentProblemId = nextProblem.id // Update current problem ID for conversation tracking
        
        // Verify the problem is set correctly
        console.log('🎯 [Interview] Setting problem in code analysis...')
        this.codeAnalysis.setCurrentProblem(nextProblem)
        
        // Verify problem was set
        const verifyProblem = this.codeAnalysis.getCurrentProblem()
        console.log('🎯 [Interview] Problem verification - ID:', verifyProblem?.id, 'Title:', verifyProblem?.title)
        if (!verifyProblem || verifyProblem.id !== nextProblem.id) {
          console.error('❌ [Interview] Problem not set correctly! Expected:', nextProblem.id, 'Got:', verifyProblem?.id)
        }
        
        // Clear any existing timers
        this.stateMachine.clearSilenceTimer()
        
        // Transition to CODING_PROBLEM state (this will trigger handleCodingProblem which presents the problem)
        // We need to force a state change to trigger the handler, so transition to a temporary state first if needed
        const targetState = InterviewState.CODING_PROBLEM
        if (currentState === targetState) {
          // If already in CODING_PROBLEM, temporarily transition away then back to trigger handler
          console.log('🎯 [Interview] Already in CODING_PROBLEM, forcing state reset')
          await this.stateMachine.setState(InterviewState.IDLE)
          await new Promise(resolve => setTimeout(resolve, 100)) // Small delay
        }
        
        // Now set to CODING_PROBLEM - this will trigger handleCodingProblem which:
        // 1. Emits 'presentCodingProblem' event (which starts speaking immediately)
        // 2. After 2s, transitions to 'ask_for_approach'
        console.log('🎯 [Interview] Setting state to CODING_PROBLEM - will present problem automatically')
        await this.stateMachine.setState(targetState)
        
        // Verify problem is still set after state change
        const verifyAfterState = this.codeAnalysis.getCurrentProblem()
        console.log('🎯 [Interview] Problem after state change - ID:', verifyAfterState?.id, 'Title:', verifyAfterState?.title)
        console.log('🎯 [Interview] State set to CODING_PROBLEM, problem will be presented and approach asked shortly')
        
        return {
          success: analysis.progress >= 70,
          feedback,
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
            feedback,
            testResults: []
          }
        }
        console.log('🎯 [Interview] Updated existing conversation with final submission')
      } else {
        console.log('🎯 [Interview] Storing new problem conversation')
        // Sync conversation history from services before storing
        this.syncConversationHistoryFromServices()
        
        // Store coding conversation for this problem using centralized history
        const problemConversationHistory = this.getProblemConversationHistory(problem.id)
        console.log('🎯 [Interview] Problem conversation history from centralized store:', problemConversationHistory.length)
        
        const finalSubmission = this.codeAnalysis.getFinalSubmission()
        console.log('🎯 [Interview] Final submission TC/SC:', {
          timeComplexity: finalSubmission.timeComplexity || 'NOT SET',
          spaceComplexity: finalSubmission.spaceComplexity || 'NOT SET'
        })
        
        // Ensure code submission message in conversation has TC/SC if we have it
        const codeSubmissionMsg = problemConversationHistory.find(
          msg => msg.metadata.type === 'code_submission'
        )
        if (codeSubmissionMsg) {
          const metadata = codeSubmissionMsg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            console.log('🔧 [Interview] Adding TC/SC to code submission message in conversation')
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
        
        const problemConversation = {
          problemId: problem.id,
          problem,
          conversation: problemConversationHistory, // Use centralized history
          finalCode: finalSubmission.code,
          timeComplexity: finalSubmission.timeComplexity,
          spaceComplexity: finalSubmission.spaceComplexity,
          codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
          submittedAt: new Date(),
          evaluation: {
            score: analysis.progress,
            feedback,
            testResults: [] // TODO: Add test results if available
          }
        }
        this.codingProblemConversations.push(problemConversation)
        console.log('🎯 [Interview] Stored problem conversation, total conversations:', this.codingProblemConversations.length)
      }
      
      console.log('🎯 [Interview] Transitioning to solution_complete (should move to WRAP_UP)')
      
      // Check if we can transition from current state
      const stateBeforeTransition = this.stateMachine.getState()
      console.log('🎯 [Interview] Attempting transition from state:', stateBeforeTransition)
      
      // If we're not in MONITORING_CODE, we might need to set it first
      if (stateBeforeTransition !== InterviewState.MONITORING_CODE) {
        console.log('🎯 [Interview] Not in MONITORING_CODE, setting state first')
        await this.stateMachine.setState(InterviewState.MONITORING_CODE)
        await new Promise(resolve => setTimeout(resolve, 100)) // Small delay
      }
      
      const transitionResult = await this.stateMachine.transition('solution_complete')
      console.log('🎯 [Interview] Transition result:', transitionResult)
      console.log('🎯 [Interview] State after transition:', this.stateMachine.getState())
      
      if (!transitionResult) {
        console.error('❌ [Interview] Failed to transition to WRAP_UP, forcing state change')
        await this.stateMachine.setState(InterviewState.WRAP_UP)
      }

      return {
        success: analysis.progress >= 70,
        feedback,
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
    if (this.isManualResponseActive()) {
      console.log(`🎯 [Interview] Skipping auto response (${trigger}) - manual ${this.manualResponseInFlight?.kind} in progress`)
      return true
    }
    return false
  }

  private getSilenceTimerDuration(state: InterviewState): number {
    switch (state) {
      case InterviewState.MONITORING_CODE:
        return 60000
      case InterviewState.THEORETICAL_QUESTION:
      case InterviewState.WAITING_FOR_ANSWER:
        return 40000
      case InterviewState.WAITING_FOR_APPROACH:
      default:
        return 120000
    }
  }

  private async handleSilenceTimeout(): Promise<void> {
    const currentState = this.stateMachine.getState()
    console.log('🎯 [Interview] Silence timeout (2 mins) detected in state:', currentState)
    
    if (this.isManualResponseActive()) {
      const delay = this.getSilenceTimerDuration(currentState)
      console.log('🎯 [Interview] Manual response active - deferring silence handler for', delay, 'ms')
      this.stateMachine.startSilenceTimer(delay)
      return
    }
    
    // Handle silence timeout during coding approach waiting
    if (currentState === InterviewState.WAITING_FOR_APPROACH) {
      const approachSpoken = this.stateMachine.hasCodingApproachSpoken()
      const approachPromptCount = this.stateMachine.getApproachPromptCount()
      const codingHintCount = this.stateMachine.getCodingHintCount()
      const moveOnPromptGiven = this.stateMachine.hasCodingMoveOnPromptGiven()
      
      console.log('🎯 [Interview] Approach status - spoken:', approachSpoken, 'prompts:', approachPromptCount, 'hints:', codingHintCount, 'move-on:', moveOnPromptGiven)
      
      // If approach already spoken, don't prompt - just monitor
      if (approachSpoken) {
        console.log('🎯 [Interview] Approach already spoken, just monitoring')
        this.stateMachine.startSilenceTimer(120000) // Continue monitoring
        return
      }
      
      // First silence: Ask to explain approach (only once)
      if (approachPromptCount === 0) {
        this.stateMachine.incrementApproachPromptCount()
        console.log('🎯 [Interview] First silence - prompting for approach (1 time only)')
        
        const reminder = "Please explain your approach to solving this problem, or feel free to ask any clarifying questions."
        
        // IMPORTANT: Record approach reminder in conversation history
        const problem = this.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', reminder, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()
        }
        
        if (this.shouldSkipAutoResponse('approach_silence_prompt')) {
          this.stateMachine.startSilenceTimer(120000)
          return
        }
        
        await this.speakWithPolicy(
          reminder,
          {
            interruptible: true,
            bargeInPolicy: 'hard'
          },
          { kind: 'prompt', priority: 'auto', source: 'approach_silence_prompt' }
        )
        // Restart the 2-minute timer
        this.stateMachine.startSilenceTimer(120000)
        return
      }
      
      // Second/Third silence: Provide escalating hints (max 2)
      if (codingHintCount < 2) {
        const hintLevel = (codingHintCount + 1) as 1 | 2
        console.log('🎯 [Interview] Silence detected - providing escalating hint level', hintLevel)
        
        // Pause mic immediately when we decide to provide hint (before any checks)
        // LiveKit handles audio automatically
        this.autoHintInProgress = true
        try {
          // Increment hint count
          this.stateMachine.incrementCodingHintCount()
          
          // Provide escalating hint through code analysis service
          const problem = this.getCurrentCodingProblem()
          if (problem) {
            // For approach phase, use approach hint (no code context)
            // For monitoring phase, use regular hint (with code context)
            const currentState = this.stateMachine.getState()
            const isApproachPhase = currentState === InterviewState.WAITING_FOR_APPROACH
            const hint = isApproachPhase 
              ? await this.codeAnalysis.getApproachHint(problem, hintLevel)
              : await this.codeAnalysis.getHint(problem, this.currentCode || this.stateMachine.getPreviousCode() || '', hintLevel)
            if (this.shouldSkipAutoResponse('silence_hint')) {
              this.stateMachine.startSilenceTimer(120000)
              return
            }
            // Add automatic timeout hint to conversation history with metadata
            // Note: addHint doesn't support metadata, so we'll add it directly
            this.codeAnalysis.addConversationMessage('assistant', hint, {
              type: 'hint',
              hintLevel: hintLevel,
              // Mark as automatic timeout hint (using any to allow additional metadata)
              isAutomatic: true,
              source: 'timeout'
            } as any)
            // Sync to centralized history
            this.syncConversationHistoryFromServices()
            
            await this.speakWithPolicy(
              hint,
              {
                interruptible: true,
                bargeInPolicy: 'hard'
              },
              { kind: 'hint', priority: 'auto', source: 'approach_silence_hint' }
            )
            this.emit('hintProvided', hint)
          }
        } finally {
          this.autoHintInProgress = false
          // LiveKit handles audio automatically
        }
        
        // Restart the 2-minute timer
        this.stateMachine.startSilenceTimer(120000)
        return
      }
      
      // After 2 hints exhausted: Ask to move on (only once)
      if (!moveOnPromptGiven) {
        console.log('🎯 [Interview] Hints exhausted, asking if want to move on')
        this.stateMachine.setCodingMoveOnPromptGiven(true)
        
        const moveOnPrompt = "Would you like to move on to the next question?"
        
        // IMPORTANT: Record move-on prompt in conversation history
        const problem = this.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', moveOnPrompt, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()
        }
        
        if (this.shouldSkipAutoResponse('approach_move_on_prompt')) {
          this.stateMachine.startSilenceTimer(120000)
          return
        }
        
        await this.speakWithPolicy(
          moveOnPrompt,
          {
            interruptible: true,
            bargeInPolicy: 'hard'
          },
          { kind: 'prompt', priority: 'auto', source: 'approach_move_on_prompt' }
        )
        this.stateMachine.startSilenceTimer(120000)
        return
      }
      
      // After move-on prompt: just wait silently until timer expires
      console.log('🎯 [Interview] Move-on already prompted, waiting silently')
      this.stateMachine.startSilenceTimer(120000) // Continue monitoring silently
      return
    }
    
    // Handle silence timeout during code monitoring
    // Removed automatic hint cycle during code monitoring
    
    // Handle silence timeout for theoretical questions (existing logic)
    if (currentState === InterviewState.THEORETICAL_QUESTION || currentState === InterviewState.WAITING_FOR_ANSWER) {
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        // Use unified hint event counter for silence too
        const hintEvents = this.stateMachine.incrementHintEventCount()
        console.log('🎯 [Interview] Combined hint event count (silence):', hintEvents)
        
        try {
          if (hintEvents === 1) {
            // First silence: provide a hint (automatic timeout hint)
            const hintLevel = this.stateMachine.getHintLevel()
            console.log('🎯 [Interview] First hint event (silence) - providing automatic timeout hint at level:', hintLevel)
            // Pause mic immediately when we decide to provide hint (before LLM work)
            // LiveKit handles audio automatically
            this.autoHintInProgress = true
            try {
              const hintText = await this.llm.generateTheoreticalHint(currentQuestion, hintLevel)
            
              if (this.shouldSkipAutoResponse('theoretical_silence_hint')) {
                this.stateMachine.startSilenceTimer(40000)
                return
              }
              
              // IMPORTANT: Add automatic timeout hint to conversation history with metadata
              this.llm.addConversationMessage('assistant', hintText, {
                type: 'hint',
                questionId: currentQuestion.id,
                hintLevel: hintLevel,
                section: 'theoretical',
                // Mark as automatic timeout hint (using any to allow additional metadata)
                isAutomatic: true,
                source: 'timeout'
              } as any)
              // Sync to centralized history
              this.syncConversationHistoryFromServices()
              
              const result = await this.speakWithPolicy(
                hintText,
                {
                  interruptible: true,
                  bargeInPolicy: 'hard'
                },
                { kind: 'hint', priority: 'auto', source: 'theoretical_silence_hint' }
              )
              if (result.completed) {
                this.emit('hintProvided', hintText)
                // Increment hint level for potential subsequent hint
                this.stateMachine.incrementHintLevel()
                // Restart timer for potential second silence
                this.stateMachine.startSilenceTimer(40000)
              }
            } finally {
              this.autoHintInProgress = false
              // LiveKit handles audio automatically
            }
          } else {
            // Second hint-related event: provide answer and move on (no second hint)
            const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
            const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
            console.log('🎯 [Interview] Second hint event (silence) - providing answer and moving to next question')
            
            if (this.shouldSkipAutoResponse('theoretical_silence_answer')) {
              this.stateMachine.startSilenceTimer(40000)
              return
            }
            
            // IMPORTANT: Record the answer in conversation history
            this.llm.addConversationMessage('assistant', finalPrompt, {
              type: 'answer',
              questionId: currentQuestion.id,
              section: 'theoretical',
              hintLevel: 2
            } as any)
            // Sync to centralized history
            this.syncConversationHistoryFromServices()
            
            await this.speakWithPolicy(
              finalPrompt,
              {
                interruptible: false,
                bargeInPolicy: 'soft'
              },
              { kind: 'answer', priority: 'auto', source: 'theoretical_silence_answer' }
            )
            // Do not restart silence timer; progress to next
            await this.forceMoveToNextQuestion()
          }
        } catch (error) {
          console.error('Error providing automatic hint:', error)
        }
      }
    }
  }

  private async askForCodingApproach(): Promise<void> {
    // Approach prompt is now included in the presentCodingProblem handler, so just transition
    // This method is kept for state machine compatibility but doesn't speak anything
    const problem = this.getCurrentCodingProblem()
    if (!problem) {
      console.log('🎯 [Interview] No coding problem to ask approach for')
      return
    }
    
    // Transition to waiting for approach (approach prompt was already spoken in speakCodingProblem)
    await this.stateMachine.transition('approach_asked')
  }

  private async handleHintProvision(): Promise<void> {
    // LiveKit handles audio automatically
    this.autoHintInProgress = true
    try {
      const last = this.codeAnalysis.getObservations().slice(-1)[0]
      const problem = this.codeAnalysis.getCurrentProblem() || (this.currentSession?.codingProblems?.[0] ?? null)
      // Only provide hints if stuck
      if (last && problem && last.analysis.isStuck) {
        if (this.shouldSkipAutoResponse('analysis_observation_hint')) {
          return
        }
        console.log('🎯 [Interview] Providing hint - candidate is stuck')
        const currentCode = this.currentCode || last.code || ''
        const hintText = await this.codeAnalysis.getHint(problem, currentCode, 1) // Use level 1 hint
        // Add automatic stuck detection hint to conversation history with metadata
        // Note: addHint doesn't support metadata, so we'll add it directly
        this.codeAnalysis.addConversationMessage('assistant', hintText, {
          type: 'hint',
          hintLevel: 1,
          // Mark as automatic stuck detection hint (using any to allow additional metadata)
          isAutomatic: true,
          source: 'stuck_detection'
        } as any)
        // Sync to centralized history
        this.syncConversationHistoryFromServices()
        
        // Coding hints are interruptible with hard stop
        const result = await this.speakWithPolicy(
          hintText,
          {
            interruptible: true,
            bargeInPolicy: 'hard'
          },
          { kind: 'hint', priority: 'auto', source: 'analysis_observation_hint' }
        )
        if (result.completed) {
          await this.stateMachine.transition('hint_provided')
          this.emit('hintProvided', hintText)
        }
      }
    } finally {
      this.autoHintInProgress = false
      // LiveKit handles audio automatically
    }
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
    // Store session reference early to prevent null access
    const session = this.currentSession
    if (!session) {
      console.error('❌ [InterviewOrchestrator] Cannot handle interview completion: currentSession is null')
      return
    }
    
    try {
      session.endTime = new Date()
      session.status = 'completed'
      
      console.log('📊 [InterviewOrchestrator] Handling interview completion for session:', session.id)
      
      // Stop services
      if (this.livekitAgent) {
        await this.livekitAgent.disconnect()
      }
      
      // Sync conversation history from services one final time before creating payload
      this.syncConversationHistoryFromServices()
      
      // Use centralized conversation history instead of aggregating from services
      console.log('📊 [InterviewOrchestrator] Using centralized conversation history')
      console.log('📊 [InterviewOrchestrator] Full conversation history length:', this.fullConversationHistory.length)
      console.log('📊 [InterviewOrchestrator] Current coding conversations BEFORE check:', this.codingProblemConversations.length)
      
      // If conversations were cleared (shouldn't happen, but safeguard), restore from centralized history
      if (this.codingProblemConversations.length === 0 && this.fullConversationHistory.length > 0) {
        console.warn('⚠️ [InterviewOrchestrator] Conversations were cleared! Restoring from centralized history...')
        // Get all unique problem IDs from centralized history
        const problemIds = [...new Set(this.fullConversationHistory
          .filter(m => m.metadata.codingProblemId)
          .map(m => m.metadata.codingProblemId!))]
        
        console.log('📊 [InterviewOrchestrator] Found', problemIds.length, 'problems in centralized history:', problemIds)
        
        // Restore conversations for each problem
        for (const problemId of problemIds) {
          const problem = session.codingProblems?.find(p => p.id === problemId)
          if (problem) {
            const problemHistory = this.getProblemConversationHistory(problemId)
            if (problemHistory.length > 0) {
              const problemConversation = {
                problemId,
                problem,
                conversation: problemHistory,
                finalCode: undefined,
                timeComplexity: undefined,
                spaceComplexity: undefined,
                codeAnalysisHistory: [],
                submittedAt: new Date(),
                evaluation: undefined
              }
              this.codingProblemConversations.push(problemConversation)
              console.log('📊 [InterviewOrchestrator] Restored conversation for problem:', problemId, 'with', problemHistory.length, 'messages')
            }
          }
        }
      }
      
      // If evaluations were cleared (shouldn't happen, but safeguard), restore from centralized history
      if (this.allEvaluations.length === 0 && this.fullConversationHistory.length > 0) {
        console.warn('⚠️ [InterviewOrchestrator] Evaluations were cleared! Restoring from centralized history...')
        
        // Extract evaluations from conversation messages that have evaluation metadata
        const theoreticalMessages = this.fullConversationHistory.filter(
          m => m.metadata.section === 'theoretical' && m.metadata.evaluation
        )
        
        console.log('📊 [InterviewOrchestrator] Found', theoreticalMessages.length, 'messages with evaluation metadata')
        
        // Reconstruct evaluations from conversation history
        for (const msg of theoreticalMessages) {
          if (msg.metadata.evaluation && msg.metadata.questionId) {
            // Find the user's answer message that preceded this evaluation
            // Look for the most recent user message with the same questionId before this evaluation
            const questionId = msg.metadata.questionId
            const evaluationTimestamp = msg.timestamp
            
            // Find user answer message for this question (should be before the evaluation)
            const userAnswer = this.fullConversationHistory
              .filter(m => 
                m.metadata.questionId === questionId &&
                m.role === 'user' &&
                m.timestamp < evaluationTimestamp &&
                (m.metadata.type === 'answer' || m.metadata.type === 'hint' || m.metadata.type === 'clarification')
              )
              .sort((a, b) => b.timestamp - a.timestamp)[0] // Get most recent before evaluation
            
            if (userAnswer && msg.metadata.evaluation) {
              // Try to find follow-up question if needsFollowUp is true
              let followUpQuestion: string | undefined = undefined
              if (msg.metadata.evaluation.needsFollowUp) {
                // Look for follow-up question message after this evaluation
                const followUpMsg = this.fullConversationHistory
                  .filter(m =>
                    m.metadata.questionId === questionId &&
                    m.role === 'assistant' &&
                    m.timestamp > evaluationTimestamp &&
                    m.metadata.type === 'followup'
                  )
                  .sort((a, b) => a.timestamp - b.timestamp)[0] // Get first follow-up after evaluation
                
                if (followUpMsg) {
                  followUpQuestion = followUpMsg.content
                }
              }
              
              const evaluation: Evaluation = {
                questionId: questionId,
                candidateAnswer: userAnswer.content,
                keyPointsCovered: msg.metadata.evaluation.keyPointsCovered || [],
                score: msg.metadata.evaluation.score || 0,
                needsFollowUp: msg.metadata.evaluation.needsFollowUp || false,
                followUpQuestion: followUpQuestion,
                feedback: msg.content // Use the evaluation message content as feedback
              }
              
              // Check if this evaluation already exists (avoid duplicates)
              const exists = this.allEvaluations.some(
                e => e.questionId === evaluation.questionId && 
                     e.candidateAnswer === evaluation.candidateAnswer &&
                     Math.abs(e.score - evaluation.score) < 0.01
              )
              
              if (!exists) {
                this.allEvaluations.push(evaluation)
                console.log('📊 [InterviewOrchestrator] Restored evaluation for question:', questionId, 'Score:', evaluation.score)
              }
            }
          }
        }
        
        console.log('📊 [InterviewOrchestrator] Restored', this.allEvaluations.length, 'evaluations from centralized history')
      }
      
      this.codingProblemConversations.forEach((conv, idx) => {
        console.log(`📊 [InterviewOrchestrator]   Existing conversation ${idx + 1}: Problem ${conv.problemId}, ${conv.conversation.length} messages`)
      })
      
      // If there's a current coding problem that hasn't been stored yet, add it
      const currentProblem = this.codeAnalysis.getCurrentProblem()
      console.log('📊 [InterviewOrchestrator] Checking for unstored coding problem:', currentProblem?.id)
      console.log('📊 [InterviewOrchestrator] Current coding conversations:', this.codingProblemConversations.length)
      
      if (currentProblem) {
        const existingIndex = this.codingProblemConversations.findIndex(
          c => c.problemId === currentProblem.id
        )
        console.log('📊 [InterviewOrchestrator] Existing index for problem', currentProblem.id, ':', existingIndex)
        
        if (existingIndex === -1) {
          console.log('📊 [InterviewOrchestrator] Problem not found in conversations, storing it now')
          const problemConversationHistory = this.getProblemConversationHistory(currentProblem.id)
          console.log('📊 [InterviewOrchestrator] Problem conversation history from centralized store:', problemConversationHistory.length)
          
          const finalSubmission = this.codeAnalysis.getFinalSubmission()
          const problemConversation = {
            problemId: currentProblem.id,
            problem: currentProblem,
            conversation: problemConversationHistory, // Use centralized history
            finalCode: finalSubmission.code,
            timeComplexity: finalSubmission.timeComplexity,
            spaceComplexity: finalSubmission.spaceComplexity,
            codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
            submittedAt: new Date(),
            evaluation: undefined
          }
          this.codingProblemConversations.push(problemConversation)
          console.log('📊 [InterviewOrchestrator] Stored missing problem conversation, total now:', this.codingProblemConversations.length)
        } else {
          console.log('📊 [InterviewOrchestrator] Problem already stored at index:', existingIndex)
        }
      } else {
        console.log('📊 [InterviewOrchestrator] No current coding problem found')
      }
      
      // Get theoretical conversations from centralized history
      const theoreticalConversations = session.questions.map(q => 
        this.getQuestionConversationHistory(q.id)
      ).flat()
      
      // Use full centralized history for the payload (instead of aggregating from services)
      console.log('📊 [InterviewOrchestrator] Creating final evaluation payload using centralized history...')
      console.log('📊 [InterviewOrchestrator] Session ID:', session.id)
      console.log('📊 [InterviewOrchestrator] Full centralized history:', this.fullConversationHistory.length, 'messages')
      console.log('📊 [InterviewOrchestrator] Theoretical conversations:', theoreticalConversations.length, 'messages')
      console.log('📊 [InterviewOrchestrator] Coding conversations count:', this.codingProblemConversations.length)
      this.codingProblemConversations.forEach((conv, idx) => {
        console.log(`📊 [InterviewOrchestrator]   Conversation ${idx + 1}: Problem ID ${conv.problemId}, ${conv.conversation.length} messages`)
      })
      console.log('📊 [InterviewOrchestrator] Evaluations count:', this.allEvaluations.length)
      
      // Use centralized history for final payload
      // Pass the complete conversation history directly - the function will extract what it needs
      const finalEvaluationPayload = createFinalEvaluationPayload(
        session,
        this.fullConversationHistory, // Complete conversation history (theoretical + coding)
        this.codingProblemConversations, // Structured metadata per problem (finalCode, timeComplexity, etc.)
        this.allEvaluations
      )
      
      console.log('📊 [InterviewOrchestrator] Final evaluation payload created:')
      console.log('📊 [InterviewOrchestrator] - Session ID:', finalEvaluationPayload.sessionId)
      console.log('📊 [InterviewOrchestrator] - Candidate ID:', finalEvaluationPayload.candidateId)
      console.log('📊 [InterviewOrchestrator] - Interview Link ID:', finalEvaluationPayload.interviewLinkId)
      console.log('📊 [InterviewOrchestrator] - Full conversation history length:', finalEvaluationPayload.fullConversationHistory.length)
      console.log('📊 [InterviewOrchestrator] - Theoretical questions:', finalEvaluationPayload.theoreticalSection.totalQuestions)
      console.log('📊 [InterviewOrchestrator] - Coding problems:', finalEvaluationPayload.codingSection.totalProblems)
      console.log('📊 [InterviewOrchestrator] - Total score:', finalEvaluationPayload.totalScore)
      
      // Log conversation history details
      if (finalEvaluationPayload.fullConversationHistory.length > 0) {
        console.log('📊 [InterviewOrchestrator] Full conversation history breakdown:')
        finalEvaluationPayload.fullConversationHistory.forEach((msg, idx) => {
          console.log(`  [${idx + 1}] ${msg.role} (${msg.metadata.type}) - ${msg.content.substring(0, 80)}...`)
          console.log(`      Timestamp: ${new Date(msg.timestamp).toISOString()}`)
          console.log(`      Section: ${msg.metadata.section || 'N/A'}, QuestionID: ${msg.metadata.questionId || 'N/A'}`)
        })
      } else {
        console.warn('⚠️ [InterviewOrchestrator] Full conversation history is empty!')
      }
      
      // Log theoretical section conversations
      if (finalEvaluationPayload.theoreticalSection.conversations.length > 0) {
        console.log('📊 [InterviewOrchestrator] Theoretical conversations:')
        finalEvaluationPayload.theoreticalSection.conversations.forEach((conv, idx) => {
          console.log(`  Question ${idx + 1} (${conv.questionId}): ${conv.conversation.length} messages`)
        })
      }
      
      // Log coding section conversations
      if (finalEvaluationPayload.codingSection.conversations.length > 0) {
        console.log('📊 [InterviewOrchestrator] Coding conversations:')
        finalEvaluationPayload.codingSection.conversations.forEach((conv, idx) => {
          console.log(`  Problem ${idx + 1} (${conv.problemId}): ${conv.conversation.length} messages`)
          console.log(`    Final code: ${conv.finalCode ? 'Yes' : 'No'}, Code length: ${conv.finalCode?.length || 0}`)
        })
      }
      
      // Log FULL conversation history in chronological order (use orchestrator's history directly)
      console.log('\n📝 ========== FULL CONVERSATION HISTORY ==========')
      console.log(`📝 Total messages: ${this.fullConversationHistory.length}`)
      console.log('📝 Conversation timeline:\n')
      
      this.fullConversationHistory.forEach((msg, idx) => {
        const time = new Date(msg.timestamp).toISOString()
        const roleIcon = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '⚙️'
        const typeLabel = msg.metadata.type.toUpperCase()
        const section = msg.metadata.section ? `[${msg.metadata.section}]` : ''
        const questionId = msg.metadata.questionId ? `Q:${msg.metadata.questionId}` : ''
        const problemId = msg.metadata.codingProblemId ? `P:${msg.metadata.codingProblemId}` : ''
        
        console.log(`${idx + 1}. ${roleIcon} [${typeLabel}] ${section} ${questionId} ${problemId}`)
        console.log(`   Time: ${time}`)
        console.log(`   Content: ${msg.content}`)
        
        // Log code submission details if present
        if (msg.metadata.type === 'code_submission') {
          const metadata = msg.metadata as any
          if (metadata.code) {
            console.log(`   Code:\n\`\`\`\n${metadata.code}\n\`\`\``)
          }
          
          // Get TC/SC from message metadata first
          let timeComplexity = metadata.timeComplexity
          let spaceComplexity = metadata.spaceComplexity
          
          // If missing from metadata, try to get from stored conversation
          if ((!timeComplexity || !spaceComplexity) && msg.metadata.codingProblemId) {
            const storedConversation = this.codingProblemConversations.find(
              conv => conv.problemId === msg.metadata.codingProblemId
            )
            if (storedConversation) {
              if (!timeComplexity && storedConversation.timeComplexity) {
                timeComplexity = storedConversation.timeComplexity
                console.log(`   🔧 [Log] Retrieved Time Complexity from stored conversation: ${timeComplexity}`)
              }
              if (!spaceComplexity && storedConversation.spaceComplexity) {
                spaceComplexity = storedConversation.spaceComplexity
                console.log(`   🔧 [Log] Retrieved Space Complexity from stored conversation: ${spaceComplexity}`)
              }
            }
          }
          
          if (timeComplexity) {
            console.log(`   Time Complexity: ${timeComplexity}`)
          }
          if (spaceComplexity) {
            console.log(`   Space Complexity: ${spaceComplexity}`)
          }
        }
        
        // Log additional metadata if present
        if (msg.metadata.evaluation) {
          console.log(`   Evaluation: Score=${msg.metadata.evaluation.score}, KeyPoints=${msg.metadata.evaluation.keyPointsCovered?.length || 0}`)
        }
        if (msg.metadata.hintLevel) {
          console.log(`   Hint Level: ${msg.metadata.hintLevel}`)
        }
        // Log automatic hint source if present
        if ((msg.metadata as any).isAutomatic) {
          console.log(`   Source: ${(msg.metadata as any).source || 'automatic'} (auto timeout hint)`)
        }
        console.log('')
      })
      
      console.log('📝 ========== END CONVERSATION HISTORY ==========\n')
      
      // Store payload in session for access
      ;(session as any).finalEvaluationPayload = finalEvaluationPayload
      
      // Emit both the session and the payload
      console.log('📊 [InterviewOrchestrator] Emitting interviewCompleted event')
      this.emit('interviewCompleted', session)
      
      console.log('📊 [InterviewOrchestrator] Emitting finalEvaluationReady event with payload')
      this.emit('finalEvaluationReady', finalEvaluationPayload)
      console.log('✅ [InterviewOrchestrator] Final evaluation payload emitted successfully')
      
      this.cleanupListeners()
      
      // IMPORTANT: Don't clear session here - it clears codingProblemConversations
      // The session will be cleared after the payload is successfully sent to the server
      // Clearing here would cause the first problem's conversation to be lost
      console.log('📊 [InterviewOrchestrator] Session data preserved until payload is sent')
      // Only clear non-critical state, keep conversations
      this.currentSession = null
      this.stateMachine.reset()
      this.llm.reset()
      // Keep codingProblemConversations, allEvaluations, and fullConversationHistory
      // They will be cleared after successful payload submission
    } catch (error) {
      console.error('❌ [InterviewOrchestrator] Error in handleInterviewCompletion:', error)
      console.error('❌ [InterviewOrchestrator] Error stack:', error instanceof Error ? error.stack : String(error))
      throw error
    }
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

  // updateSTTToken removed - LiveKit uses room tokens, not STT tokens

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

