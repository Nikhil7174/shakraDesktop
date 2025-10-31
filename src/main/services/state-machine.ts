import { EventEmitter } from 'events'
import { Question, Evaluation } from './llm-service'

export enum InterviewState {
  IDLE = 'idle',
  INTRO = 'intro',
  THEORETICAL_QUESTION = 'theoretical_question',
  WAITING_FOR_ANSWER = 'waiting_for_answer',
  EVALUATING_ANSWER = 'evaluating_answer',
  FOLLOW_UP = 'follow_up',
  HANDLING_THEORETICAL_HINT = 'handling_theoretical_hint',
  HANDLING_CLARIFICATION = 'handling_clarification',
  CODING_INTRO = 'coding_intro',
  CODING_PROBLEM = 'coding_problem',
  MONITORING_CODE = 'monitoring_code',
  PROVIDING_HINT = 'providing_hint',
  WRAP_UP = 'wrap_up',
  COMPLETED = 'completed'
}

export interface InterviewData {
  questions: Question[]
  currentQuestionIndex: number
  evaluations: Evaluation[]
  startTime?: Date
  endTime?: Date
  finalScore?: number
  followUpDepth: number
  maxTheoreticalQuestions: number
  totalTheoreticalQuestions: number
  normalConversationCount?: number
  silenceTimeoutCount?: number
  clarificationRequestCount?: number
  hintRequestCount?: number
  hintEventCount?: number
}

export interface StateTransition {
  from: InterviewState
  to: InterviewState
  event: string
  condition?: (data: any) => boolean
}

export class InterviewStateMachine extends EventEmitter {
  private state: InterviewState = InterviewState.IDLE
  private data: InterviewData
  private transitions: Map<string, StateTransition[]> = new Map()
  private silenceTimer?: NodeJS.Timeout
  private hintLevel: number = 1

  constructor() {
    super()
    this.data = {
      questions: [],
      currentQuestionIndex: 0,
      evaluations: [],
      followUpDepth: 0,
      maxTheoreticalQuestions: 10,
      totalTheoreticalQuestions: 0,
      normalConversationCount: 0,
      silenceTimeoutCount: 0,
      clarificationRequestCount: 0,
      hintRequestCount: 0,
      hintEventCount: 0
    }
    this.initializeTransitions()
  }

  private initializeTransitions() {
    // Define all possible state transitions
    const allTransitions: StateTransition[] = [
      // From IDLE
      { from: InterviewState.IDLE, to: InterviewState.INTRO, event: 'start_interview' },
      
      // From INTRO
      { from: InterviewState.INTRO, to: InterviewState.THEORETICAL_QUESTION, event: 'begin_questions' },
      
      // From THEORETICAL_QUESTION
      { from: InterviewState.THEORETICAL_QUESTION, to: InterviewState.WAITING_FOR_ANSWER, event: 'question_asked' },
      
      // From WAITING_FOR_ANSWER
      { from: InterviewState.WAITING_FOR_ANSWER, to: InterviewState.EVALUATING_ANSWER, event: 'candidate_finished_speaking' },
      { from: InterviewState.WAITING_FOR_ANSWER, to: InterviewState.HANDLING_THEORETICAL_HINT, event: 'hint_requested' },
      { from: InterviewState.WAITING_FOR_ANSWER, to: InterviewState.HANDLING_CLARIFICATION, event: 'clarification_requested' },
      
      // From EVALUATING_ANSWER
      { from: InterviewState.EVALUATING_ANSWER, to: InterviewState.FOLLOW_UP, event: 'needs_follow_up' },
      { from: InterviewState.EVALUATING_ANSWER, to: InterviewState.THEORETICAL_QUESTION, event: 'next_question' },
      { from: InterviewState.EVALUATING_ANSWER, to: InterviewState.CODING_INTRO, event: 'all_questions_done' },
      
      // From FOLLOW_UP
      { from: InterviewState.FOLLOW_UP, to: InterviewState.WAITING_FOR_ANSWER, event: 'follow_up_asked' },
      
      // From HANDLING_THEORETICAL_HINT
      { from: InterviewState.HANDLING_THEORETICAL_HINT, to: InterviewState.WAITING_FOR_ANSWER, event: 'hint_provided' },
      
      // From HANDLING_CLARIFICATION
      { from: InterviewState.HANDLING_CLARIFICATION, to: InterviewState.WAITING_FOR_ANSWER, event: 'clarification_provided' },
      
      // From CODING_INTRO
      { from: InterviewState.CODING_INTRO, to: InterviewState.CODING_PROBLEM, event: 'coding_problem_presented' },
      { from: InterviewState.CODING_INTRO, to: InterviewState.WRAP_UP, event: 'no_coding_problems' },
      
      // From CODING_PROBLEM
      { from: InterviewState.CODING_PROBLEM, to: InterviewState.MONITORING_CODE, event: 'start_monitoring' },
      
      // From MONITORING_CODE
      { from: InterviewState.MONITORING_CODE, to: InterviewState.PROVIDING_HINT, event: 'provide_hint' },
      { from: InterviewState.MONITORING_CODE, to: InterviewState.WRAP_UP, event: 'solution_complete' },
      
      // From PROVIDING_HINT
      { from: InterviewState.PROVIDING_HINT, to: InterviewState.MONITORING_CODE, event: 'hint_provided' },
      
      // From WRAP_UP
      { from: InterviewState.WRAP_UP, to: InterviewState.COMPLETED, event: 'interview_complete' },
      
      // From any state to IDLE (reset)
      { from: InterviewState.THEORETICAL_QUESTION, to: InterviewState.IDLE, event: 'reset' },
      { from: InterviewState.CODING_PROBLEM, to: InterviewState.IDLE, event: 'reset' },
      { from: InterviewState.COMPLETED, to: InterviewState.IDLE, event: 'reset' }
    ]

    // Group transitions by from state
    allTransitions.forEach(transition => {
      const key = transition.from
      if (!this.transitions.has(key)) {
        this.transitions.set(key, [])
      }
      this.transitions.get(key)!.push(transition)
    })
  }

  async transition(event: string, data?: any): Promise<boolean> {
    const currentTransitions = this.transitions.get(this.state) || []
    const validTransition = currentTransitions.find(t => 
      t.event === event && 
      (!t.condition || t.condition(data))
    )

    if (!validTransition) {
      console.warn(`Invalid transition: ${this.state} -> ${event}`)
      return false
    }

    const previousState = this.state
    this.state = validTransition.to

    console.log(`State transition: ${previousState} -> ${this.state} (event: ${event})`)

    // Emit state change event
    this.emit('stateChanged', {
      from: previousState,
      to: this.state,
      event,
      data
    })

    // Handle state entry
    await this.onStateEnter(this.state, data)

    return true
  }

  // Manual state setter for bypassing normal transitions (use sparingly)
  async setState(newState: InterviewState): Promise<void> {
    const previousState = this.state
    this.state = newState
    
    console.log(`Manual state change: ${previousState} -> ${this.state}`)
    
    // Emit state change event
    this.emit('stateChanged', {
      from: previousState,
      to: this.state,
      event: 'manual_transition',
      data: {}
    })
  }

  private async onStateEnter(state: InterviewState, _data?: any) {
    switch (state) {
      case InterviewState.INTRO:
        this.emit('introStarted')
        break

      case InterviewState.THEORETICAL_QUESTION:
        await this.handleTheoreticalQuestion()
        break

      case InterviewState.WAITING_FOR_ANSWER:
        this.emit('waitingForAnswer', this.getCurrentQuestion())
        break

      case InterviewState.EVALUATING_ANSWER:
        this.emit('evaluatingAnswer')
        break

      case InterviewState.FOLLOW_UP:
        await this.handleFollowUp()
        break

      case InterviewState.HANDLING_THEORETICAL_HINT:
        this.emit('handlingTheoreticalHint')
        break

      case InterviewState.HANDLING_CLARIFICATION:
        this.emit('handlingClarification')
        break

      case InterviewState.CODING_INTRO:
        this.emit('codingIntroStarted')
        break

      case InterviewState.CODING_PROBLEM:
        await this.handleCodingProblem()
        break

      case InterviewState.MONITORING_CODE:
        this.emit('codeMonitoringStarted')
        break

      case InterviewState.PROVIDING_HINT:
        await this.handleProvidingHint()
        break

      case InterviewState.WRAP_UP:
        await this.handleWrapUp()
        break

      case InterviewState.COMPLETED:
        this.emit('interviewCompleted', this.data)
        break

      case InterviewState.IDLE:
        this.reset()
        break
    }
  }

  private async handleTheoreticalQuestion() {
    const question = this.getCurrentQuestion()
    if (question) {
      // Increment total theoretical questions counter
      this.incrementTotalTheoreticalQuestions()
      // Reset hint level for new question
      this.resetHintLevel()
      // Reset chit-chat counter for new question
      this.resetNormalConversationCount()
      // Reset silence timeout counter for new question
      this.resetSilenceTimeoutCount()
      // Reset clarification request counter for new question
      this.resetClarificationRequestCount()
      // Reset hint request counter for new question
      this.resetHintRequestCount()
      // Reset combined hint event counter for new question
      this.resetHintEventCount()
      this.emit('askQuestion', question)
    } else {
      // No more questions, transition to coding
      await this.transition('all_questions_done')
    }
  }

  private async handleFollowUp() {
    const currentEvaluation = this.getCurrentEvaluation()
    if (currentEvaluation?.followUpQuestion) {
      this.emit('askFollowUp', currentEvaluation.followUpQuestion)
    }
  }

  private async handleCodingProblem() {
    this.emit('presentCodingProblem')
    // Automatically start monitoring after a short delay
    setTimeout(() => {
      this.transition('start_monitoring')
    }, 2000)
  }

  private async handleProvidingHint() {
    this.emit('provideHint')
  }

  private async handleWrapUp() {
    this.data.endTime = new Date()
    this.calculateFinalScore()
    this.emit('wrapUpStarted', this.data)
  }

  // Public methods for data management
  setQuestions(questions: Question[], maxTheoreticalQuestions: number = 10): void {
    this.data.questions = questions
    this.data.currentQuestionIndex = 0
    this.data.maxTheoreticalQuestions = maxTheoreticalQuestions
    this.data.totalTheoreticalQuestions = 0
    this.data.followUpDepth = 0
  }

  addEvaluation(evaluation: Evaluation): void {
    this.data.evaluations.push(evaluation)
  }

  getCurrentQuestion(): Question | null {
    return this.data.questions[this.data.currentQuestionIndex] || null
  }

  getCurrentEvaluation(): Evaluation | null {
    return this.data.evaluations[this.data.evaluations.length - 1] || null
  }

  moveToNextQuestion(): void {
    this.data.currentQuestionIndex++
    this.resetNormalConversationCount()
    this.resetSilenceTimeoutCount()
    this.resetClarificationRequestCount()
    this.resetHintRequestCount()
    this.resetHintEventCount()
    console.log('🎯 [StateMachine] Moved to question index:', this.data.currentQuestionIndex)
  }

  // Allow resuming at a specific question index
  setCurrentQuestionIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.data.questions.length - 1))
    this.data.currentQuestionIndex = clamped
    this.resetNormalConversationCount()
    this.resetSilenceTimeoutCount()
    this.resetClarificationRequestCount()
    this.resetHintRequestCount()
    this.resetHintEventCount()
    console.log('🎯 [StateMachine] Set current question index to:', this.data.currentQuestionIndex)
  }

  getProgress(): { current: number, total: number } {
    return {
      current: this.data.currentQuestionIndex + 1,
      total: this.data.questions.length
    }
  }

  getState(): InterviewState {
    return this.state
  }

  getData(): InterviewData {
    return { ...this.data }
  }

  isInTheoreticalPhase(): boolean {
    return [
      InterviewState.THEORETICAL_QUESTION,
      InterviewState.WAITING_FOR_ANSWER,
      InterviewState.EVALUATING_ANSWER,
      InterviewState.FOLLOW_UP
    ].includes(this.state)
  }

  isInCodingPhase(): boolean {
    return [
      InterviewState.CODING_INTRO,
      InterviewState.CODING_PROBLEM,
      InterviewState.MONITORING_CODE,
      InterviewState.PROVIDING_HINT
    ].includes(this.state)
  }

  isCompleted(): boolean {
    return this.state === InterviewState.COMPLETED
  }

  private calculateFinalScore(): void {
    if (this.data.evaluations.length === 0) {
      this.data.finalScore = 0
      return
    }

    const totalScore = this.data.evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0)
    this.data.finalScore = totalScore / this.data.evaluations.length
  }

  reset(): void {
    this.state = InterviewState.IDLE
    this.data = {
      questions: [],
      currentQuestionIndex: 0,
      evaluations: [],
      followUpDepth: 0,
      maxTheoreticalQuestions: 10,
      totalTheoreticalQuestions: 0,
      normalConversationCount: 0,
      silenceTimeoutCount: 0,
      clarificationRequestCount: 0,
      hintRequestCount: 0,
      hintEventCount: 0
    }
    this.clearSilenceTimer()
    this.resetHintLevel()
    this.emit('reset')
  }

  // Utility method to check if a transition is valid
  canTransition(event: string): boolean {
    const currentTransitions = this.transitions.get(this.state) || []
    return currentTransitions.some(t => t.event === event)
  }

  // Get all possible events for current state
  getAvailableEvents(): string[] {
    const currentTransitions = this.transitions.get(this.state) || []
    return currentTransitions.map(t => t.event)
  }

  // Follow-up depth management
  incrementFollowUpDepth(): void {
    this.data.followUpDepth++
  }

  resetFollowUpDepth(): void {
    this.data.followUpDepth = 0
  }

  getFollowUpDepth(): number {
    return this.data.followUpDepth
  }

  // Total theoretical questions tracking
  incrementTotalTheoreticalQuestions(): void {
    this.data.totalTheoreticalQuestions++
  }

  getTotalTheoreticalQuestions(): number {
    return this.data.totalTheoreticalQuestions
  }

  // Check if we can ask more follow-ups
  canAskFollowUp(): boolean {
    return this.data.followUpDepth < 1 && 
           this.data.totalTheoreticalQuestions < this.data.maxTheoreticalQuestions
  }

  // Check if we've reached the theoretical questions limit
  hasReachedTheoreticalLimit(): boolean {
    return this.data.totalTheoreticalQuestions >= this.data.maxTheoreticalQuestions
  }

  // Get max theoretical questions limit
  getMaxTheoreticalQuestions(): number {
    return this.data.maxTheoreticalQuestions
  }

  // Timer management methods
  startSilenceTimer(timeoutMs: number = 40000): void {
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => {
      this.emit('silence_timeout')
    }, timeoutMs)
  }

  clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = undefined
    }
  }

  getHintLevel(): number {
    return this.hintLevel
  }

  incrementHintLevel(): void {
    this.hintLevel = Math.min(this.hintLevel + 1, 3)
  }

  resetHintLevel(): void {
    this.hintLevel = 1
  }

  // Normal conversation (chit-chat) counter per question
  incrementNormalConversationCount(): number {
    const current = (this.data.normalConversationCount || 0) + 1
    this.data.normalConversationCount = current
    return current
  }

  getNormalConversationCount(): number {
    return this.data.normalConversationCount || 0
  }

  resetNormalConversationCount(): void {
    this.data.normalConversationCount = 0
  }

  // Silence timeout count per question
  incrementSilenceTimeoutCount(): number {
    const current = (this.data.silenceTimeoutCount || 0) + 1
    this.data.silenceTimeoutCount = current
    return current
  }

  getSilenceTimeoutCount(): number {
    return this.data.silenceTimeoutCount || 0
  }

  resetSilenceTimeoutCount(): void {
    this.data.silenceTimeoutCount = 0
  }

  // Clarification request count per question
  incrementClarificationRequestCount(): number {
    const current = (this.data.clarificationRequestCount || 0) + 1
    this.data.clarificationRequestCount = current
    return current
  }

  getClarificationRequestCount(): number {
    return this.data.clarificationRequestCount || 0
  }

  resetClarificationRequestCount(): void {
    this.data.clarificationRequestCount = 0
  }

  // Hint request count per question
  incrementHintRequestCount(): number {
    const current = (this.data.hintRequestCount || 0) + 1
    this.data.hintRequestCount = current
    return current
  }

  getHintRequestCount(): number {
    return this.data.hintRequestCount || 0
  }

  resetHintRequestCount(): void {
    this.data.hintRequestCount = 0
  }

  // Shared hint event count (silence timeout or verbal hint)
  incrementHintEventCount(): number {
    const current = (this.data.hintEventCount || 0) + 1
    this.data.hintEventCount = current
    return current
  }

  getHintEventCount(): number {
    return this.data.hintEventCount || 0
  }

  resetHintEventCount(): void {
    this.data.hintEventCount = 0
  }
}

