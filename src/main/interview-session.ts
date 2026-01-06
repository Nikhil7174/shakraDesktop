import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, CodingProblem } from './services/code-analysis-service'
import type { ConversationMessage } from '../shared/types'
import { TheoreticalQuestionHandler } from './handlers/theoretical-question-handler'
import { CodingProblemHandler } from './handlers/coding-problem-handler'
import { HintClarificationHandler } from './handlers/hint-clarification-handler'
import { SessionManager } from './handlers/session-manager'
import { SpeechManager } from './handlers/speech-manager'

export interface InterviewSession {
  id: string
  sessionId?: string
  candidateId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  startTime: Date
  endTime?: Date
  status: 'scheduled' | 'in_progress' | 'completed'
  maxTheoreticalQuestions?: number
}

export type BargeInPolicy = 'hard' | 'soft'

export interface SpeakOptions {
  interruptible: boolean
  bargeInPolicy: BargeInPolicy
}

export type SpeechContext =
  | { kind: 'prompt'; priority: 'auto' | 'manual'; source: 'theoretical_question' | 'follow_up' | string }
  | { kind: 'hint'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'clarification'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'feedback'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'system'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'answer'; priority: 'auto' | 'manual'; source: string }

export interface SpeakRequest {
  text: string
  options: SpeakOptions
  context: SpeechContext
}

export interface InterviewSessionDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
  getCurrentCodingProblem: () => CodingProblem | null
  getConversationHistory: () => ConversationMessage[]
  addConversationMessage: (role: 'user' | 'assistant' | 'system', text: string, metadata: any) => void
  syncConversationHistoryFromServices: () => void
  getCurrentSession: () => any
  getFullConversationHistory: () => ConversationMessage[]
  getCodingProblemConversations: () => any[]
  getAllEvaluations: () => Evaluation[]
  getProblemConversationHistory: (problemId: string) => ConversationMessage[]
  getFullConversationHistoryForFiltering: () => ConversationMessage[]
  userSpeaking: () => boolean
  autoHintInProgress: () => boolean
  setAutoHintInProgress: (value: boolean) => void
  shouldSkipAutoResponse: (trigger: string) => boolean
  withManualResponse: <T>(kind: any, source: string, handler: () => Promise<T>) => Promise<T>
  currentCode: () => string
  setCurrentCode: (code: string) => void
  speakRequested: (text: string, options: SpeakOptions, context: SpeechContext) => Promise<any>
  interruptAutoSpeech: (reason: string) => Promise<void>
  getCurrentSpeakOptions: () => SpeakOptions | undefined
  setSoftStopRequested: (value: boolean) => void
  stopLivekitAgent: () => Promise<void>
  getLivekitAgentIsSpeaking: () => boolean
  forceMoveToNextQuestion: () => Promise<void>
  questionInterruptionRetries: () => number
  setQuestionInterruptionRetries: (count: number) => void
  currentQuestionText: () => string | null
  setCurrentQuestionText: (text: string | null) => void
  setCurrentProblemId: (id: string | null) => void
  setCurrentQuestionId: (id: string | null) => void
  setCodingProblemConversations: (conversations: any[]) => void
  setAllEvaluations: (evaluations: Evaluation[]) => void
  setFullConversationHistory: (history: ConversationMessage[]) => void
  getCurrentProblemId: () => string | null
  getCurrentQuestionId: () => string | null
  hadTheoreticalQuestions: () => boolean
  setHadTheoreticalQuestions: (value: boolean) => void
  pendingSecurityWarning: () => string | null
  setPendingSecurityWarning: (message: string | null) => void
  isSecurityWarningInProgress: () => boolean
  setIsSecurityWarningInProgress: (value: boolean) => void
  livekitAgentDisconnect: () => Promise<void>
  livekitAgentStart: (roomName: string, agentName: string) => Promise<void>
  setQuestions: (questions: Question[]) => void
  setCodingProblems: (problems: CodingProblem[]) => void
  setMaxTheoreticalQuestions: (max: number) => void
  setCurrentQuestionIndex: (index: number) => void
  setCurrentProblem: (problem: CodingProblem) => void
  getCurrentSpeechContext: () => SpeechContext | null
  setCurrentSpeechContext: (context: SpeechContext | null) => void
  setCurrentSpeakOptions: (opts: SpeakOptions | undefined) => void
  softStopRequested: () => boolean
  emitSpeakingStarted: () => void
  emitSpeakingCompleted: () => void
  emitTtsError: (error: any) => void
  livekitAgentSay: (text: string, options: { allowInterruptions: boolean }) => Promise<void>
  getLivekitAgentAvailable: () => boolean
  requestSkipConfirmation: () => Promise<boolean>
  getPreviousCode: () => string
  setState: (state: InterviewState) => Promise<void>
  submitCodingSolution: (code: string, isTimeout: boolean) => Promise<any>
  setUserSpeaking: (value: boolean) => void
  getLiveTranscriptTimeout: () => NodeJS.Timeout | null
  setLiveTranscriptTimeout: (timeout: NodeJS.Timeout | null) => void
  clearLiveTranscriptTimeout: () => void
  addConversationMessageToService: (role: 'user' | 'assistant' | 'system', text: string, metadata: any) => void
  getPayloadSent: () => boolean
  setPayloadSent: (value: boolean) => void
  resetStateMachine: () => void
  resetLLM: () => void
  shouldProcessTranscript: (state: InterviewState) => boolean
  getStateMachineProgress: () => { current: number; total: number }
  getStateMachineState: () => InterviewState
  onQuestionAsked: (questionId: string) => void
  setCurrentSession: (session: InterviewSession) => void
}

export class InterviewEngine extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: InterviewSessionDeps

  private theoreticalHandler: TheoreticalQuestionHandler
  private codingHandler: CodingProblemHandler
  private hintClarificationHandler: HintClarificationHandler
  private sessionManager: SessionManager
  private speechManager: SpeechManager

  private currentQuestionId: string | null = null
  private currentQuestionText: string | null = null
  private currentCode: string = ''
  private currentIntervalHasHintClarification: boolean = false
  private currentIntervalHasSubstantialSpeech: boolean = false
  private questionInterruptionRetries: number = 0

  constructor(deps: InterviewSessionDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps

    this.theoreticalHandler = new TheoreticalQuestionHandler({
      llm: this.llm,
      stateMachine: this.stateMachine,
      syncConversationHistoryFromServices: () => this.sessionManager.syncConversationHistoryFromServices(),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args),
      forceMoveToNextQuestion: () => this.theoreticalHandler.forceMoveToNextQuestion()
    })

    this.codingHandler = new CodingProblemHandler({
      llm: this.llm,
      stateMachine: this.stateMachine,
      codeAnalysis: this.codeAnalysis,
      getCurrentCodingProblem: () => deps.getCurrentCodingProblem(),
      getCurrentCode: () => this.currentCode,
      setCurrentCode: (code: string) => { this.currentCode = code; deps.setCurrentCode(code); },
      syncConversationHistoryFromServices: () => this.sessionManager.syncConversationHistoryFromServices(),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args),
      getCurrentSession: () => deps.getCurrentSession(),
      getCodingProblemConversations: () => deps.getCodingProblemConversations(),
      getProblemConversationHistory: (problemId: string) => this.sessionManager.getProblemConversationHistory(problemId),
      setCodingProblemConversations: (conversations: any[]) => deps.setCodingProblemConversations(conversations),
      setCurrentProblemId: (id: string | null) => deps.setCurrentProblemId(id),
      setCurrentProblem: (problem: CodingProblem) => deps.setCurrentProblem(problem),
      getCurrentProblemId: () => deps.getCurrentProblemId(),
      setState: (state: InterviewState) => deps.setState(state),
      submitCodingSolution: (code: string, isTimeout: boolean) => deps.submitCodingSolution(code, isTimeout),
      getPreviousCode: () => deps.getPreviousCode(),
      forceMoveToNextQuestion: () => this.theoreticalHandler.forceMoveToNextQuestion(),
      currentIntervalHasHintClarification: () => this.currentIntervalHasHintClarification,
      setCurrentIntervalHasHintClarification: (value: boolean) => { this.currentIntervalHasHintClarification = value; },
      currentIntervalHasSubstantialSpeech: () => this.currentIntervalHasSubstantialSpeech,
      setCurrentIntervalHasSubstantialSpeech: (value: boolean) => { this.currentIntervalHasSubstantialSpeech = value; },
      resetIntervalTracking: () => {
        this.currentIntervalHasHintClarification = false
        this.currentIntervalHasSubstantialSpeech = false
      },
      shouldSkipAutoResponse: (trigger: string) => this.speechManager.shouldSkipAutoResponse(trigger)
    })

    this.hintClarificationHandler = new HintClarificationHandler({
      llm: this.llm,
      stateMachine: this.stateMachine,
      codeAnalysis: this.codeAnalysis,
      syncConversationHistoryFromServices: () => this.sessionManager.syncConversationHistoryFromServices(),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args),
      forceMoveToNextQuestion: () => this.theoreticalHandler.forceMoveToNextQuestion(),
      getCurrentCode: () => this.currentCode,
      getPreviousCode: () => deps.getPreviousCode(),
      requestSkipConfirmation: () => deps.requestSkipConfirmation(),
      submitCodingSolution: (code: string, isTimeout: boolean) => deps.submitCodingSolution(code, isTimeout),
      setCurrentProblem: (problem: CodingProblem) => deps.setCurrentProblem(problem),
      setCurrentProblemId: (id: string | null) => deps.setCurrentProblemId(id),
      setState: (state: any) => deps.setState(state),
      getCurrentCodingProblem: () => deps.getCurrentCodingProblem(),
      getCurrentSession: () => deps.getCurrentSession(),
      handleEvaluation: (evaluation: Evaluation) => this.handleEvaluation(evaluation)
    })

    this.sessionManager = new SessionManager({
      llm: this.llm,
      stateMachine: this.stateMachine,
      codeAnalysis: this.codeAnalysis,
      getCurrentSession: () => deps.getCurrentSession(),
      setCurrentSession: (session: InterviewSession) => deps.setCurrentSession(session),
      getFullConversationHistory: () => deps.getFullConversationHistory(),
      setFullConversationHistory: (history: ConversationMessage[]) => deps.setFullConversationHistory(history),
      getCodingProblemConversations: () => deps.getCodingProblemConversations(),
      setCodingProblemConversations: (conversations: any[]) => deps.setCodingProblemConversations(conversations),
      getAllEvaluations: () => deps.getAllEvaluations(),
      setAllEvaluations: (evaluations: Evaluation[]) => deps.setAllEvaluations(evaluations),
      getProblemConversationHistory: (problemId: string) => this.getProblemConversationHistory(problemId),
      getCurrentProblemId: () => deps.getCurrentProblemId(),
      setCurrentProblemId: (id: string | null) => deps.setCurrentProblemId(id),
      setCurrentQuestionId: (id: string | null) => deps.setCurrentQuestionId(id),
      setCurrentQuestionIndex: (index: number) => deps.setCurrentQuestionIndex(index),
      setQuestions: (questions: any[]) => deps.setQuestions(questions),
      setCodingProblems: (problems: CodingProblem[]) => deps.setCodingProblems(problems),
      setMaxTheoreticalQuestions: (max: number) => deps.setMaxTheoreticalQuestions(max),
      setHadTheoreticalQuestions: (value: boolean) => deps.setHadTheoreticalQuestions(value),
      livekitAgentStart: (roomName: string, agentName: string) => deps.livekitAgentStart(roomName, agentName),
      resetStateMachine: () => deps.resetStateMachine(),
      resetLLM: () => deps.resetLLM(),
      stopLivekitAgent: () => deps.stopLivekitAgent(),
      getPayloadSent: () => deps.getPayloadSent(),
      setPayloadSent: (value: boolean) => deps.setPayloadSent(value),
      getStateMachineProgress: () => deps.getStateMachineProgress(),
      getStateMachineState: () => deps.getStateMachineState(),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args)
    })

    this.speechManager = new SpeechManager({
      llm: this.llm,
      stateMachine: this.stateMachine,
      codeAnalysis: this.codeAnalysis,
      getLivekitAgentIsSpeaking: () => deps.getLivekitAgentIsSpeaking(),
      getLivekitAgentAvailable: () => deps.getLivekitAgentAvailable(),
      livekitAgentSay: (text: string, options: { allowInterruptions: boolean }) => deps.livekitAgentSay(text, options),
      stopLivekitAgent: () => deps.stopLivekitAgent(),
      getCurrentSpeakOptions: () => deps.getCurrentSpeakOptions(),
      setCurrentSpeakOptions: (opts: SpeakOptions | undefined) => deps.setCurrentSpeakOptions(opts),
      getCurrentSpeechContext: () => deps.getCurrentSpeechContext(),
      setCurrentSpeechContext: (context: SpeechContext | null) => deps.setCurrentSpeechContext(context),
      setSoftStopRequested: (value: boolean) => deps.setSoftStopRequested(value),
      softStopRequested: () => deps.softStopRequested(),
      pendingSecurityWarning: () => deps.pendingSecurityWarning(),
      setPendingSecurityWarning: (message: string | null) => deps.setPendingSecurityWarning(message),
      isSecurityWarningInProgress: () => deps.isSecurityWarningInProgress(),
      setIsSecurityWarningInProgress: (value: boolean) => deps.setIsSecurityWarningInProgress(value),
      emitSpeakingStarted: () => deps.emitSpeakingStarted(),
      emitSpeakingCompleted: () => deps.emitSpeakingCompleted(),
      emitTtsError: (error: any) => deps.emitTtsError(error),
      userSpeaking: () => deps.userSpeaking(),
      setUserSpeaking: (value: boolean) => deps.setUserSpeaking(value),
      getLiveTranscriptTimeout: () => deps.getLiveTranscriptTimeout(),
      setLiveTranscriptTimeout: (timeout: NodeJS.Timeout | null) => deps.setLiveTranscriptTimeout(timeout),
      clearLiveTranscriptTimeout: () => deps.clearLiveTranscriptTimeout(),
      shouldSkipAutoResponse: (trigger: string) => this.speechManager.shouldSkipAutoResponse(trigger),
      getCurrentCodingProblem: () => deps.getCurrentCodingProblem(),
      getCurrentCode: () => this.currentCode,
      getPreviousCode: () => deps.getPreviousCode(),
      syncConversationHistoryFromServices: () => this.sessionManager.syncConversationHistoryFromServices(),
      speakRequested: (text: string, options: SpeakOptions, context: SpeechContext) => deps.speakRequested(text, options, context),
      forceMoveToNextQuestion: () => this.theoreticalHandler.forceMoveToNextQuestion(),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args),
      autoHintInProgress: () => deps.autoHintInProgress(),
      setAutoHintInProgress: (value: boolean) => deps.setAutoHintInProgress(value)
    })

    this.setupHandlerEvents()
  }

  private setupHandlerEvents(): void {
    this.theoreticalHandler.on('hintRequested', (text: string) => {
      this.hintClarificationHandler.handleTheoreticalHintRequest(text)
    })
    this.theoreticalHandler.on('clarificationRequested', (text: string) => {
      this.hintClarificationHandler.handleTheoreticalClarificationRequest(text)
    })
    this.theoreticalHandler.on('skipRequested', (text: string) => {
      this.hintClarificationHandler.handleTheoreticalSkipRequest(text)
    })
    this.theoreticalHandler.on('hintResponse', (response: any) => {
      this.stateMachine.transition('hint_requested').then(() => {
        this.emit('hintSpokenRequested', response.text)
      })
    })
    this.theoreticalHandler.on('clarificationResponse', (response: any) => {
      this.stateMachine.transition('clarification_requested').then(() => {
        this.emit('clarificationSpokenRequested', response.text)
      })
    })
    this.theoreticalHandler.on('skipResponse', (response: any) => {
      this.hintClarificationHandler.handleTheoreticalSkipResponse(response)
    })

    this.codingHandler.on('approachHintRequested', ({ text, problem }: { text: string; problem: CodingProblem }) => {
      const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || ''
      this.hintClarificationHandler.handleApproachHintRequest(text, problem)
    })
    this.codingHandler.on('approachClarificationRequested', ({ text, problem, currentCode }: { text: string; problem: CodingProblem; currentCode: string }) => {
      this.hintClarificationHandler.handleApproachClarificationRequest(text, problem, currentCode)
    })
    this.codingHandler.on('monitoringHintRequested', ({ text, problem }: { text: string; problem: CodingProblem }) => {
      this.hintClarificationHandler.handleMonitoringHintRequest(text, problem)
    })
    this.codingHandler.on('monitoringClarificationRequested', ({ text, problem }: { text: string; problem: CodingProblem }) => {
      this.hintClarificationHandler.handleMonitoringClarificationRequest(text, problem)
    })

    this.codingHandler.on('skipRequested', ({ problem, text }: { problem: any, text: string }) => {
      this.emit('skipRequested', { problem, text })
    })

    this.sessionManager.on('interviewCompleted', (session: InterviewSession) => {
      this.emit('interviewCompleted', session)
    })
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    this.deps.setAllEvaluations([...this.deps.getAllEvaluations(), evaluation])
    await this.theoreticalHandler.handleEvaluation(evaluation)
  }

  async processTranscript(text: string, state: InterviewState): Promise<void> {
    this.stateMachine.clearSilenceTimer()

    if (state === InterviewState.WAITING_FOR_ANSWER || state === InterviewState.THEORETICAL_QUESTION) {
      await this.theoreticalHandler.processTranscript(text, state)
    } else if (state === InterviewState.WAITING_FOR_APPROACH || state === InterviewState.MONITORING_CODE) {
      await this.codingHandler.processTranscript(text, state)
    }
  }

  async onAskQuestion(question: Question): Promise<void> {
    await this.theoreticalHandler.onAskQuestion(
      question,
      (id: string) => { this.currentQuestionId = id; this.deps.setCurrentQuestionId(id); },
      (text: string) => { this.currentQuestionText = text; this.deps.setCurrentQuestionText(text); }
    )
  }

  async onAskFollowUp(followUp: string): Promise<void> {
    await this.theoreticalHandler.onAskFollowUp(
      followUp,
      (text: string) => { this.currentQuestionText = text; this.deps.setCurrentQuestionText(text); },
      (count: number) => { this.questionInterruptionRetries = count; this.deps.setQuestionInterruptionRetries(count); }
    )
  }

  async forceMoveToNextQuestion(): Promise<void> {
    await this.theoreticalHandler.forceMoveToNextQuestion()
  }

  setCurrentCode(code: string): void {
    this.currentCode = code
    this.deps.setCurrentCode(code)
  }

  resetIntervalTracking(): void {
    this.currentIntervalHasHintClarification = false
    this.currentIntervalHasSubstantialSpeech = false
  }


  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }, problem: CodingProblem | null): Promise<any> {
    return await this.codingHandler.analyzeCode(codeData, problem)
  }

  async submitCodingSolution(
    code: string,
    problem: CodingProblem,
    codingProblems: CodingProblem[],
    isTimeout: boolean = false,
    timeComplexity?: string,
    spaceComplexity?: string
  ): Promise<{ success: boolean, feedback: string, hasNextProblem: boolean }> {
    return await this.codingHandler.submitCodingSolution(code, problem, codingProblems, isTimeout, timeComplexity, spaceComplexity)
  }


  getSilenceTimerDuration(state: InterviewState): number {
    return this.speechManager.getSilenceTimerDuration(state)
  }

  shouldSkipAutoResponse(trigger: string): boolean {
    return this.speechManager.shouldSkipAutoResponse(trigger)
  }

  async handleBargeIn(): Promise<void> {
    await this.speechManager.handleBargeIn()
  }

  async handleTranscriptBargeIn(text: string): Promise<void> {
    await this.speechManager.handleTranscriptBargeIn(text)
  }

  async analyzeCodeWithBusinessLogic(codeData: { code: string, problemId: string, timestamp: number }): Promise<any> {
    const session = this.deps.getCurrentSession()
    if (!session) {
      throw new Error('No active interview session')
    }

    this.deps.setCurrentCode(codeData.code)
    this.setCurrentCode(codeData.code)

    const problem = this.codeAnalysis.getCurrentProblem() || session?.codingProblems?.find((p: CodingProblem) => p.id === codeData.problemId) || null
    if (!problem) {
      throw new Error('No coding problem context')
    }

    if (this.deps.userSpeaking()) {
      return await this.analyzeCode(codeData, problem)
    }

    this.deps.setAutoHintInProgress(true)
    try {
      const analysis = await this.analyzeCode(codeData, problem)
      this.resetIntervalTracking()
      return analysis
    } finally {
      this.deps.setAutoHintInProgress(false)
    }
  }

  async handleHintProvision(): Promise<void> {
    await this.hintClarificationHandler.handleHintProvision(
      (trigger: string) => this.speechManager.shouldSkipAutoResponse(trigger),
      (value: boolean) => this.deps.setAutoHintInProgress(value)
    )
  }

  async handleSilenceTimeout(): Promise<void> {
    await this.speechManager.handleSilenceTimeout(
      (trigger: string) => this.speechManager.shouldSkipAutoResponse(trigger),
      () => this.deps.getCurrentCodingProblem(),
      () => this.currentCode
    )
  }

  async handleInterviewCompletion(): Promise<void> {
    await this.sessionManager.handleInterviewCompletion()
  }

  async speakQuestion(question: string): Promise<void> {
    await this.speechManager.speakQuestion(
      question,
      (text: string | null) => { this.currentQuestionText = text; this.deps.setCurrentQuestionText(text); },
      () => this.questionInterruptionRetries,
      (count: number) => { this.questionInterruptionRetries = count; this.deps.setQuestionInterruptionRetries(count); }
    )
  }

  async speakFollowUpQuestion(followUp: string): Promise<void> {
    await this.speechManager.speakFollowUpQuestion(
      followUp,
      (text: string | null) => { this.currentQuestionText = text; this.deps.setCurrentQuestionText(text); },
      () => this.questionInterruptionRetries,
      (count: number) => { this.questionInterruptionRetries = count; this.deps.setQuestionInterruptionRetries(count); }
    )
  }

  async submitCodingSolutionWithBusinessLogic(
    code: string,
    isTimeout: boolean = false,
    timeComplexity?: string,
    spaceComplexity?: string
  ): Promise<{ success: boolean, feedback: string, hasNextProblem: boolean }> {
    return await this.codingHandler.submitCodingSolutionWithBusinessLogic(code, isTimeout, timeComplexity, spaceComplexity)
  }

  async startInterview(session: InterviewSession & { resumeFromIndex?: number; skipIntro?: boolean }): Promise<void> {
    await this.sessionManager.startInterview(session)
  }

  syncConversationHistoryFromServices(): void {
    this.sessionManager.syncConversationHistoryFromServices()
  }

  async speakSecurityWarning(message: string): Promise<void> {
    await this.speechManager.speakSecurityWarning(message)
  }

  async speakWrapUp(): Promise<void> {
    await this.speechManager.speakWrapUp()
  }

  async speakWithPolicy(
    text: string,
    opts: SpeakOptions,
    context: SpeechContext = { kind: 'system', priority: 'auto', source: 'general' }
  ): Promise<{ completed: boolean, softStopped: boolean, interrupted: boolean }> {
    return await this.speechManager.speakWithPolicy(text, opts, context)
  }

  async onIntroStarted(): Promise<void> {
    await this.sessionManager.onIntroStarted(
      async (event: string) => { await this.stateMachine.transition(event) }
    )
  }

  async onCodingIntroStarted(): Promise<void> {
    await this.sessionManager.onCodingIntroStarted(
      () => this.deps.hadTheoreticalQuestions(),
      async (event: string) => { await this.stateMachine.transition(event) }
    )
  }

  async onPresentCodingProblem(): Promise<CodingProblem | null> {
    return await this.codingHandler.onPresentCodingProblem(
      () => this.deps.getCurrentProblemId(),
      (id: string | null) => this.deps.setCurrentProblemId(id),
      (problem: CodingProblem) => this.deps.setCurrentProblem(problem)
    )
  }

  async interruptAutoSpeech(reason: string): Promise<void> {
    await this.speechManager.interruptAutoSpeech(reason)
  }

  async withManualResponse<T>(kind: any, source: string, handler: () => Promise<T>): Promise<T> {
    return await this.speechManager.withManualResponse(kind, source, handler)
  }

  async onSkipRequested(problem: any, text: string): Promise<void> {
    await this.hintClarificationHandler.onSkipRequested(
      problem,
      text,
      (text: string, opts: any, context: any) => this.speakWithPolicy(text, opts, context)
    )
  }

  async onHintSpokenRequested(hintText: string): Promise<void> {
    const result = await this.speakWithPolicy(hintText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    }, { kind: 'hint', priority: 'auto', source: 'monitoring_auto_hint' })
    if (result.completed) {
      await this.hintClarificationHandler.onHintSpokenCompleted(hintText)
    }
  }

  async onClarificationSpokenRequested(clarificationText: string): Promise<void> {
    const result = await this.speakWithPolicy(clarificationText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    })
    if (result.completed) {
      await this.hintClarificationHandler.onClarificationSpokenCompleted(clarificationText)
    }
  }

  async onHintSpokenCompleted(hintText: string): Promise<void> {
    await this.hintClarificationHandler.onHintSpokenCompleted(hintText)
  }

  async onClarificationSpokenCompleted(clarificationText: string): Promise<void> {
    await this.hintClarificationHandler.onClarificationSpokenCompleted(clarificationText)
  }

  async onSolutionSubmitted(feedback: string, hasNextProblem: boolean): Promise<void> {
    await this.speakWithPolicy(feedback, {
      interruptible: false,
      bargeInPolicy: 'soft'
    })
  }

  async onWaitingForApproach(): Promise<void> {
    await this.codingHandler.onWaitingForApproach()
  }

  async onCodeMonitoringStarted(): Promise<void> {
    await this.codingHandler.onCodeMonitoringStarted()
  }

  async onAskForApproach(): Promise<void> {
    await this.codingHandler.onAskForApproach()
  }

  markUserSpeakingActivity(): void {
    this.speechManager.markUserSpeakingActivity()
  }

  addConversationMessage(role: 'user' | 'assistant' | 'system', text: string, metadata: any): void {
    this.sessionManager.addConversationMessage(role, text, metadata)
  }

  async clearSession(): Promise<void> {
    await this.sessionManager.clearSession()
  }

  shouldProcessTranscriptState(state: InterviewState): boolean {
    return state === InterviewState.WAITING_FOR_ANSWER || 
           state === InterviewState.THEORETICAL_QUESTION ||
           state === InterviewState.WAITING_FOR_APPROACH || 
           state === InterviewState.MONITORING_CODE
  }

  getProblemConversationHistory(problemId: string): ConversationMessage[] {
    return this.sessionManager.getProblemConversationHistory(problemId)
  }

  getSessionInfo(): { sessionId: string; questionsAnswered: number; totalQuestions: number; lastActivity: string; state: string } | null {
    return this.sessionManager.getSessionInfo()
  }

}


