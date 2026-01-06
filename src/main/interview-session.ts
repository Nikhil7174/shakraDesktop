import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService, CodingProblem } from './services/code-analysis-service'
import type { ConversationMessage } from '../shared/types'

export type BargeInPolicy = 'hard' | 'soft'

export interface SpeakOptions {
  interruptible: boolean
  bargeInPolicy: BargeInPolicy
}

export type SpeechContext =
  | { kind: 'prompt'; priority: 'auto' | 'manual'; source: 'theoretical_question' | 'follow_up' }
  | { kind: 'hint'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'clarification'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'feedback'; priority: 'auto' | 'manual'; source: string }
  | { kind: 'system'; priority: 'auto' | 'manual'; source: string }

export interface SpeakRequest {
  text: string
  options: SpeakOptions
  context: SpeechContext
}

export interface InterviewSessionDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
}

export class InterviewEngine extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService

  private fullConversationHistory: ConversationMessage[] = []
  private allEvaluations: Evaluation[] = []
  private currentQuestionId: string | null = null
  private currentQuestionText: string | null = null
  private currentCode: string = ''
  private currentIntervalHasHintClarification: boolean = false
  private currentIntervalHasSubstantialSpeech: boolean = false

  constructor(deps: InterviewSessionDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
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

  private syncConversationHistoryFromServices(): void {
    try {
      const history = this.llm.getConversationHistory()
      this.fullConversationHistory = history
      this.fullConversationHistory.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
    }
  }
}


