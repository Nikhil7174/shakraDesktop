import { EventEmitter } from 'events'
import { LLMService, createLLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, createCodeAnalysisService, CodingProblem } from './services/code-analysis-service'
import { FinalEvaluationPayload, ConversationMessage } from '../shared/types'
import { createFinalEvaluationPayload } from './utils/final-evaluation'
import { InterviewAgent } from './services/livekit-agent'
import { InterviewEngine, SpeakRequest, SpeechContext } from './interview-session'

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
   * Sync conversation history from services to centralized store
   * This ensures we capture all messages even if services reset their history
   */
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
          this.engine.addConversationMessage(role, text, metadata)
        },
        syncConversationHistoryFromServices: () => {
          this.engine.syncConversationHistoryFromServices()
        },
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
          return await this.engine.speakWithPolicy(text, options, context)
        },
        interruptAutoSpeech: (reason) => this.engine.interruptAutoSpeech(reason),
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
        },
        questionInterruptionRetries: () => this.questionInterruptionRetries,
        setQuestionInterruptionRetries: (count) => { this.questionInterruptionRetries = count; },
        currentQuestionText: () => this.currentQuestionText,
        setCurrentQuestionText: (text) => { this.currentQuestionText = text; },
        setCurrentProblemId: (id) => { this.currentProblemId = id; },
        setCurrentQuestionId: (id) => { this.currentQuestionId = id; },
        setCodingProblemConversations: (conversations) => { this.codingProblemConversations = conversations; },
        setAllEvaluations: (evaluations) => { this.allEvaluations = evaluations; },
        setFullConversationHistory: (history) => { this.fullConversationHistory = history; },
        getCurrentProblemId: () => this.currentProblemId,
        getCurrentQuestionId: () => this.currentQuestionId,
        hadTheoreticalQuestions: () => this.hadTheoreticalQuestions,
        setHadTheoreticalQuestions: (value) => { this.hadTheoreticalQuestions = value; },
        pendingSecurityWarning: () => this.pendingSecurityWarning,
        setPendingSecurityWarning: (message) => { this.pendingSecurityWarning = message; },
        isSecurityWarningInProgress: () => this.isSecurityWarningInProgress,
        setIsSecurityWarningInProgress: (value) => { this.isSecurityWarningInProgress = value; },
        livekitAgentDisconnect: async () => {
          if (this.livekitAgent) {
            await this.livekitAgent.disconnect()
          }
        },
        livekitAgentStart: async (roomName, agentName) => {
          if (this.livekitAgent) {
            await this.livekitAgent.start(roomName, agentName)
          }
        },
        setQuestions: (questions) => { this.llm.setQuestions(questions); },
        setCodingProblems: (problems) => {
          if (this.currentSession) {
            this.currentSession.codingProblems = problems
          }
        },
        setMaxTheoreticalQuestions: (max) => {
          this.llm.setMaxTheoreticalQuestions(max)
        },
        setCurrentQuestionIndex: (index) => {
          this.stateMachine.setCurrentQuestionIndex(index)
          this.llm.setCurrentQuestionIndex(index)
        },
        setCurrentProblem: (problem) => {
          this.codeAnalysis.setCurrentProblem(problem)
        },
        getCurrentSpeechContext: () => this.currentSpeechContext,
        setCurrentSpeechContext: (context) => { this.currentSpeechContext = context; },
        setCurrentSpeakOptions: (opts) => { this.currentSpeakOptions = opts; },
        softStopRequested: () => this.softStopRequested,
        emitSpeakingStarted: () => { this.emit('speakingStarted'); },
        emitSpeakingCompleted: () => { this.emit('speakingCompleted'); },
        emitTtsError: (error) => { this.emit('ttsError', error); },
        livekitAgentSay: async (text, options) => {
          if (this.livekitAgent) {
            await this.livekitAgent.say(text, options)
          }
        },
        getLivekitAgentAvailable: () => !!this.livekitAgent,
        startManualResponse: (kind, source) => { this.startManualResponse(kind, source); },
        finishManualResponse: (kind, source) => { this.finishManualResponse(kind, source); },
        requestSkipConfirmation: () => this.requestSkipConfirmation(),
        getPreviousCode: () => this.stateMachine.getPreviousCode(),
        setState: (state) => this.stateMachine.setState(state),
        submitCodingSolution: (code, isTimeout) => this.submitCodingSolution(code, isTimeout),
        setUserSpeaking: (value) => { this.userSpeaking = value; },
        getLiveTranscriptTimeout: () => this.liveTranscriptTimeout,
        setLiveTranscriptTimeout: (timeout) => { this.liveTranscriptTimeout = timeout; },
        clearLiveTranscriptTimeout: () => {
          if (this.liveTranscriptTimeout) {
            clearTimeout(this.liveTranscriptTimeout)
            this.liveTranscriptTimeout = null
          }
        },
        addConversationMessageToService: (role, text, metadata) => {
          if (metadata.section === 'coding') {
            this.codeAnalysis.addConversationMessage(role, text, metadata)
          } else {
            this.llm.addConversationMessage(role, text, metadata)
          }
        },
        getPayloadSent: () => this.payloadSent,
        setPayloadSent: (value) => { this.payloadSent = value; },
        resetStateMachine: () => { this.stateMachine.reset(); },
        resetLLM: () => { this.llm.reset(); },
        shouldProcessTranscript: (state) => this.engine.shouldProcessTranscriptState(state)
      })

      this.engine.on('evaluation', (evaluation: Evaluation) => {
        this.emit('evaluation', evaluation)
      })

      this.engine.on('progressUpdate', (progress) => {
        this.emit('progressUpdate', progress)
      })

      this.engine.on('speakRequested', async (req: SpeakRequest) => {
        await this.engine.speakWithPolicy(req.text, req.options, req.context)
      })

      this.engine.on('hintSpokenRequested', async (hintText: string) => {
        await this.engine.onHintSpokenRequested(hintText)
      })

      this.engine.on('clarificationSpokenRequested', async (clarificationText: string) => {
        await this.engine.onClarificationSpokenRequested(clarificationText)
      })

      this.engine.on('skipRequested', async ({ problem, text }: { problem: any, text: string }) => {
        await this.engine.onSkipRequested(problem, text)
      })

      this.engine.on('solutionSubmitted', async ({ feedback, hasNextProblem }: { feedback: string, hasNextProblem: boolean }) => {
        await this.engine.onSolutionSubmitted(feedback, hasNextProblem)
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
      await this.engine.onIntroStarted()
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
      this.emit('stateChanged', { 
        from: this.stateMachine.getState(), 
        to: InterviewState.CODING_INTRO 
      })
      await this.engine.onCodingIntroStarted()
    })

    this.stateMachine.on('presentCodingProblem', async () => {
      const problem = await this.engine.onPresentCodingProblem()
      if (problem) {
        this.emit('presentCodingProblem', problem)
      }
    })

    this.stateMachine.on('askForApproach', async () => {
      await this.engine.onAskForApproach()
    })

    this.stateMachine.on('waitingForApproach', () => {
      this.engine.onWaitingForApproach()
    })

    this.stateMachine.on('evaluatingApproach', () => {
      console.log('🎯 [Interview] Evaluating approach')
    })

    this.stateMachine.on('codeMonitoringStarted', () => {
      this.engine.onCodeMonitoringStarted()
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
    this.engine.markUserSpeakingActivity()
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
    this.currentSession = null
    await this.engine.clearSession()
  }
  
  markPayloadSent(): void {
    this.payloadSent = true
  }
  

  async startInterview(session: InterviewSession & { resumeFromIndex?: number; skipIntro?: boolean }): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized')
    }

    this.payloadSent = false
    const sessionWithStartTime: InterviewSession = {
      ...session,
      startTime: session.startTime || new Date(),
      status: session.status || 'in_progress'
    }
    this.currentSession = sessionWithStartTime
    await this.engine.startInterview(sessionWithStartTime)
  }


  async handleTranscript(text: string): Promise<void> {
    if (!this.currentSession) {
      return
    }

    const currentState = this.stateMachine.getState()
    await this.engine.handleTranscriptBargeIn(text)

    if (this.engine.shouldProcessTranscriptState(currentState)) {
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
    return await this.engine.submitCodingSolutionWithBusinessLogic(code, isTimeout, timeComplexity, spaceComplexity)
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

  private async speakQuestion(question: string): Promise<void> {
    await this.engine.speakQuestion(question)
  }

  private async speakFollowUpQuestion(followUp: string): Promise<void> {
    await this.engine.speakFollowUpQuestion(followUp)
  }

  public async speakSecurityWarning(message: string): Promise<void> {
    await this.engine.speakSecurityWarning(message)
  }

  private async withManualResponse<T>(kind: ResponseKind, source: string, handler: () => Promise<T>): Promise<T> {
    return await this.engine.withManualResponse(kind, source, handler)
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
    await this.engine.interruptAutoSpeech(reason)
  }

  private shouldSkipAutoResponse(trigger: string): boolean {
    return this.engine.shouldSkipAutoResponse(trigger)
  }

  private async handleSilenceTimeout(): Promise<void> {
    await this.engine.handleSilenceTimeout()
  }

  private async askForCodingApproach(): Promise<void> {
    await this.engine.onAskForApproach()
  }

  private async handleHintProvision(): Promise<void> {
    await this.engine.handleHintProvision()
  }

  private async speakWrapUp(_data: any): Promise<void> {
    await this.engine.speakWrapUp()
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

