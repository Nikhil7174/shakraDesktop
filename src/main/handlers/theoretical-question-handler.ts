import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from '../services/llm-service'
import { InterviewStateMachine, InterviewState } from '../services/state-machine'
import type { ConversationMessage } from '../../shared/types'
import { SpeakRequest } from '../interview-session'

export interface TheoreticalQuestionHandlerDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  syncConversationHistoryFromServices: () => void
  emit: (event: string, ...args: any[]) => boolean
  forceMoveToNextQuestion: () => Promise<void>
}

export class TheoreticalQuestionHandler extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private deps: TheoreticalQuestionHandlerDeps

  constructor(deps: TheoreticalQuestionHandlerDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.deps = deps
  }

  async handleEvaluation(evaluation: Evaluation): Promise<void> {
    const currentStateBeforeEval = this.stateMachine.getState()
    if (currentStateBeforeEval === InterviewState.WAITING_FOR_ANSWER) {
      await this.stateMachine.transition('candidate_finished_speaking')
    }

    this.stateMachine.addEvaluation(evaluation)
    this.deps.emit('evaluation', evaluation)

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
          this.deps.syncConversationHistoryFromServices()

          this.deps.emit('speakRequested', <SpeakRequest>{
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
          this.deps.syncConversationHistoryFromServices()
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
        this.deps.emit('progressUpdate', progress)
        await this.stateMachine.transition('next_question')
      }
    }
  }

  async processTranscript(text: string, state: InterviewState): Promise<void> {
    if (state === InterviewState.WAITING_FOR_ANSWER || state === InterviewState.THEORETICAL_QUESTION) {
      await this.processTheoreticalTranscript(text, state)
    }
  }

  private async processTheoreticalTranscript(text: string, state: InterviewState): Promise<void> {
    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request') {
      this.emit('hintRequested', text)
      return
    }

    if (intent.intent === 'clarification_request') {
      this.emit('clarificationRequested', text)
      return
    }

    if (intent.intent === 'skip_question') {
      this.emit('skipRequested', text)
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
        this.deps.syncConversationHistoryFromServices()

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
      this.emit('hintResponse', response)
    } else if (response.action === 'clarification' && response.text) {
      this.emit('clarificationResponse', response)
    } else if (response.action === 'skip') {
      this.emit('skipResponse', response)
    } else if (response.action === 'evaluate' && response.evaluation) {
      await this.handleEvaluation(response.evaluation)
    }
  }

  private async handleSpeakResponse(response: any, originalText: string, state: InterviewState): Promise<void> {
    this.deps.emit('speakRequested', <SpeakRequest>{
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
        this.deps.syncConversationHistoryFromServices()
      }

      this.deps.emit('speakRequested', <SpeakRequest>{
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
        this.deps.syncConversationHistoryFromServices()

        this.deps.emit('speakRequested', <SpeakRequest>{
          text: finalPrompt,
          options: { interruptible: false, bargeInPolicy: 'soft' },
          context: { kind: 'system', priority: 'auto', source: 'chit_chat_limit' }
        })

        await this.deps.forceMoveToNextQuestion()
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

  async onAskQuestion(question: Question, setQuestionId: (id: string) => void, setQuestionText: (text: string) => void): Promise<void> {
    setQuestionId(question.id)
    setQuestionText(question.question)

    this.llm.addConversationMessage('assistant', question.question, {
      type: 'question',
      questionId: question.id,
      section: 'theoretical'
    })
    this.deps.syncConversationHistoryFromServices()

    const progress = this.stateMachine.getProgress()
    this.deps.emit('progressUpdate', progress)
    this.deps.emit('questionAsked', question)
  }

  async onAskFollowUp(
    followUp: string,
    setQuestionText: (text: string) => void,
    setInterruptionRetries: (count: number) => void
  ): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (currentQuestion) {
      this.llm.addConversationMessage('assistant', followUp, {
        type: 'followup',
        questionId: currentQuestion.id,
        section: 'theoretical'
      })
      this.deps.syncConversationHistoryFromServices()
    }

    this.stateMachine.resetHintEventCount()
    this.stateMachine.resetClarificationRequestCount()
    this.stateMachine.resetHintLevel()
    this.stateMachine.resetNormalConversationCount()
    this.stateMachine.resetSilenceTimeoutCount()

    this.stateMachine.incrementFollowUpDepth()
    this.llm.incrementFollowUpDepth()

    setQuestionText(followUp)
    setInterruptionRetries(0)
    this.deps.emit('followUpAsked', followUp)
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
}

