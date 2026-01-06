import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from './services/llm-service'
import { InterviewStateMachine, InterviewState } from './services/state-machine'
import { CodeAnalysisService } from './services/code-analysis-service'
import type { ConversationMessage } from '../shared/types'

export type BargeInPolicy = 'hard' | 'soft'

export interface SpeakOptions {
  interruptible: boolean
  bargeInPolicy: BargeInPolicy
}

export type SpeechContext =
  | { kind: 'prompt'; priority: 'auto' | 'manual'; source: 'theoretical_question' | 'follow_up' }
  | { kind: 'hint'; priority: 'auto' | 'manual'; source: string }
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

  private syncConversationHistoryFromServices(): void {
    try {
      const history = this.llm.getConversationHistory()
      this.fullConversationHistory = history
      this.fullConversationHistory.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
    }
  }
}


