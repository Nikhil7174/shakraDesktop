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
    this.engine.syncConversationHistoryFromServices()
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
    await this.engine.speakQuestion(question)
  }

  private async speakFollowUpQuestion(followUp: string): Promise<void> {
    await this.engine.speakFollowUpQuestion(followUp)
  }

  public async speakSecurityWarning(message: string): Promise<void> {
    await this.engine.speakSecurityWarning(message)
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

