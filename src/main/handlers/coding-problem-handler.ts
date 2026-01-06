import { EventEmitter } from 'events'
import { LLMService } from '../services/llm-service'
import { InterviewStateMachine, InterviewState } from '../services/state-machine'
import { CodeAnalysisService, CodingProblem } from '../services/code-analysis-service'
import { SpeakRequest } from '../interview-session'

export interface CodingProblemHandlerDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
  getCurrentCodingProblem: () => CodingProblem | null
  getCurrentCode: () => string
  setCurrentCode: (code: string) => void
  syncConversationHistoryFromServices: () => void
  emit: (event: string, ...args: any[]) => boolean
  getCurrentSession: () => any
  getCodingProblemConversations: () => any[]
  getProblemConversationHistory: (problemId: string) => any[]
  setCodingProblemConversations: (conversations: any[]) => void
  setCurrentProblemId: (id: string | null) => void
  setCurrentProblem: (problem: CodingProblem) => void
  getCurrentProblemId: () => string | null
  setState: (state: InterviewState) => Promise<void>
  submitCodingSolution: (code: string, isTimeout: boolean) => Promise<any>
  getPreviousCode: () => string
  forceMoveToNextQuestion: () => Promise<void>
  currentIntervalHasHintClarification: () => boolean
  setCurrentIntervalHasHintClarification: (value: boolean) => void
  currentIntervalHasSubstantialSpeech: () => boolean
  setCurrentIntervalHasSubstantialSpeech: (value: boolean) => void
  resetIntervalTracking: () => void
}

export class CodingProblemHandler extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: CodingProblemHandlerDeps

  constructor(deps: CodingProblemHandlerDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps
  }

  async processTranscript(text: string, state: InterviewState): Promise<void> {
    if (state === InterviewState.WAITING_FOR_APPROACH) {
      await this.processApproachTranscript(text)
    } else if (state === InterviewState.MONITORING_CODE) {
      await this.processMonitoringTranscript(text)
    }
  }

  private async processApproachTranscript(text: string): Promise<void> {
    const problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      return
    }

    const currentCode = this.deps.getCurrentCode() || this.deps.getPreviousCode() || ''
    const isWritingCode = currentCode && currentCode.trim().length > 0

    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request') {
      this.emit('approachHintRequested', { text, problem })
      return
    }

    if (intent.intent === 'clarification_request') {
      this.emit('approachClarificationRequested', { text, problem, currentCode })
      return
    }

    if (intent.intent === 'skip_question') {
      this.deps.emit('skipRequested', { problem, text })
      return
    }

    await this.stateMachine.transition('approach_provided')
    this.codeAnalysis.addVerbalExplanation(text)
    this.deps.syncConversationHistoryFromServices()

    const isFirstApproach = !this.stateMachine.hasCodingApproachSpoken()
    const response = await this.codeAnalysis.evaluateApproach(text, problem, currentCode, isFirstApproach)

    const textLength = text.trim().length
    const isShortText = textLength < 80

    if (isWritingCode) {
      if (response.isClarification) {
        this.codeAnalysis.addClarificationRequest(text)
        const clarification = response.clarification || response.feedback || "Let me clarify that for you."
        this.codeAnalysis.addClarification(clarification)
        this.deps.syncConversationHistoryFromServices()

        this.deps.emit('speakRequested', <SpeakRequest>{
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
        this.deps.emit('speakRequested', <SpeakRequest>{
          text: feedback,
          options: { interruptible: true, bargeInPolicy: 'hard' },
          context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
        })
        await this.stateMachine.transition('approach_approved')
      } else if (response.isApproach && !response.isCorrect) {
        const feedback = response.feedback || "I see. Keep working on your solution."
        this.deps.emit('speakRequested', <SpeakRequest>{
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
        this.deps.syncConversationHistoryFromServices()

        this.deps.emit('speakRequested', <SpeakRequest>{
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
          this.deps.emit('speakRequested', <SpeakRequest>{
            text: feedback,
            options: { interruptible: false, bargeInPolicy: 'soft' },
            context: { kind: 'feedback', priority: 'auto', source: 'approach_feedback' }
          })
          await this.stateMachine.transition('approach_approved')
        } else {
          const feedback = response.feedback || "That's an interesting approach. Let's proceed with the implementation and see how it goes."
          this.deps.emit('speakRequested', <SpeakRequest>{
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
          this.deps.syncConversationHistoryFromServices()

          this.deps.emit('speakRequested', <SpeakRequest>{
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

  private async processMonitoringTranscript(text: string): Promise<void> {
    const problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      return
    }

    const intent = await this.llm.detectIntent(text)

    if (intent.intent === 'hint_request' || intent.intent === 'clarification_request') {
      this.deps.setCurrentIntervalHasHintClarification(true)
    }

    const transcriptLength = text.trim().length
    if (transcriptLength > 70) {
      this.deps.setCurrentIntervalHasSubstantialSpeech(true)
    }

    if (intent.intent === 'hint_request') {
      this.emit('monitoringHintRequested', { text, problem })
      return
    }

    if (intent.intent === 'clarification_request') {
      this.emit('monitoringClarificationRequested', { text, problem })
      return
    }

    if (intent.intent === 'skip_question') {
      this.deps.emit('skipRequested', { problem, text })
      return
    }

    const trimmed = text.trim()
    if (trimmed.length < 80) {
      this.codeAnalysis.addConversationMessage('user', text, {
        type: 'answer',
        codingProblemId: problem.id,
        section: 'coding'
      })
      this.deps.syncConversationHistoryFromServices()
      this.stateMachine.startSilenceTimer(120000)
      return
    }

    this.codeAnalysis.addConversationMessage('user', text, {
      type: 'answer',
      codingProblemId: problem.id,
      section: 'coding'
    })
    this.deps.syncConversationHistoryFromServices()

    const acknowledgement = "I understand. Keep working on your solution."
    this.deps.emit('speakRequested', <SpeakRequest>{
      text: acknowledgement,
      options: { interruptible: true, bargeInPolicy: 'hard' },
      context: { kind: 'system', priority: 'auto', source: 'monitoring_acknowledgement' }
    })
    this.stateMachine.startSilenceTimer(120000)
  }

  async analyzeCode(codeData: { code: string, problemId: string, timestamp: number }, problem: CodingProblem | null): Promise<any> {
    if (!problem) {
      throw new Error('No coding problem context')
    }

    this.deps.setCurrentCode(codeData.code)
    const analysis = await this.codeAnalysis.analyzeCode(codeData.code || '', problem)

    const currentState = this.stateMachine.getState()
    const isMonitoringCode = currentState === InterviewState.MONITORING_CODE

    if (!isMonitoringCode) {
      return analysis
    }

    const shouldProvideHint = analysis.isStuck && 
      !this.deps.currentIntervalHasHintClarification() && 
      !this.deps.currentIntervalHasSubstantialSpeech()

    this.deps.setCurrentIntervalHasHintClarification(false)
    this.deps.setCurrentIntervalHasSubstantialSpeech(false)

    if (shouldProvideHint) {
      if (!this.stateMachine.canProvideCodingHint()) {
        return analysis
      }

      const hintNumber = this.stateMachine.incrementCodingHintCount()
      const hintLevel = Math.min(hintNumber, 2) as 1 | 2
      const hintText = await this.codeAnalysis.getHint(problem, codeData.code, hintLevel)
      this.codeAnalysis.addHint(hintText, hintLevel)
      this.deps.syncConversationHistoryFromServices()

      this.deps.emit('hintSpokenRequested', hintText)
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
    this.deps.syncConversationHistoryFromServices()

    const analysis = await this.codeAnalysis.analyzeCode(code, problem)
    this.deps.syncConversationHistoryFromServices()

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

    this.deps.emit('solutionSubmitted', {
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
        await this.deps.setState(InterviewState.IDLE)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      await this.deps.setState(targetState)

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
      await this.deps.setState(InterviewState.MONITORING_CODE)
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const transitionResult = await this.stateMachine.transition('solution_complete')
    if (!transitionResult) {
      await this.deps.setState(InterviewState.WRAP_UP)
    }

    return {
      success: result.success,
      feedback: result.feedback,
      hasNextProblem: false
    }
  }

  async onPresentCodingProblem(
    getCurrentProblemId: () => string | null,
    setCurrentProblemId: (id: string | null) => void,
    setCurrentProblem: (problem: CodingProblem) => void
  ): Promise<CodingProblem | null> {
    let problem = this.codeAnalysis.getCurrentProblem()
    if (!problem) {
      const session = this.deps.getCurrentSession()
      if (session?.codingProblems && session.codingProblems.length > 0) {
        const problemIndex = getCurrentProblemId()
          ? session.codingProblems.findIndex(p => p.id === getCurrentProblemId())
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

    if (getCurrentProblemId() !== problem.id) {
      setCurrentProblemId(problem.id)
    }

    this.stateMachine.resetCodingCounters()
    setCurrentProblem(problem)

    const intro = "Here's the coding problem. You can see the details on your screen. Before you start coding, please explain your approach to solving this problem. Also feel free to ask any clarifying questions if you need to understand the requirements better. While you work through it, please plan to note the time and space complexity of your final solution as well."
    this.deps.emit('speakRequested', <SpeakRequest>{
      text: intro,
      options: { interruptible: false, bargeInPolicy: 'soft' },
      context: { kind: 'system', priority: 'auto', source: 'coding_problem_intro' }
    })

    this.deps.syncConversationHistoryFromServices()
    return problem
  }

  async onAskForApproach(): Promise<void> {
    const problem = this.deps.getCurrentCodingProblem()
    if (!problem) {
      return
    }
    await this.stateMachine.transition('approach_asked')
  }

  async onWaitingForApproach(): Promise<void> {
    this.stateMachine.startSilenceTimer(120000)
  }

  async onCodeMonitoringStarted(): Promise<void> {
    this.stateMachine.startSilenceTimer(60000)
  }
}

