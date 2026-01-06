import { EventEmitter } from 'events'
import { LLMService } from '../services/llm-service'
import { InterviewStateMachine, InterviewState } from '../services/state-machine'
import { CodeAnalysisService } from '../services/code-analysis-service'
import { SpeakOptions, SpeechContext } from '../interview-session'

export interface SpeechManagerDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
  getLivekitAgentIsSpeaking: () => boolean
  getLivekitAgentAvailable: () => boolean
  livekitAgentSay: (text: string, options: { allowInterruptions: boolean }) => Promise<void>
  stopLivekitAgent: () => Promise<void>
  getCurrentSpeakOptions: () => SpeakOptions | undefined
  setCurrentSpeakOptions: (opts: SpeakOptions | undefined) => void
  getCurrentSpeechContext: () => SpeechContext | null
  setCurrentSpeechContext: (context: SpeechContext | null) => void
  setSoftStopRequested: (value: boolean) => void
  softStopRequested: () => boolean
  pendingSecurityWarning: () => string | null
  setPendingSecurityWarning: (message: string | null) => void
  isSecurityWarningInProgress: () => boolean
  setIsSecurityWarningInProgress: (value: boolean) => void
  emitSpeakingStarted: () => void
  emitSpeakingCompleted: () => void
  emitTtsError: (error: any) => void
  userSpeaking: () => boolean
  setUserSpeaking: (value: boolean) => void
  getLiveTranscriptTimeout: () => NodeJS.Timeout | null
  setLiveTranscriptTimeout: (timeout: NodeJS.Timeout | null) => void
  clearLiveTranscriptTimeout: () => void
  shouldSkipAutoResponse: (trigger: string) => boolean
  getCurrentCodingProblem: () => any
  getCurrentCode: () => string
  getPreviousCode: () => string
  syncConversationHistoryFromServices: () => void
  speakRequested: (text: string, options: SpeakOptions, context: SpeechContext) => Promise<any>
  forceMoveToNextQuestion: () => Promise<void>
  emit: (event: string, ...args: any[]) => boolean
  autoHintInProgress: () => boolean
  setAutoHintInProgress: (value: boolean) => void
}

export class SpeechManager extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: SpeechManagerDeps
  private manualResponseInFlight: { kind: any; source: string; startedAt: number } | null = null

  constructor(deps: SpeechManagerDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps
  }

  async speakWithPolicy(
    text: string,
    opts: SpeakOptions,
    context: SpeechContext = { kind: 'system', priority: 'auto', source: 'general' }
  ): Promise<{ completed: boolean, softStopped: boolean, interrupted: boolean }> {
    this.deps.setCurrentSpeechContext(context)
    try {
      this.deps.setCurrentSpeakOptions(opts)
      this.deps.setSoftStopRequested(false)

      this.deps.emitSpeakingStarted()

      if (this.deps.getLivekitAgentAvailable()) {
        const allowInterruptions = opts.interruptible !== false
        await this.deps.livekitAgentSay(text, { allowInterruptions })
      }

      const interruptionsAllowed = opts.interruptible !== false
      if (this.deps.pendingSecurityWarning() && (!this.deps.softStopRequested() || !interruptionsAllowed)) {
        const warning = this.deps.pendingSecurityWarning()
        this.deps.setPendingSecurityWarning(null)
        await this.speakSecurityWarning(warning!)
      }

      const completed = interruptionsAllowed ? !this.deps.softStopRequested() : true
      const softStopped = interruptionsAllowed ? this.deps.softStopRequested() : false

      this.deps.emitSpeakingCompleted()
      this.deps.setCurrentSpeakOptions(undefined)

      return { completed, softStopped, interrupted: false }
    } catch (error) {
      this.deps.emitTtsError(error)
      this.deps.emitSpeakingCompleted()
      this.deps.setCurrentSpeakOptions(undefined)
      return { completed: false, softStopped: false, interrupted: true }
    } finally {
      this.deps.setCurrentSpeechContext(null)
    }
  }

  async speakSecurityWarning(message: string): Promise<void> {
    if (!message || !message.trim()) {
      return
    }

    if (this.deps.getLivekitAgentIsSpeaking() || this.deps.isSecurityWarningInProgress()) {
      this.deps.setPendingSecurityWarning(message)
      return
    }

    this.deps.setIsSecurityWarningInProgress(true)
    this.deps.setPendingSecurityWarning(null)

    try {
      await this.deps.speakRequested(
        message,
        {
          interruptible: true,
          bargeInPolicy: 'hard'
        },
        {
          kind: 'system',
          priority: 'auto',
          source: 'security_warning'
        }
      )
    } finally {
      this.deps.setIsSecurityWarningInProgress(false)
    }
  }

  async speakWrapUp(): Promise<void> {
    const wrapUpText = "Thank you for completing the interview. Your responses have been recorded."
    await this.deps.speakRequested(
      wrapUpText,
      {
        interruptible: true,
        bargeInPolicy: 'hard'
      },
      { kind: 'system', priority: 'auto', source: 'wrap_up' }
    )
    await this.stateMachine.transition('interview_complete')
  }

  async speakQuestion(
    question: string,
    setQuestionText: (text: string | null) => void,
    questionInterruptionRetries: () => number,
    setQuestionInterruptionRetries: (count: number) => void
  ): Promise<void> {
    setQuestionText(question)
    const maxRetries = 2
    const currentRetries = questionInterruptionRetries()
    const allowInterruptions = currentRetries < maxRetries

    const result = await this.deps.speakRequested(
      question,
      {
        interruptible: allowInterruptions,
        bargeInPolicy: 'soft'
      },
      { kind: 'prompt', priority: 'auto', source: 'theoretical_question' }
    )

    if (result.completed && !result.softStopped) {
      setQuestionInterruptionRetries(0)
      setQuestionText(null)
      if (this.stateMachine.getState() === InterviewState.THEORETICAL_QUESTION) {
        await this.stateMachine.transition('question_asked')
      }
      this.stateMachine.startSilenceTimer(40000)
    } else if (result.softStopped || result.interrupted) {
      const newRetries = currentRetries + 1
      setQuestionInterruptionRetries(newRetries)
      if (newRetries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.speakQuestion(question, setQuestionText, questionInterruptionRetries, setQuestionInterruptionRetries)
      } else {
        setQuestionInterruptionRetries(0)
        await this.speakQuestion(question, setQuestionText, questionInterruptionRetries, setQuestionInterruptionRetries)
      }
    }
  }

  async speakFollowUpQuestion(
    followUp: string,
    setQuestionText: (text: string | null) => void,
    questionInterruptionRetries: () => number,
    setQuestionInterruptionRetries: (count: number) => void
  ): Promise<void> {
    setQuestionText(followUp)
    const maxRetries = 2
    const currentRetries = questionInterruptionRetries()
    const allowInterruptions = currentRetries < maxRetries

    const result = await this.deps.speakRequested(
      followUp,
      {
        interruptible: allowInterruptions,
        bargeInPolicy: 'hard'
      },
      { kind: 'prompt', priority: 'auto', source: 'followup_question' }
    )

    if (result.completed && !result.softStopped && !result.interrupted) {
      setQuestionInterruptionRetries(0)
      setQuestionText(null)
      await this.stateMachine.transition('follow_up_asked')
      this.stateMachine.startSilenceTimer(40000)
    } else if (result.softStopped || result.interrupted) {
      const newRetries = currentRetries + 1
      setQuestionInterruptionRetries(newRetries)
      if (newRetries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.speakFollowUpQuestion(followUp, setQuestionText, questionInterruptionRetries, setQuestionInterruptionRetries)
      } else {
        setQuestionInterruptionRetries(0)
        await this.speakFollowUpQuestion(followUp, setQuestionText, questionInterruptionRetries, setQuestionInterruptionRetries)
      }
    }
  }

  async interruptAutoSpeech(reason: string): Promise<void> {
    const context = this.deps.getCurrentSpeechContext()
    if (context?.priority === 'auto' && this.deps.getLivekitAgentIsSpeaking()) {
      await this.deps.stopLivekitAgent()
    }
  }

  async withManualResponse<T>(kind: any, source: string, handler: () => Promise<T>): Promise<T> {
    await this.interruptAutoSpeech(`manual ${kind} requested (${source})`)
    this.startManualResponse(kind, source)
    try {
      return await handler()
    } finally {
      this.finishManualResponse(kind, source)
    }
  }

  private startManualResponse(kind: any, source: string): void {
    this.manualResponseInFlight = { kind, source, startedAt: Date.now() }
  }

  private finishManualResponse(kind: any, source: string): void {
    if (this.manualResponseInFlight && this.manualResponseInFlight.kind === kind && this.manualResponseInFlight.source === source) {
      this.manualResponseInFlight = null
    }
  }

  private isManualResponseActive(): boolean {
    return !!this.manualResponseInFlight
  }

  shouldSkipAutoResponse(trigger: string): boolean {
    return this.isManualResponseActive()
  }

  async handleBargeIn(): Promise<void> {
    if (this.deps.getLivekitAgentIsSpeaking() && this.deps.userSpeaking()) {
      const speakOptions = this.deps.getCurrentSpeakOptions()
      if (speakOptions) {
        if (speakOptions.interruptible === false) {
          this.stateMachine.clearSilenceTimer()
        } else if (speakOptions.bargeInPolicy === 'soft') {
          this.deps.setSoftStopRequested(true)
          this.stateMachine.clearSilenceTimer()
        } else {
          await this.deps.stopLivekitAgent()
          this.stateMachine.clearSilenceTimer()
        }
      } else {
        await this.deps.stopLivekitAgent()
        this.stateMachine.clearSilenceTimer()
      }
    }
  }

  async handleTranscriptBargeIn(text: string): Promise<void> {
    if (!text || text.trim().length < 2) {
      return
    }

    if (this.deps.autoHintInProgress()) {
      return
    }

    await this.handleBargeIn()
  }

  markUserSpeakingActivity(): void {
    this.deps.setUserSpeaking(true)
    if (this.deps.getLiveTranscriptTimeout()) {
      this.deps.clearLiveTranscriptTimeout()
    }
    const timeoutId = setTimeout(() => {
      this.deps.setUserSpeaking(false)
      this.deps.setLiveTranscriptTimeout(null)
    }, 1500)
    this.deps.setLiveTranscriptTimeout(timeoutId)
  }

  getSilenceTimerDuration(state: InterviewState): number {
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

  async handleSilenceTimeout(
    shouldSkipAutoResponse: (trigger: string) => boolean,
    getCurrentCodingProblem: () => any,
    getCurrentCode: () => string
  ): Promise<void> {
    const currentState = this.stateMachine.getState()

    if (this.isManualResponseActive()) {
      const delay = this.getSilenceTimerDuration(currentState)
      this.stateMachine.startSilenceTimer(delay)
      return
    }

    if (currentState === InterviewState.WAITING_FOR_APPROACH) {
      const approachSpoken = this.stateMachine.hasCodingApproachSpoken()
      const approachPromptCount = this.stateMachine.getApproachPromptCount()
      const codingHintCount = this.stateMachine.getCodingHintCount()
      const moveOnPromptGiven = this.stateMachine.hasCodingMoveOnPromptGiven()

      if (approachSpoken) {
        this.stateMachine.startSilenceTimer(120000)
        return
      }

      if (approachPromptCount === 0) {
        this.stateMachine.incrementApproachPromptCount()
        const reminder = "Please explain your approach to solving this problem, or feel free to ask any clarifying questions."
        const problem = getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', reminder, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.deps.syncConversationHistoryFromServices()
        }

        if (shouldSkipAutoResponse('approach_silence_prompt')) {
          this.stateMachine.startSilenceTimer(120000)
          return
        }

        await this.deps.speakRequested(
          reminder,
          { interruptible: true, bargeInPolicy: 'hard' },
          { kind: 'prompt', priority: 'auto', source: 'approach_silence_prompt' }
        )
        this.stateMachine.startSilenceTimer(120000)
        return
      }

      if (codingHintCount < 2) {
        const hintLevel = (codingHintCount + 1) as 1 | 2
        this.deps.setAutoHintInProgress(true)
        try {
          this.stateMachine.incrementCodingHintCount()
          const problem = getCurrentCodingProblem()
          if (problem) {
            const currentState = this.stateMachine.getState()
            const isApproachPhase = currentState === InterviewState.WAITING_FOR_APPROACH
            const hint = isApproachPhase
              ? await this.codeAnalysis.getApproachHint(problem, hintLevel)
              : await this.codeAnalysis.getHint(problem, getCurrentCode() || this.deps.getPreviousCode() || '', hintLevel)
            if (shouldSkipAutoResponse('silence_hint')) {
              this.stateMachine.startSilenceTimer(120000)
              return
            }
            this.codeAnalysis.addConversationMessage('assistant', hint, {
              type: 'hint',
              hintLevel: hintLevel,
              isAutomatic: true,
              source: 'timeout'
            } as any)
            this.deps.syncConversationHistoryFromServices()

            await this.deps.speakRequested(
              hint,
              { interruptible: true, bargeInPolicy: 'hard' },
              { kind: 'hint', priority: 'auto', source: 'approach_silence_hint' }
            )
            this.deps.emit('hintProvided', hint)
          }
        } finally {
          this.deps.setAutoHintInProgress(false)
        }

        this.stateMachine.startSilenceTimer(120000)
        return
      }

      if (!moveOnPromptGiven) {
        this.stateMachine.setCodingMoveOnPromptGiven(true)
        const moveOnPrompt = "Would you like to move on to the next question?"
        const problem = getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', moveOnPrompt, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.deps.syncConversationHistoryFromServices()
        }

        if (shouldSkipAutoResponse('approach_move_on_prompt')) {
          this.stateMachine.startSilenceTimer(120000)
          return
        }

        await this.deps.speakRequested(
          moveOnPrompt,
          { interruptible: true, bargeInPolicy: 'hard' },
          { kind: 'prompt', priority: 'auto', source: 'approach_move_on_prompt' }
        )
        this.stateMachine.startSilenceTimer(120000)
        return
      }

      this.stateMachine.startSilenceTimer(120000)
      return
    }

    if (currentState === InterviewState.THEORETICAL_QUESTION || currentState === InterviewState.WAITING_FOR_ANSWER) {
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        const hintEvents = this.stateMachine.incrementHintEventCount()

        try {
          if (hintEvents === 1) {
            const hintLevel = this.stateMachine.getHintLevel()
            this.deps.setAutoHintInProgress(true)
            try {
              const hintText = await this.llm.generateTheoreticalHint(currentQuestion, hintLevel)

              if (shouldSkipAutoResponse('theoretical_silence_hint')) {
                this.stateMachine.startSilenceTimer(40000)
                return
              }

              this.llm.addConversationMessage('assistant', hintText, {
                type: 'hint',
                questionId: currentQuestion.id,
                hintLevel: hintLevel,
                section: 'theoretical',
                isAutomatic: true,
                source: 'timeout'
              } as any)
              this.deps.syncConversationHistoryFromServices()

              const result = await this.deps.speakRequested(
                hintText,
                { interruptible: true, bargeInPolicy: 'hard' },
                { kind: 'hint', priority: 'auto', source: 'theoretical_silence_hint' }
              )
              if (result.completed) {
                this.deps.emit('hintProvided', hintText)
                this.stateMachine.incrementHintLevel()
                this.stateMachine.startSilenceTimer(40000)
              }
            } finally {
              this.deps.setAutoHintInProgress(false)
            }
          } else {
            const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
            const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`

            if (shouldSkipAutoResponse('theoretical_silence_answer')) {
              this.stateMachine.startSilenceTimer(40000)
              return
            }

            this.llm.addConversationMessage('assistant', finalPrompt, {
              type: 'answer',
              questionId: currentQuestion.id,
              section: 'theoretical',
              hintLevel: 2
            } as any)
            this.deps.syncConversationHistoryFromServices()

            await this.deps.speakRequested(
              finalPrompt,
              { interruptible: false, bargeInPolicy: 'soft' },
              { kind: 'answer', priority: 'auto', source: 'theoretical_silence_answer' }
            )
            await this.deps.forceMoveToNextQuestion()
          }
        } catch (error) {
        }
      }
    }
  }
}

