import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, CodingProblem } from './services/code-analysis-service'
import type { ConversationMessage } from '../shared/types'

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
  userSpeaking: () => boolean
  autoHintInProgress: () => boolean
  setAutoHintInProgress: (value: boolean) => void
  shouldSkipAutoResponse: (trigger: string) => boolean
  withManualResponse: <T>(kind: any, source: string, handler: () => Promise<T>) => Promise<T>
  currentCode: () => string
  setCurrentCode: (code: string) => void
  speakRequested: (text: string, options: SpeakOptions, context: SpeechContext) => Promise<any>
  interruptAutoSpeech: (reason: string) => Promise<void>
  isManualResponseActive: () => boolean
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
  startManualResponse: (kind: any, source: string) => void
  finishManualResponse: (kind: any, source: string) => void
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
}

export class InterviewEngine extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: InterviewSessionDeps

  private fullConversationHistory: ConversationMessage[] = []
  private allEvaluations: Evaluation[] = []
  private currentQuestionId: string | null = null
  private currentQuestionText: string | null = null
  private currentCode: string = ''
  private currentIntervalHasHintClarification: boolean = false
  private currentIntervalHasSubstantialSpeech: boolean = false
  private manualResponseInFlight: { kind: any; source: string; startedAt: number } | null = null
  private questionInterruptionRetries: number = 0

  constructor(deps: InterviewSessionDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    const currentStateBeforeEval = this.stateMachine.getState()
    if (currentStateBeforeEval === InterviewState.WAITING_FOR_ANSWER) {
      await this.stateMachine.transition('candidate_finished_speaking')
    }

    this.allEvaluations.push(evaluation)

    this.stateMachine.addEvaluation(evaluation)

    this.emit('evaluation', evaluation)

    this.llm.setFollowUpDepth(this.stateMachine.getFollowUpDepth())
    this.llm.setMaxTheoreticalQuestions(this.stateMachine.getMaxTheoreticalQuestions())

    const currentQuestion = this.llm.getCurrentQuestion()
    if (currentQuestion) {
      if (evaluation.feedback && evaluation.feedback.trim().length > 0) {
        if (!evaluation.followUpQuestion) {
          this.llm.addConversationMessage('assistant', evaluation.feedback, {
            type: 'feedback',
            questionId: currentQuestion.id,
            section: 'theoretical',
            evaluation: {
              score: evaluation.score,
              keyPointsCovered: evaluation.keyPointsCovered,
              needsFollowUp: evaluation.needsFollowUp
            }
          } as any)
          this.syncConversationHistoryFromServices()

          this.emit('speakRequested', <SpeakRequest>{
            text: evaluation.feedback,
            options: { interruptible: true, bargeInPolicy: 'hard' },
            context: { kind: 'feedback', priority: 'auto', source: 'evaluation' }
          })
        } else {
          this.llm.addConversationMessage('assistant', 'Let me ask a follow-up question about that.', {
            type: 'feedback',
            questionId: currentQuestion.id,
            section: 'theoretical',
            evaluation: {
              score: evaluation.score,
              keyPointsCovered: evaluation.keyPointsCovered,
              needsFollowUp: evaluation.needsFollowUp
            }
          } as any)
          this.syncConversationHistoryFromServices()
        }
      }
    }

    if (evaluation.needsFollowUp && this.stateMachine.canAskFollowUp()) {
      this.stateMachine.incrementTotalTheoreticalQuestions()
      await this.stateMachine.transition('needs_follow_up')
    } else {
      const currentFollowUpDepth = this.stateMachine.getFollowUpDepth()

      this.stateMachine.resetFollowUpDepth()
      this.llm.resetFollowUpDepth()

      const currentIndex = this.stateMachine.getCurrentQuestionIndex()
      const totalQuestions = this.stateMachine.getQuestions().length
      const hasMoreQuestions = currentIndex < totalQuestions - 1

      if (!hasMoreQuestions) {
        await this.stateMachine.transition('all_questions_done')
      } else if (this.stateMachine.hasReachedTheoreticalLimit()) {
        await this.stateMachine.transition('all_questions_done')
      } else {
        this.stateMachine.moveToNextQuestion()
        this.llm.moveToNextQuestion()
        const progress = this.stateMachine.getProgress()
        this.emit('progressUpdate', progress)
        await this.stateMachine.transition('next_question')
      }
    }
  }

  async processTranscript(text: string, state: InterviewState): Promise<void> {
    this.stateMachine.clearSilenceTimer()

    if (state === InterviewState.WAITING_FOR_ANSWER || state === InterviewState.THEORETICAL_QUESTION) {
      await this.processTheoreticalTranscript(text, state)
    } else if (state === InterviewState.WAITING_FOR_APPROACH) {
      await this.processApproachTranscript(text)
    } else if (state === InterviewState.MONITORING_CODE) {
      await this.processMonitoringTranscript(text)
    }
  }

  private async processTheoreticalTranscript(text: string, state: InterviewState): Promise<void> {
    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request') {
      await this.handleHintRequest(text)
      return
    }

    if (intent.intent === 'clarification_request') {
      await this.handleClarificationRequest(text)
      return
    }

    if (intent.intent === 'skip_question') {
      await this.handleSkipRequest(text)
      return
    }

    await this.handleAnswer(text, intent, state)
  }

  private async handleAnswer(text: string, intent: any, state: InterviewState): Promise<void> {
    const followUpDepth = this.stateMachine.getFollowUpDepth()
    const actualState = this.stateMachine.getState()
    let response: any

    if (followUpDepth > 0 || actualState === InterviewState.FOLLOW_UP) {
      const currentEvaluation = this.stateMachine.getCurrentEvaluation()
      const originalQuestion = this.llm.getCurrentQuestion()

      if (currentEvaluation && originalQuestion) {
        this.llm.addConversationMessage('user', text, {
          type: 'answer',
          questionId: originalQuestion.id,
          section: 'theoretical'
        })
        this.syncConversationHistoryFromServices()

        response = await this.llm.evaluateFollowUpAnswer(
          originalQuestion,
          currentEvaluation.candidateAnswer,
          currentEvaluation.followUpQuestion || '',
          text,
          followUpDepth
        )
      } else {
        response = await this.llm.processTranscript(text, intent)
      }
    } else {
      response = await this.llm.processTranscript(text, intent)
    }

    await this.handleResponseAction(response, text, state)
  }

  private async handleResponseAction(response: any, originalText: string, state: InterviewState): Promise<void> {
    if (response.action === 'speak' && response.text) {
      await this.handleSpeakResponse(response, originalText, state)
    } else if (response.action === 'hint' && response.text) {
      await this.handleHintResponse(response)
    } else if (response.action === 'clarification' && response.text) {
      await this.handleClarificationResponse(response)
    } else if (response.action === 'skip') {
      await this.handleSkipResponse(response)
    } else if (response.action === 'evaluate' && response.evaluation) {
      await this.handleEvaluation(response.evaluation)
    }
  }

  private async handleSpeakResponse(response: any, originalText: string, state: InterviewState): Promise<void> {
    this.emit('speakRequested', <SpeakRequest>{
      text: response.text,
      options: { interruptible: true, bargeInPolicy: 'hard' },
      context: { kind: 'system', priority: 'auto', source: 'llm_response' }
    })

    const chitChatCount = this.stateMachine.incrementNormalConversationCount()

    if (chitChatCount === 2) {
      const nudge = "Let's focus on the question. Please share your answer. You can also ask for a hint, or say 'I don't know' if you're unsure."
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        this.llm.addConversationMessage('assistant', nudge, {
          type: 'feedback',
          questionId: currentQuestion.id,
          section: 'theoretical'
        } as any)
        this.syncConversationHistoryFromServices()
      }

      this.emit('speakRequested', <SpeakRequest>{
        text: nudge,
        options: { interruptible: true, bargeInPolicy: 'hard' },
        context: { kind: 'system', priority: 'auto', source: 'chit_chat_nudge' }
      })
      this.stateMachine.startSilenceTimer(40000)
      return
    }

    if (chitChatCount >= 3) {
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        const answerText = currentQuestion.expectedAnswer || 'Let me provide a concise answer based on best practices.'
        const finalPrompt = `Here's a concise answer: ${answerText}. Let's move to the next question.`

        this.llm.addConversationMessage('assistant', finalPrompt, {
          type: 'answer',
          questionId: currentQuestion.id,
          section: 'theoretical'
        } as any)
        this.syncConversationHistoryFromServices()

        this.emit('speakRequested', <SpeakRequest>{
          text: finalPrompt,
          options: { interruptible: false, bargeInPolicy: 'soft' },
          context: { kind: 'system', priority: 'auto', source: 'chit_chat_limit' }
        })

        await this.forceMoveToNextQuestion()
      }
      return
    }

    const lowerText = response.text.toLowerCase()
    const isPositiveAck = lowerText.includes('correct') ||
      lowerText.includes('good job') ||
      lowerText.includes('well done') ||
      lowerText.includes('excellent') ||
      lowerText.includes('great') ||
      (lowerText.includes('right') && !lowerText.includes('not right'))

    if (isPositiveAck && state === InterviewState.WAITING_FOR_ANSWER) {
      const currentQuestion = this.llm.getCurrentQuestion()
      if (currentQuestion) {
        const basicEvaluation: Evaluation = {
          questionId: currentQuestion.id,
          candidateAnswer: originalText,
          keyPointsCovered: [],
          score: 70,
          needsFollowUp: false,
          followUpQuestion: undefined,
          feedback: response.text
        }
        await this.handleEvaluation(basicEvaluation)
      }
    }
  }

  private async handleHintResponse(response: any): Promise<void> {
    await this.stateMachine.transition('hint_requested')
    this.emit('hintSpokenRequested', response.text)
  }

  private async handleClarificationResponse(response: any): Promise<void> {
    await this.stateMachine.transition('clarification_requested')
    this.emit('clarificationSpokenRequested', response.text)
  }

  private async handleSkipRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'skip',
      questionId: currentQuestion.id,
      section: 'theoretical'
    } as any)
    this.syncConversationHistoryFromServices()

    const response = await this.llm.handleSkipQuestion()
    await this.handleSkipResponse(response)
  }

  private async handleSkipResponse(response: any): Promise<void> {
    if (response.text && (!response.evaluation || !response.evaluation.feedback)) {
      this.emit('speakRequested', <SpeakRequest>{
        text: response.text,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'skip_question' }
      })
    }

    if (response.evaluation) {
      await this.handleEvaluation(response.evaluation)
    } else {
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
        await this.forceMoveToNextQuestion()
      }
    }
  }

  private async handleHintRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'hint',
      questionId: currentQuestion.id,
      section: 'theoretical'
    })
    this.syncConversationHistoryFromServices()

    const hintEvents = this.stateMachine.incrementHintEventCount()
    const questionForHint = this.llm.getCurrentQuestion()
    if (!questionForHint) {
      return
    }

    if (hintEvents === 1) {
      await this.stateMachine.transition('hint_requested')
      const hintLevel = this.stateMachine.getHintLevel()
      const hintText = await this.llm.generateTheoreticalHint(questionForHint, hintLevel)

      this.llm.addConversationMessage('assistant', hintText, {
        type: 'hint',
        questionId: questionForHint.id,
        hintLevel: hintLevel as 1 | 2,
        section: 'theoretical'
      })
      this.syncConversationHistoryFromServices()

      this.emit('hintSpokenRequested', hintText)
    } else {
      const followUpDepth = this.stateMachine.getFollowUpDepth()
      const currentEvaluation = this.stateMachine.getCurrentEvaluation()
      const isFollowUp = followUpDepth > 0

      let answerText: string
      let answerContext: string

      if (isFollowUp && currentEvaluation?.followUpQuestion) {
        answerText = currentEvaluation.followUpQuestion
        answerContext = `Since you've asked for help twice, here's what I was asking: ${answerText}. This was a follow up question to your previous answer. Let's move to the next question.`
      } else {
        answerText = questionForHint.expectedAnswer || 'Here is the concise answer based on best practices.'
        answerContext = `Here's the answer: ${answerText}. Let's move to the next question.`
      }

      this.llm.addConversationMessage('assistant', answerContext, {
        type: 'answer',
        questionId: questionForHint.id,
        section: 'theoretical',
        hintLevel: 2
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: answerContext,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'hint_escalation' }
      })

      await this.forceMoveToNextQuestion()
    }
  }

  async onHintSpokenCompleted(hintText: string): Promise<void> {
    await this.stateMachine.transition('hint_provided')
    this.emit('hintProvided', hintText)
    this.stateMachine.incrementHintLevel()
    this.stateMachine.startSilenceTimer(40000)
  }

  private async handleClarificationRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'clarification',
      questionId: currentQuestion.id,
      section: 'theoretical'
    })
    this.syncConversationHistoryFromServices()

    const clarifyCount = this.stateMachine.incrementClarificationRequestCount()
    const questionForClarification = this.llm.getCurrentQuestion()
    if (!questionForClarification) {
      return
    }

    if (clarifyCount === 1) {
      await this.stateMachine.transition('clarification_requested')
      const response = await this.llm.handleClarificationRequest()
      if (response && response.text) {
        this.llm.addConversationMessage('assistant', response.text, {
          type: 'clarification',
          questionId: questionForClarification.id,
          section: 'theoretical'
        })
        this.syncConversationHistoryFromServices()

        this.emit('clarificationSpokenRequested', response.text)
      }
    } else {
      const followUpDepth = this.stateMachine.getFollowUpDepth()
      const currentEvaluation = this.stateMachine.getCurrentEvaluation()
      const isFollowUp = followUpDepth > 0

      let answerText: string
      let finalPrompt: string

      if (isFollowUp && currentEvaluation?.followUpQuestion) {
        answerText = currentEvaluation.followUpQuestion
        finalPrompt = `Since you've asked for clarification twice, here's what I was asking: ${answerText}. This was a follow up question to your previous answer. Let's move to the next question.`
      } else {
        answerText = questionForClarification.expectedAnswer || 'Here is the concise answer based on best practices.'
        finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`
      }

      this.llm.addConversationMessage('assistant', finalPrompt, {
        type: 'answer',
        questionId: questionForClarification.id,
        section: 'theoretical'
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: finalPrompt,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'clarification_escalation' }
      })

      await this.forceMoveToNextQuestion()
    }
  }

  async onClarificationSpokenCompleted(clarificationText: string): Promise<void> {
    await this.stateMachine.transition('clarification_provided')
    this.stateMachine.startSilenceTimer(40000)
  }

  async onAskQuestion(question: Question): Promise<void> {
    this.currentQuestionId = question.id
    this.currentQuestionText = question.question

    this.llm.addConversationMessage('assistant', question.question, {
      type: 'question',
      questionId: question.id,
      section: 'theoretical'
    })
    this.syncConversationHistoryFromServices()

    const progress = this.stateMachine.getProgress()
    this.emit('progressUpdate', progress)
    this.emit('questionAsked', question)
  }

  async onAskFollowUp(followUp: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (currentQuestion) {
      this.llm.addConversationMessage('assistant', followUp, {
        type: 'followup',
        questionId: currentQuestion.id,
        section: 'theoretical'
      })
      this.syncConversationHistoryFromServices()
    }

    this.stateMachine.resetHintEventCount()
    this.stateMachine.resetClarificationRequestCount()
    this.stateMachine.resetHintLevel()
    this.stateMachine.resetNormalConversationCount()
    this.stateMachine.resetSilenceTimeoutCount()

    this.stateMachine.incrementFollowUpDepth()
    this.llm.incrementFollowUpDepth()

    this.currentQuestionText = followUp
    this.emit('followUpAsked', followUp)
  }

  async forceMoveToNextQuestion(): Promise<void> {
    const currentState = this.stateMachine.getState()
    if (currentState === InterviewState.WAITING_FOR_ANSWER) {
      await this.stateMachine.transition('candidate_finished_speaking')
    }

    this.stateMachine.resetFollowUpDepth()
    this.llm.resetFollowUpDepth()

    const progress = this.llm.getProgress()
    const hasMoreQuestions = progress.current < progress.total

    if (!hasMoreQuestions) {
      await this.stateMachine.transition('all_questions_done')
      return
    }

    if (this.stateMachine.hasReachedTheoreticalLimit()) {
      await this.stateMachine.transition('all_questions_done')
      return
    }

    this.stateMachine.moveToNextQuestion()
    this.llm.moveToNextQuestion()
    await this.stateMachine.transition('next_question')
  }

  setCurrentCode(code: string): void {
    this.currentCode = code
  }

  resetIntervalTracking(): void {
    this.currentIntervalHasHintClarification = false
    this.currentIntervalHasSubstantialSpeech = false
  }

  private async processApproachTranscript(text: string): Promise<void> {
    const problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      return
    }

    const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || ''
    const isWritingCode = currentCode && currentCode.trim().length > 0

    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request') {
      await this.handleApproachHintRequest(text, problem)
      return
    }

    if (intent.intent === 'clarification_request') {
      await this.handleApproachClarificationRequest(text, problem, currentCode)
      return
    }

    if (intent.intent === 'skip_question') {
      this.emit('skipRequested', { problem, text })
      return
    }

    await this.stateMachine.transition('approach_provided')
    this.codeAnalysis.addVerbalExplanation(text)
    this.syncConversationHistoryFromServices()

    const isFirstApproach = !this.stateMachine.hasCodingApproachSpoken()
    const response = await this.codeAnalysis.evaluateApproach(text, problem, currentCode, isFirstApproach)

    const textLength = text.trim().length
    const isShortText = textLength < 80

    if (isWritingCode) {
      if (response.isClarification) {
        this.codeAnalysis.addClarificationRequest(text)
        const clarification = response.clarification || response.feedback || "Let me clarify that for you."
        this.codeAnalysis.addClarification(clarification)
        this.syncConversationHistoryFromServices()

        this.emit('speakRequested', <SpeakRequest>{
          text: clarification,
          options: { interruptible: true, bargeInPolicy: 'hard' },
          context: { kind: 'clarification', priority: 'auto', source: 'approach_clarification' }
        })
        await this.stateMachine.transition('approach_approved')
        return
      }

      if (isShortText && !response.isApproach) {
        this.stateMachine.setCodingApproachSpoken(true)
        await this.stateMachine.transition('approach_approved')
        return
      }

      this.stateMachine.setCodingApproachSpoken(true)

      if (response.isApproach && response.isCorrect) {
        const feedback = response.feedback || "Good approach! Keep implementing."
        this.emit('speakRequested', <SpeakRequest>{
          text: feedback,
          options: { interruptible: true, bargeInPolicy: 'hard' },
          context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
        })
        await this.stateMachine.transition('approach_approved')
      } else if (response.isApproach && !response.isCorrect) {
        const feedback = response.feedback || "I see. Keep working on your solution."
        this.emit('speakRequested', <SpeakRequest>{
          text: feedback,
          options: { interruptible: true, bargeInPolicy: 'hard' },
          context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
        })
        await this.stateMachine.transition('approach_approved')
      } else {
        await this.stateMachine.transition('approach_approved')
      }
    } else {
      if (response.isClarification) {
        this.codeAnalysis.addClarificationRequest(text)
        const clarification = response.clarification || response.feedback || "Let me clarify that for you."
        this.codeAnalysis.addClarification(clarification)
        this.syncConversationHistoryFromServices()

        this.emit('speakRequested', <SpeakRequest>{
          text: clarification,
          options: { interruptible: false, bargeInPolicy: 'soft' },
          context: { kind: 'clarification', priority: 'auto', source: 'approach_clarification' }
        })
        this.stateMachine.startSilenceTimer(120000)
        await this.stateMachine.transition('approach_needs_retry')
        return
      }

      const isUnclear = !response.isApproach && !response.isClarification

      if (isUnclear) {
        this.stateMachine.startSilenceTimer(120000)
        await this.stateMachine.transition('approach_needs_retry')
        return
      }

      if (response.isApproach && isShortText) {
        this.stateMachine.startSilenceTimer(120000)
        await this.stateMachine.transition('approach_needs_retry')
        return
      }

      if (response.isApproach) {
        this.stateMachine.setCodingApproachSpoken(true)

        if (response.isCorrect) {
          const feedback = response.feedback || "That's a solid approach! Go ahead and implement it."
          this.emit('speakRequested', <SpeakRequest>{
            text: feedback,
            options: { interruptible: false, bargeInPolicy: 'soft' },
            context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
          })
          await this.stateMachine.transition('approach_approved')
        } else {
          const feedback = response.feedback || "That's an interesting approach. Let's proceed with the implementation and see how it goes."
          this.emit('speakRequested', <SpeakRequest>{
            text: feedback,
            options: { interruptible: false, bargeInPolicy: 'soft' },
            context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
          })
          await this.stateMachine.transition('approach_approved')
        }
      } else {
        const approachPromptCount = this.stateMachine.getApproachPromptCount()
        if (approachPromptCount === 0) {
          this.stateMachine.incrementApproachPromptCount()
          const acknowledgement = "I'd like to hear your approach to solving this problem. How do you plan to tackle it?"

          this.codeAnalysis.addConversationMessage('assistant', acknowledgement, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.syncConversationHistoryFromServices()

          this.emit('speakRequested', <SpeakRequest>{
            text: acknowledgement,
            options: { interruptible: false, bargeInPolicy: 'soft' },
            context: { kind: 'system', priority: 'auto', source: 'approach_prompt' }
          })
          this.stateMachine.startSilenceTimer(120000)
          await this.stateMachine.transition('approach_needs_retry')
        } else {
          this.stateMachine.setCodingApproachSpoken(true)
          await this.stateMachine.transition('approach_approved')
        }
      }
    }
  }

  private async handleApproachHintRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canProvideCodingHint()) {
      const limitMessage = "I've provided the maximum number of hints. Please continue with your approach."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: limitMessage,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'hint', priority: 'manual', source: 'approach_manual_hint_limit' }
      })
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    const hintNumber = this.stateMachine.incrementCodingHintCount()
    const hintLevel = Math.min(hintNumber, 2) as 1 | 2

    this.codeAnalysis.addHintRequest(text)
    const hint = await this.codeAnalysis.getApproachHint(problem, hintLevel)
    this.codeAnalysis.addHint(hint, hintLevel)
    this.syncConversationHistoryFromServices()

    this.emit('hintSpokenRequested', hint)
    this.stateMachine.startSilenceTimer(120000)
    await this.stateMachine.transition('approach_needs_retry')
  }

  private async handleApproachClarificationRequest(text: string, problem: CodingProblem, currentCode: string): Promise<void> {
    if (!this.stateMachine.canAskCodingClarification()) {
      const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: limitMessage,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'clarification', priority: 'manual', source: 'approach_manual_clarification_limit' }
      })
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    this.stateMachine.incrementCodingClarificationCount()
    this.codeAnalysis.addClarificationRequest(text)

    const clarification = await this.llm.generateCodingClarification(
      problem,
      text,
      this.stateMachine.getCodingClarificationCount(),
      currentCode
    )

    this.codeAnalysis.addClarification(clarification)
    this.syncConversationHistoryFromServices()

    this.emit('clarificationSpokenRequested', clarification)
    this.stateMachine.startSilenceTimer(120000)
    await this.stateMachine.transition('approach_needs_retry')
  }

  private async processMonitoringTranscript(text: string): Promise<void> {
    const problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      return
    }

    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request' || intent.intent === 'clarification_request') {
      this.currentIntervalHasHintClarification = true
    }

    const transcriptLength = text.trim().length
    if (transcriptLength > 70) {
      this.currentIntervalHasSubstantialSpeech = true
    }

    if (intent.intent === 'hint_request') {
      await this.handleMonitoringHintRequest(text, problem)
      return
    }

    if (intent.intent === 'clarification_request') {
      await this.handleMonitoringClarificationRequest(text, problem)
      return
    }

    if (intent.intent === 'skip_question') {
      this.emit('skipRequested', { problem, text })
      return
    }

    const trimmed = text.trim()
    if (trimmed.length < 80) {
      this.codeAnalysis.addConversationMessage('user', text, {
        type: 'answer',
        codingProblemId: problem.id,
        section: 'coding'
      })
      this.syncConversationHistoryFromServices()
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    this.codeAnalysis.addConversationMessage('user', text, {
      type: 'answer',
      codingProblemId: problem.id,
      section: 'coding'
    })
    this.syncConversationHistoryFromServices()

    const acknowledgement = "I understand. Keep working on your solution."
    this.emit('speakRequested', <SpeakRequest>{
      text: acknowledgement,
      options: { interruptible: true, bargeInPolicy: 'hard' },
      context: { kind: 'system', priority: 'auto', source: 'monitoring_acknowledgement' }
    })
    this.stateMachine.startSilenceTimer(120000)
  }

  private async handleMonitoringHintRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canProvideCodingHint()) {
      const limitMessage = "I've provided the maximum number of hints. Please continue with your implementation."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: limitMessage,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'hint', priority: 'manual', source: 'coding_manual_hint_limit' }
      })
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    const hintNumber = this.stateMachine.incrementCodingHintCount()
    const hintLevel = Math.min(hintNumber, 2) as 1 | 2

    this.codeAnalysis.addHintRequest(text)
    const currentCode = this.currentCode || this.stateMachine.getPreviousCode() || ''
    const hintText = await this.codeAnalysis.getHint(problem, currentCode, hintLevel)
    this.codeAnalysis.addHint(hintText, hintLevel)
    this.syncConversationHistoryFromServices()

    this.emit('hintSpokenRequested', hintText)
    this.stateMachine.startSilenceTimer(120000)
  }

  private async handleMonitoringClarificationRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canAskCodingClarification()) {
      const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.syncConversationHistoryFromServices()

      this.emit('speakRequested', <SpeakRequest>{
        text: limitMessage,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'clarification', priority: 'manual', source: 'coding_manual_clarification_limit' }
      })
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    this.stateMachine.incrementCodingClarificationCount()
    this.codeAnalysis.addClarificationRequest(text)

    const currentCode = this.stateMachine.getPreviousCode() || ''
    const clarification = await this.llm.generateCodingClarification(
      problem,
      text,
      this.stateMachine.getCodingClarificationCount(),
      currentCode
    )

    this.codeAnalysis.addClarification(clarification)
    this.syncConversationHistoryFromServices()

    this.emit('clarificationSpokenRequested', clarification)
    this.stateMachine.startSilenceTimer(120000)
  }

  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }, problem: CodingProblem | null): Promise<any> {
    if (!problem) {
      throw new Error('No coding problem context')
    }

    this.currentCode = codeData.code
    const analysis = await this.codeAnalysis.analyzeCode(codeData.code || '', problem)

    const currentState = this.stateMachine.getState()
    const isMonitoringCode = currentState === InterviewState.MONITORING_CODE

    if (!isMonitoringCode) {
      return analysis
    }

    const shouldProvideHint = analysis.isStuck && !this.currentIntervalHasHintClarification && !this.currentIntervalHasSubstantialSpeech

    this.currentIntervalHasHintClarification = false
    this.currentIntervalHasSubstantialSpeech = false

    if (shouldProvideHint) {
      if (!this.stateMachine.canProvideCodingHint()) {
        return analysis
      }

      const hintNumber = this.stateMachine.incrementCodingHintCount()
      const hintLevel = Math.min(hintNumber, 2) as 1 | 2
      const hintText = await this.codeAnalysis.getHint(problem, codeData.code, hintLevel)
      this.codeAnalysis.addHint(hintText, hintLevel)
      this.syncConversationHistoryFromServices()

      this.emit('hintSpokenRequested', hintText)
    }

    return analysis
  }

  async submitCodingSolution(
    code: string,
    problem: CodingProblem,
    codingProblems: CodingProblem[],
    isTimeout: boolean = false,
    timeComplexity?: string,
    spaceComplexity?: string
  ): Promise<{ success: boolean, feedback: string, hasNextProblem: boolean }> {
    this.codeAnalysis.setFinalCode(code, timeComplexity, spaceComplexity)
    this.syncConversationHistoryFromServices()

    const analysis = await this.codeAnalysis.analyzeCode(code, problem)
    this.syncConversationHistoryFromServices()

    let feedback = ''
    if (isTimeout) {
      if (analysis.progress >= 50) {
        feedback = "Time's up. Moving on."
      } else {
        feedback = "Time's up. Let's continue."
      }
    } else {
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
      } catch (error) {
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

    const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
    const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1

    this.emit('solutionSubmitted', {
      code,
      problem,
      timeComplexity,
      spaceComplexity,
      isTimeout,
      hasNextProblem,
      feedback,
      analysis
    })

    return {
      success: analysis.progress >= 70,
      feedback,
      hasNextProblem
    }
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

  shouldSkipAutoResponse(trigger: string): boolean {
    if (this.deps.isManualResponseActive()) {
      return true
    }
    return false
  }

  private startManualResponse(kind: any, source: string): void {
    this.manualResponseInFlight = { kind, source, startedAt: Date.now() }
  }

  private finishManualResponse(kind: any, source: string): void {
    if (this.manualResponseInFlight && this.manualResponseInFlight.kind === kind && this.manualResponseInFlight.source === source) {
      this.manualResponseInFlight = null
    }
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

    const analysis = await this.analyzeCode(codeData, problem)

    if (this.deps.userSpeaking()) {
      return analysis
    }

    this.deps.setAutoHintInProgress(true)
    try {
      if (this.shouldSkipAutoResponse('monitoring_auto_hint')) {
        return analysis
      }
    } finally {
      this.deps.setAutoHintInProgress(false)
    }

    this.resetIntervalTracking()
    return analysis
  }

  async handleHintProvision(): Promise<void> {
    this.deps.setAutoHintInProgress(true)
    try {
      const last = this.codeAnalysis.getObservations().slice(-1)[0]
      const session = this.deps.getCurrentSession()
      const problem = this.codeAnalysis.getCurrentProblem() || (session?.codingProblems?.[0] ?? null)
      if (last && problem && last.analysis.isStuck) {
        if (this.shouldSkipAutoResponse('analysis_observation_hint')) {
          return
        }
        const currentCode = this.deps.currentCode() || last.code || ''
        const hintText = await this.codeAnalysis.getHint(problem, currentCode, 1)
        this.codeAnalysis.addConversationMessage('assistant', hintText, {
          type: 'hint',
          hintLevel: 1,
          isAutomatic: true,
          source: 'stuck_detection'
        } as any)
        this.deps.syncConversationHistoryFromServices()

        const result = await this.deps.speakRequested(
          hintText,
          { interruptible: true, bargeInPolicy: 'hard' },
          { kind: 'hint', priority: 'auto', source: 'analysis_observation_hint' }
        )
        if (result.completed) {
          await this.stateMachine.transition('hint_provided')
          this.emit('hintProvided', hintText)
        }
      }
    } finally {
      this.deps.setAutoHintInProgress(false)
    }
  }

  async handleSilenceTimeout(): Promise<void> {
    const currentState = this.stateMachine.getState()

    if (this.deps.isManualResponseActive()) {
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
        const problem = this.deps.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', reminder, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.deps.syncConversationHistoryFromServices()
        }

        if (this.shouldSkipAutoResponse('approach_silence_prompt')) {
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
          const problem = this.deps.getCurrentCodingProblem()
          if (problem) {
            const currentState = this.stateMachine.getState()
            const isApproachPhase = currentState === InterviewState.WAITING_FOR_APPROACH
            const hint = isApproachPhase
              ? await this.codeAnalysis.getApproachHint(problem, hintLevel)
              : await this.codeAnalysis.getHint(problem, this.deps.currentCode() || this.stateMachine.getPreviousCode() || '', hintLevel)
            if (this.shouldSkipAutoResponse('silence_hint')) {
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
            this.emit('hintProvided', hint)
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
        const problem = this.deps.getCurrentCodingProblem()
        if (problem) {
          this.codeAnalysis.addConversationMessage('assistant', moveOnPrompt, {
            type: 'feedback',
            codingProblemId: problem.id,
            section: 'coding'
          } as any)
          this.deps.syncConversationHistoryFromServices()
        }

        if (this.shouldSkipAutoResponse('approach_move_on_prompt')) {
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

              if (this.shouldSkipAutoResponse('theoretical_silence_hint')) {
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
                this.emit('hintProvided', hintText)
                this.stateMachine.incrementHintLevel()
                this.stateMachine.startSilenceTimer(40000)
              }
            } finally {
              this.deps.setAutoHintInProgress(false)
            }
          } else {
            const answerText = currentQuestion.expectedAnswer || 'Here is the concise answer based on best practices.'
            const finalPrompt = `Here's the answer: ${answerText}. Let's move to the next question.`

            if (this.shouldSkipAutoResponse('theoretical_silence_answer')) {
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

  async handleInterviewCompletion(): Promise<void> {
    const session = this.deps.getCurrentSession()
    if (!session) {
      return
    }

    try {
      session.endTime = new Date()
      session.status = 'completed'

      this.deps.syncConversationHistoryFromServices()

      const fullHistory = this.deps.getFullConversationHistory()
      const codingConversations = this.deps.getCodingProblemConversations()
      const allEvaluations = this.deps.getAllEvaluations()

      if (codingConversations.length === 0 && fullHistory.length > 0) {
        const problemIds = [...new Set(fullHistory
          .filter(m => m.metadata.codingProblemId)
          .map(m => m.metadata.codingProblemId!))]

        for (const problemId of problemIds) {
          const problem = session.codingProblems?.find((p: CodingProblem) => p.id === problemId)
          if (problem) {
            const problemHistory = this.deps.getProblemConversationHistory(problemId)
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
              codingConversations.push(problemConversation)
            }
          }
        }
      }

      if (allEvaluations.length === 0 && fullHistory.length > 0) {
        const theoreticalMessages = fullHistory.filter(
          m => m.metadata.section === 'theoretical' && m.metadata.evaluation
        )

        for (const msg of theoreticalMessages) {
          if (msg.metadata.evaluation && msg.metadata.questionId) {
            const questionId = msg.metadata.questionId
            const evaluationTimestamp = msg.timestamp

            const userAnswer = fullHistory
              .filter(m =>
                m.metadata.questionId === questionId &&
                m.role === 'user' &&
                m.timestamp < evaluationTimestamp &&
                (m.metadata.type === 'answer' || m.metadata.type === 'hint' || m.metadata.type === 'clarification')
              )
              .sort((a, b) => b.timestamp - a.timestamp)[0]

            if (userAnswer && msg.metadata.evaluation) {
              let followUpQuestion: string | undefined = undefined
              if (msg.metadata.evaluation.needsFollowUp) {
                const followUpMsg = fullHistory
                  .filter(m =>
                    m.metadata.questionId === questionId &&
                    m.role === 'assistant' &&
                    m.timestamp > evaluationTimestamp &&
                    m.metadata.type === 'followup'
                  )
                  .sort((a, b) => a.timestamp - b.timestamp)[0]

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
                feedback: msg.content
              }

              const exists = allEvaluations.some(
                e => e.questionId === evaluation.questionId &&
                     e.candidateAnswer === evaluation.candidateAnswer &&
                     Math.abs(e.score - evaluation.score) < 0.01
              )

              if (!exists) {
                allEvaluations.push(evaluation)
              }
            }
          }
        }
      }

      const currentProblem = this.codeAnalysis.getCurrentProblem()
      if (currentProblem) {
        const existingIndex = codingConversations.findIndex(
          (c: any) => c.problemId === currentProblem.id
        )

        if (existingIndex === -1) {
          const problemHistory = this.deps.getProblemConversationHistory(currentProblem.id)
          const finalSubmission = this.codeAnalysis.getFinalSubmission()
          const problemConversation = {
            problemId: currentProblem.id,
            problem: currentProblem,
            conversation: problemHistory,
            finalCode: finalSubmission.code,
            timeComplexity: finalSubmission.timeComplexity,
            spaceComplexity: finalSubmission.spaceComplexity,
            codeAnalysisHistory: this.codeAnalysis.getObservations().map(obs => obs.analysis),
            submittedAt: new Date(),
            evaluation: undefined
          }
          codingConversations.push(problemConversation)
        }
      }

      this.emit('interviewCompleted', session)
    } catch (error) {
    }
  }

  async speakQuestion(question: string): Promise<void> {
    this.deps.setCurrentQuestionText(question)
    const maxRetries = 2
    const currentRetries = this.deps.questionInterruptionRetries()
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
      this.deps.setQuestionInterruptionRetries(0)
      this.deps.setCurrentQuestionText(null)
      if (this.stateMachine.getState() === InterviewState.THEORETICAL_QUESTION) {
        await this.stateMachine.transition('question_asked')
      }
      this.stateMachine.startSilenceTimer(40000)
    } else if (result.softStopped || result.interrupted) {
      const newRetries = currentRetries + 1
      this.deps.setQuestionInterruptionRetries(newRetries)
      if (newRetries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.speakQuestion(question)
      } else {
        this.deps.setQuestionInterruptionRetries(0)
        await this.speakQuestion(question)
      }
    }
  }

  async speakFollowUpQuestion(followUp: string): Promise<void> {
    this.deps.setCurrentQuestionText(followUp)
    const maxRetries = 2
    const currentRetries = this.deps.questionInterruptionRetries()
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
      this.deps.setQuestionInterruptionRetries(0)
      this.deps.setCurrentQuestionText(null)
      await this.stateMachine.transition('follow_up_asked')
      this.stateMachine.startSilenceTimer(40000)
    } else if (result.softStopped || result.interrupted) {
      const newRetries = currentRetries + 1
      this.deps.setQuestionInterruptionRetries(newRetries)
      if (newRetries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.speakFollowUpQuestion(followUp)
      } else {
        this.deps.setQuestionInterruptionRetries(0)
        await this.speakFollowUpQuestion(followUp)
      }
    }
  }

  async submitCodingSolutionWithBusinessLogic(
    code: string,
    isTimeout: boolean = false,
    timeComplexity?: string,
    spaceComplexity?: string
  ): Promise<{ success: boolean, feedback: string, hasNextProblem: boolean }> {
    const session = this.deps.getCurrentSession()
    if (!session) {
      throw new Error('No active interview session')
    }

    const currentState = this.stateMachine.getState()
    const problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      throw new Error('No current coding problem')
    }

    const codingProblems = session.codingProblems || []
    const result = await this.submitCodingSolution(
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
      this.deps.syncConversationHistoryFromServices()

      const problemConversationHistory = this.deps.getProblemConversationHistory(problem.id)
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
      const conversations = this.deps.getCodingProblemConversations()
      conversations.push(problemConversation)
      this.deps.setCodingProblemConversations(conversations)

      const nextProblem = codingProblems[currentProblemIndex + 1]
      this.deps.setCurrentProblemId(nextProblem.id)
      this.deps.setCurrentProblem(nextProblem)
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

    this.stateMachine.clearSilenceTimer()
    const existingIndex = this.deps.getCodingProblemConversations().findIndex(
      c => c.problemId === problem.id
    )

    if (existingIndex !== -1) {
      this.deps.syncConversationHistoryFromServices()
      const finalSubmission = this.codeAnalysis.getFinalSubmission()
      const problemConversationHistory = this.deps.getProblemConversationHistory(problem.id)

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

      const conversations = this.deps.getCodingProblemConversations()
      conversations[existingIndex] = {
        ...conversations[existingIndex],
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
      this.deps.setCodingProblemConversations(conversations)
    } else {
      this.deps.syncConversationHistoryFromServices()
      const problemConversationHistory = this.deps.getProblemConversationHistory(problem.id)
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
      const conversations = this.deps.getCodingProblemConversations()
      conversations.push(problemConversation)
      this.deps.setCodingProblemConversations(conversations)
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
  }

  async startInterview(session: InterviewSession & { resumeFromIndex?: number; skipIntro?: boolean }): Promise<void> {
    this.deps.setFullConversationHistory([])
    this.deps.setCodingProblemConversations([])
    this.deps.setCurrentProblemId(null)
    this.deps.setCurrentQuestionId(null)

    const sessionWithStartTime: InterviewSession = {
      ...session,
      startTime: session.startTime || new Date(),
      status: session.status || 'in_progress'
    }

    this.deps.setQuestions(session.questions)
    this.stateMachine.setQuestions(session.questions, session.maxTheoreticalQuestions || 10)
    this.deps.setMaxTheoreticalQuestions(session.maxTheoreticalQuestions || 10)

    if (typeof session.resumeFromIndex === 'number') {
      const idx = Math.max(0, Math.min(session.resumeFromIndex, session.questions.length - 1))
      this.deps.setCurrentQuestionIndex(idx)
    }

    if (this.deps.livekitAgentStart) {
      const roomName = `interview-${session.id}`
      try {
        await this.deps.livekitAgentStart(roomName, 'interview-agent')
      } catch (error) {
      }
    }

    const hasTheoreticalQuestions = session.questions && session.questions.length > 0
    const hasCodingProblems = session.codingProblems && session.codingProblems.length > 0

    this.deps.setHadTheoreticalQuestions(hasTheoreticalQuestions)

    if (session.skipIntro) {
      if (hasTheoreticalQuestions) {
        await this.stateMachine.transition('begin_questions')
      } else if (hasCodingProblems) {
        if (session.codingProblems && session.codingProblems.length > 0) {
          await this.stateMachine.setState(InterviewState.CODING_INTRO)
        }
      }
    } else {
      if (hasTheoreticalQuestions) {
        await this.stateMachine.transition('start_interview')
      } else if (hasCodingProblems) {
        if (session.codingProblems && session.codingProblems.length > 0) {
          await this.stateMachine.setState(InterviewState.CODING_INTRO)
        }
      } else {
        throw new Error('No questions or coding problems provided')
      }
    }
  }

  syncConversationHistoryFromServices(): void {
    const llmHistory = this.llm.getConversationHistory()
    const fullHistory = this.deps.getFullConversationHistory()

    llmHistory.forEach(msg => {
      const exists = fullHistory.some(
        existing => existing.timestamp === msg.timestamp &&
                   existing.content === msg.content &&
                   existing.role === msg.role
      )
      if (!exists) {
        const updated = [...fullHistory, msg]
        this.deps.setFullConversationHistory(updated)
        if (msg.metadata.questionId) {
          this.deps.setCurrentQuestionId(msg.metadata.questionId)
        }
      }
    })

    const codeAnalysisHistory = this.codeAnalysis.getConversationHistory()
    const currentProblemInCodeAnalysis = this.codeAnalysis.getCurrentProblem()
    const finalSubmission = this.codeAnalysis.getFinalSubmission()
    let currentHistory = this.deps.getFullConversationHistory()

    codeAnalysisHistory.forEach(msg => {
      if (!msg.metadata.codingProblemId && currentProblemInCodeAnalysis) {
        msg.metadata.codingProblemId = currentProblemInCodeAnalysis.id
      }

      if (!msg.metadata.codingProblemId && this.deps.getCurrentProblemId()) {
        msg.metadata.codingProblemId = this.deps.getCurrentProblemId() || undefined
      }

      let existingIndex = -1
      if (msg.metadata.type === 'question' && msg.metadata.codingProblemId) {
        existingIndex = currentHistory.findIndex(
          existing => existing.metadata.type === 'question' &&
                     existing.metadata.codingProblemId === msg.metadata.codingProblemId &&
                     existing.role === msg.role
        )

        if (existingIndex === -1 && msg.content.startsWith("Let's work on:")) {
          const titleMatch = msg.content.match(/Let's work on:\s*([^\n.]+)/)
          if (titleMatch) {
            const questionTitle = titleMatch[1].trim()
            existingIndex = currentHistory.findIndex(
              existing => existing.metadata.type === 'question' &&
                         existing.role === msg.role &&
                         existing.content.startsWith("Let's work on:") &&
                         existing.content.includes(questionTitle)
            )
          }
        }
      }

      if (existingIndex === -1) {
        existingIndex = currentHistory.findIndex(
          existing => existing.timestamp === msg.timestamp &&
                     existing.content === msg.content &&
                     existing.role === msg.role
        )
      }

      if (existingIndex === -1) {
        if (msg.metadata.type === 'code_submission') {
          const metadata = msg.metadata as any
          if (!metadata.timeComplexity && finalSubmission.timeComplexity) {
            metadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!metadata.spaceComplexity && finalSubmission.spaceComplexity) {
            metadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }

        currentHistory = [...currentHistory, msg]
        this.deps.setFullConversationHistory(currentHistory)
        if (msg.metadata.codingProblemId) {
          this.deps.setCurrentProblemId(msg.metadata.codingProblemId)
        }
      } else {
        const existing = currentHistory[existingIndex]
        if (existing.metadata.type === 'code_submission' && msg.metadata.type === 'code_submission') {
          const existingMetadata = existing.metadata as any
          const newMetadata = msg.metadata as any

          if (!existingMetadata.timeComplexity && newMetadata.timeComplexity) {
            existingMetadata.timeComplexity = newMetadata.timeComplexity
          }
          if (!existingMetadata.spaceComplexity && newMetadata.spaceComplexity) {
            existingMetadata.spaceComplexity = newMetadata.spaceComplexity
          }

          if (!existingMetadata.timeComplexity && finalSubmission.timeComplexity) {
            existingMetadata.timeComplexity = finalSubmission.timeComplexity
          }
          if (!existingMetadata.spaceComplexity && finalSubmission.spaceComplexity) {
            existingMetadata.spaceComplexity = finalSubmission.spaceComplexity
          }
        }
      }
    })

    const sorted = this.deps.getFullConversationHistory().sort((a, b) => a.timestamp - b.timestamp)
    this.deps.setFullConversationHistory(sorted)
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

  async onIntroStarted(): Promise<void> {
    const introText = "Hello! Welcome to your technical interview. I'll be conducting your interview today. Lets start with some theoretical questions."
    const result = await this.speakWithPolicy(introText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    })
    if (result.completed) {
      await this.stateMachine.transition('begin_questions')
    }
  }

  async onCodingIntroStarted(): Promise<void> {
    const session = this.deps.getCurrentSession()
    if (!session) return

    const hasCodingProblems = session.codingProblems && session.codingProblems.length > 0
    if (!hasCodingProblems) {
      await this.stateMachine.transition('no_coding_problems')
      return
    }

    if (this.deps.hadTheoreticalQuestions()) {
      const introText = "Great work on the theoretical questions! Now let's move to the coding section."
      const result = await this.speakWithPolicy(introText, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })
      if (result.completed || result.softStopped) {
        await this.stateMachine.transition('coding_problem_presented')
      }
    } else {
      const introText = "Welcome! Today we'll focus on coding problems. Let's begin."
      const result = await this.speakWithPolicy(introText, {
        interruptible: false,
        bargeInPolicy: 'soft'
      })
      if (result.completed || result.softStopped) {
        await this.stateMachine.transition('coding_problem_presented')
      }
    }
  }

  async onPresentCodingProblem(): Promise<CodingProblem | null> {
    let problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      const session = this.deps.getCurrentSession()
      if (session?.codingProblems && session.codingProblems.length > 0) {
        const problemIndex = this.deps.getCurrentProblemId()
          ? session.codingProblems.findIndex(p => p.id === this.deps.getCurrentProblemId())
          : 0
        problem = session.codingProblems[problemIndex >= 0 ? problemIndex : 0]
      } else {
        problem = this.deps.getCurrentCodingProblem()
      }
    }

    if (!problem) {
      await this.stateMachine.transition('no_coding_problems')
      return null
    }

    if (this.deps.getCurrentProblemId() !== problem.id) {
      this.deps.setCurrentProblemId(problem.id)
    }

    this.stateMachine.resetCodingCounters()
    this.deps.setCurrentProblem(problem)

    const intro = "Here's the coding problem. You can see the details on your screen. Before you start coding, please explain your approach to solving this problem. Also feel free to ask any clarifying questions if you need to understand the requirements better. While you work through it, please plan to note the time and space complexity of your final solution as well."
    await this.speakWithPolicy(intro, {
      interruptible: false,
      bargeInPolicy: 'soft'
    })

    this.deps.syncConversationHistoryFromServices()
    return problem
  }

  async interruptAutoSpeech(reason: string): Promise<void> {
    const context = this.deps.getCurrentSpeechContext()
    if (context?.priority === 'auto' && this.deps.getLivekitAgentIsSpeaking()) {
      await this.deps.stopLivekitAgent()
    }
  }

  async withManualResponse<T>(kind: any, source: string, handler: () => Promise<T>): Promise<T> {
    await this.interruptAutoSpeech(`manual ${kind} requested (${source})`)
    this.deps.startManualResponse(kind, source)
    try {
      return await handler()
    } finally {
      this.deps.finishManualResponse(kind, source)
    }
  }

  async onSkipRequested(problem: any, text: string): Promise<void> {
    const confirmed = await this.deps.requestSkipConfirmation()
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
      this.deps.syncConversationHistoryFromServices()

      await this.speakWithPolicy(skipMessage, {
        interruptible: false,
        bargeInPolicy: 'soft'
      }, { kind: 'system', priority: 'manual', source: 'skip_question' })

      const currentCode = this.deps.currentCode() || this.deps.getPreviousCode() || '// Skipped by candidate'
      const session = this.deps.getCurrentSession()
      const codingProblems = session?.codingProblems || []
      try {
        await this.deps.submitCodingSolution(currentCode, false)
      } catch (error) {
        const currentProblemIndex = codingProblems.findIndex(p => p.id === problem.id)
        const hasNextProblem = currentProblemIndex >= 0 && currentProblemIndex < codingProblems.length - 1

        if (hasNextProblem) {
          const nextProblem = codingProblems[currentProblemIndex + 1]
          this.deps.setCurrentProblem(nextProblem)
          this.deps.setCurrentProblemId(nextProblem.id)
          await this.deps.setState(InterviewState.CODING_PROBLEM)
        } else {
          await this.deps.setState(InterviewState.WRAP_UP)
        }
      }
    })
  }

  async onHintSpokenRequested(hintText: string): Promise<void> {
    const result = await this.speakWithPolicy(hintText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    }, { kind: 'hint', priority: 'auto', source: 'monitoring_auto_hint' })
    if (result.completed) {
      await this.onHintSpokenCompleted(hintText)
    }
  }

  async onClarificationSpokenRequested(clarificationText: string): Promise<void> {
    const result = await this.speakWithPolicy(clarificationText, {
      interruptible: true,
      bargeInPolicy: 'hard'
    })
    if (result.completed) {
      await this.onClarificationSpokenCompleted(clarificationText)
    }
  }

  async onSolutionSubmitted(feedback: string, hasNextProblem: boolean): Promise<void> {
    await this.speakWithPolicy(feedback, {
      interruptible: false,
      bargeInPolicy: 'soft'
    })
  }

  async onWaitingForApproach(): Promise<void> {
    this.stateMachine.startSilenceTimer(120000)
  }

  async onCodeMonitoringStarted(): Promise<void> {
    this.stateMachine.startSilenceTimer(60000)
  }

  async onAskForApproach(): Promise<void> {
    const problem = this.deps.getCurrentCodingProblem()
    if (!problem) {
      return
    }
    await this.stateMachine.transition('approach_asked')
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

  addConversationMessage(role: 'user' | 'assistant' | 'system', text: string, metadata: any): void {
    this.deps.addConversationMessageToService(role, text, metadata)
  }

  async clearSession(): Promise<void> {
    if (!this.deps.getPayloadSent() && (this.deps.getCodingProblemConversations().length > 0 || this.deps.getFullConversationHistory().length > 0)) {
      this.deps.resetStateMachine()
      this.deps.setCurrentProblemId(null)
      this.deps.setCurrentQuestionId(null)
      this.deps.resetLLM()
      await this.deps.stopLivekitAgent()
      return
    }

    this.deps.resetStateMachine()
    this.deps.setCodingProblemConversations([])
    this.deps.setAllEvaluations([])
    this.deps.setFullConversationHistory([])
    this.deps.setCurrentProblemId(null)
    this.deps.setCurrentQuestionId(null)
    this.deps.resetLLM()
    this.deps.setPayloadSent(false)
    await this.deps.stopLivekitAgent()
  }

  shouldProcessTranscriptState(state: InterviewState): boolean {
    return state === InterviewState.WAITING_FOR_ANSWER || 
           state === InterviewState.THEORETICAL_QUESTION ||
           state === InterviewState.WAITING_FOR_APPROACH || 
           state === InterviewState.MONITORING_CODE
  }
}


