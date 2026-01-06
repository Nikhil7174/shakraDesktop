import { EventEmitter } from 'events'
import { LLMService, Evaluation } from '../services/llm-service'
import { InterviewStateMachine, InterviewState } from '../services/state-machine'
import { CodeAnalysisService, CodingProblem } from '../services/code-analysis-service'
import { InterviewSession } from '../interview-session'
import type { ConversationMessage } from '../../shared/types'

export interface SessionManagerDeps {
  llm: LLMService
  stateMachine: InterviewStateMachine
  codeAnalysis: CodeAnalysisService
  getCurrentSession: () => any
  setCurrentSession: (session: InterviewSession) => void
  getFullConversationHistory: () => ConversationMessage[]
  setFullConversationHistory: (history: ConversationMessage[]) => void
  getCodingProblemConversations: () => any[]
  setCodingProblemConversations: (conversations: any[]) => void
  getAllEvaluations: () => Evaluation[]
  setAllEvaluations: (evaluations: Evaluation[]) => void
  getProblemConversationHistory: (problemId: string) => ConversationMessage[]
  getCurrentProblemId: () => string | null
  setCurrentProblemId: (id: string | null) => void
  setCurrentQuestionId: (id: string | null) => void
  setCurrentQuestionIndex: (index: number) => void
  setQuestions: (questions: any[]) => void
  setCodingProblems: (problems: CodingProblem[]) => void
  setMaxTheoreticalQuestions: (max: number) => void
  setHadTheoreticalQuestions: (value: boolean) => void
  livekitAgentStart: (roomName: string, agentName: string) => Promise<void>
  resetStateMachine: () => void
  resetLLM: () => void
  stopLivekitAgent: () => Promise<void>
  getPayloadSent: () => boolean
  setPayloadSent: (value: boolean) => void
  getStateMachineProgress: () => { current: number; total: number }
  getStateMachineState: () => InterviewState
  emit: (event: string, ...args: any[]) => boolean
}

export class SessionManager extends EventEmitter {
  private llm: LLMService
  private stateMachine: InterviewStateMachine
  private codeAnalysis: CodeAnalysisService
  private deps: SessionManagerDeps

  constructor(deps: SessionManagerDeps) {
    super()
    this.llm = deps.llm
    this.stateMachine = deps.stateMachine
    this.codeAnalysis = deps.codeAnalysis
    this.deps = deps
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

    this.deps.setCurrentSession(sessionWithStartTime)
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

      if (!msg.metadata.codingProblemId) {
        const currentProblemId = this.deps.getCurrentProblemId()
        if (currentProblemId) {
          msg.metadata.codingProblemId = currentProblemId
        }
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

  addConversationMessage(role: 'user' | 'assistant' | 'system', text: string, metadata: any): void {
    if (metadata.section === 'coding') {
      this.codeAnalysis.addConversationMessage(role, text, metadata)
    } else {
      this.llm.addConversationMessage(role, text, metadata)
    }
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

  async handleInterviewCompletion(): Promise<void> {
    const session = this.deps.getCurrentSession()
    if (!session) {
      return
    }

    try {
      session.endTime = new Date()
      session.status = 'completed'

      this.syncConversationHistoryFromServices()

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

      this.deps.emit('interviewCompleted', session)
    } catch (error) {
    }
  }

  getProblemConversationHistory(problemId: string): ConversationMessage[] {
    return this.deps.getFullConversationHistory().filter(
      msg => msg.metadata.codingProblemId === problemId
    )
  }

  getSessionInfo(): { sessionId: string; questionsAnswered: number; totalQuestions: number; lastActivity: string; state: string } | null {
    const session = this.deps.getCurrentSession()
    if (!session) {
      return null
    }

    const progress = this.deps.getStateMachineProgress()
    const state = this.deps.getStateMachineState()

    return {
      sessionId: (session as any).sessionId || session.id,
      questionsAnswered: progress.current - 1,
      totalQuestions: progress.total,
      lastActivity: new Date().toISOString(),
      state
    }
  }

  async onIntroStarted(transition: (event: string) => Promise<void>): Promise<void> {
    const introText = "Hello! Welcome to your technical interview. I'll be conducting your interview today. Lets start with some theoretical questions."
    this.deps.emit('introText', introText)
    await transition('begin_questions')
  }

  async onCodingIntroStarted(
    hadTheoreticalQuestions: () => boolean,
    transition: (event: string) => Promise<void>
  ): Promise<void> {
    const session = this.deps.getCurrentSession()
    if (!session) return

    const hasCodingProblems = session.codingProblems && session.codingProblems.length > 0
    if (!hasCodingProblems) {
      await this.stateMachine.transition('no_coding_problems')
      return
    }

    if (hadTheoreticalQuestions()) {
      const introText = "Great work on the theoretical questions! Now let's move to the coding section."
      this.deps.emit('codingIntroText', introText)
      await transition('coding_problem_presented')
    } else {
      const introText = "Welcome! Today we'll focus on coding problems. Let's begin."
      this.deps.emit('codingIntroText', introText)
      await transition('coding_problem_presented')
    }
  }
}

