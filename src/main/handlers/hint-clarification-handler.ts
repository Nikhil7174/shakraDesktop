import { EventEmitter } from 'events'
import { LLMService, Question, Evaluation } from '../services/llm-service'
import { InterviewStateMachine, InterviewState } from '../services/state-machine'
import { CodeAnalysisService, CodingProblem } from '../services/code-analysis-service'
import { SpeakRequest } from '../interview-session'

export interface HintClarificationHandlerDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
  syncConversationHistoryFromServices: () => void
  emit: (event: string, ...args: any[]) => boolean
  forceMoveToNextQuestion: () => Promise<void>
  getCurrentCode: () => string
  getPreviousCode: () => string
  requestSkipConfirmation: () => Promise<boolean>
  submitCodingSolution: (code: string, isTimeout: boolean) => Promise<any>
  setCurrentProblem: (problem: CodingProblem) => void
  setCurrentProblemId: (id: string | null) => void
  setState: (state: any) => Promise<void>
  getCurrentCodingProblem: () => CodingProblem | null
  getCurrentSession: () => any
  handleEvaluation: (evaluation: Evaluation) => Promise<void>
}

export class HintClarificationHandler extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: HintClarificationHandlerDeps

  constructor(deps: HintClarificationHandlerDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps
  }

  async handleTheoreticalHintRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'hint',
      questionId: currentQuestion.id,
      section: 'theoretical'
    })
    this.deps.syncConversationHistoryFromServices()

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
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('hintSpokenRequested', hintText)
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
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
        text: answerContext,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'hint_escalation' }
      })

      await this.deps.forceMoveToNextQuestion()
    }
  }

  async handleTheoreticalClarificationRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'clarification',
      questionId: currentQuestion.id,
      section: 'theoretical'
    })
    this.deps.syncConversationHistoryFromServices()

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
        this.deps.syncConversationHistoryFromServices()

        this.deps.emit('clarificationSpokenRequested', response.text)
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
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
        text: finalPrompt,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'clarification_escalation' }
      })

      await this.deps.forceMoveToNextQuestion()
    }
  }

  async handleTheoreticalSkipRequest(text: string): Promise<void> {
    const currentQuestion = this.llm.getCurrentQuestion()
    if (!currentQuestion) {
      return
    }

    this.llm.addConversationMessage('user', text, {
      type: 'skip',
      questionId: currentQuestion.id,
      section: 'theoretical'
    } as any)
    this.deps.syncConversationHistoryFromServices()

    const response = await this.llm.handleSkipQuestion()
    await this.handleTheoreticalSkipResponse(response)
  }

  async handleTheoreticalSkipResponse(response: any): Promise<void> {
    if (response.text) {
      this.deps.emit('speakRequested', <SpeakRequest>{
        text: response.text,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'system', priority: 'auto', source: 'skip_question' }
      })
    }

    if (response.evaluation) {
      await this.deps.handleEvaluation(response.evaluation)
    } else {
      this.deps.emit('skipEvaluation', response)
    }
  }

  async handleApproachHintRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canProvideCodingHint()) {
      const limitMessage = "I've provided the maximum number of hints. Please continue with your approach."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
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
    this.deps.syncConversationHistoryFromServices()

    this.deps.emit('hintSpokenRequested', hint)
    this.stateMachine.startSilenceTimer(120000)
    await this.stateMachine.transition('approach_needs_retry')
  }

  async handleApproachClarificationRequest(text: string, problem: CodingProblem, currentCode: string): Promise<void> {
    if (!this.stateMachine.canAskCodingClarification()) {
      const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
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
    this.deps.syncConversationHistoryFromServices()

    this.deps.emit('clarificationSpokenRequested', clarification)
    this.stateMachine.startSilenceTimer(120000)
    await this.stateMachine.transition('approach_needs_retry')
  }

  async handleMonitoringHintRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canProvideCodingHint()) {
      const limitMessage = "I've provided the maximum number of hints. Please continue with your implementation."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
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
    const currentCode = this.deps.getCurrentCode() || this.deps.getPreviousCode() || ''
    const hintText = await this.codeAnalysis.getHint(problem, currentCode, hintLevel)
    this.codeAnalysis.addHint(hintText, hintLevel)
    this.deps.syncConversationHistoryFromServices()

    this.deps.emit('hintSpokenRequested', hintText)
    this.stateMachine.startSilenceTimer(120000)
  }

  async handleMonitoringClarificationRequest(text: string, problem: CodingProblem): Promise<void> {
    if (!this.stateMachine.canAskCodingClarification()) {
      const limitMessage = "I've provided the maximum number of clarifications. Please proceed with the information you have."
      this.codeAnalysis.addConversationMessage('assistant', limitMessage, {
        type: 'feedback',
        codingProblemId: problem.id,
        section: 'coding'
      } as any)
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('speakRequested', <SpeakRequest>{
        text: limitMessage,
        options: { interruptible: false, bargeInPolicy: 'soft' },
        context: { kind: 'clarification', priority: 'manual', source: 'coding_manual_clarification_limit' }
      })
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    this.stateMachine.incrementCodingClarificationCount()
    this.codeAnalysis.addClarificationRequest(text)

    const currentCode = this.deps.getPreviousCode() || ''
    const clarification = await this.llm.generateCodingClarification(
      problem,
      text,
      this.stateMachine.getCodingClarificationCount(),
      currentCode
    )

    this.codeAnalysis.addClarification(clarification)
    this.deps.syncConversationHistoryFromServices()

    this.deps.emit('clarificationSpokenRequested', clarification)
    this.stateMachine.startSilenceTimer(120000)
  }

  async handleHintProvision(
    shouldSkipAutoResponse: (trigger: string) => boolean,
    setAutoHintInProgress: (value: boolean) => void
  ): Promise<void> {
    setAutoHintInProgress(true)
    try {
      const last = this.codeAnalysis.getObservations().slice(-1)[0]
      const session = this.deps.getCurrentSession()
      const problem = this.codeAnalysis.getCurrentProblem() || (session?.codingProblems?.[0] ?? null)
      if (last && problem && last.analysis.isStuck) {
        if (shouldSkipAutoResponse('analysis_observation_hint')) {
          return
        }
        const currentCode = this.deps.getCurrentCode() || last.code || ''
        const hintText = await this.codeAnalysis.getHint(problem, currentCode, 1)
        this.codeAnalysis.addConversationMessage('assistant', hintText, {
          type: 'hint',
          hintLevel: 1,
          isAutomatic: true,
          source: 'stuck_detection'
        } as any)
        this.deps.syncConversationHistoryFromServices()

        this.deps.emit('speakRequested', hintText, {
          interruptible: true,
          bargeInPolicy: 'hard'
        }, { kind: 'hint', priority: 'auto', source: 'analysis_observation_hint' })
      }
    } finally {
      setAutoHintInProgress(false)
    }
  }

  async onHintSpokenCompleted(hintText: string): Promise<void> {
    await this.stateMachine.transition('hint_provided')
    this.deps.emit('hintProvided', hintText)
    this.stateMachine.incrementHintLevel()
    this.stateMachine.startSilenceTimer(40000)
  }

  async onClarificationSpokenCompleted(clarificationText: string): Promise<void> {
    await this.stateMachine.transition('clarification_provided')
    this.stateMachine.startSilenceTimer(40000)
  }

  async onSkipRequested(problem: any, text: string, speakWithPolicy: (text: string, opts: any, context: any) => Promise<any>): Promise<void> {
    const confirmed = await this.deps.requestSkipConfirmation()
    if (!confirmed) {
      return
    }

    const skipMessage = "Understood. Let's move on to the next problem."
    this.codeAnalysis.addConversationMessage('assistant', skipMessage, {
      type: 'feedback',
      codingProblemId: problem.id,
      section: 'coding'
    } as any)
    this.deps.syncConversationHistoryFromServices()

    await speakWithPolicy(skipMessage, {
      interruptible: false,
      bargeInPolicy: 'soft'
    }, { kind: 'system', priority: 'manual', source: 'skip_question' })

    const currentCode = this.deps.getCurrentCode() || this.deps.getPreviousCode() || '// Skipped by candidate'
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
  }
}

