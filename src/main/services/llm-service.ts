import { EventEmitter } from 'events'
import axios from 'axios'
import http from 'http'
import https from 'https'
import { ConversationMessage } from '../../shared/types'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Question {
  id: string
  question: string
  expectedAnswer: string
  keyPoints: string[]
  followUps?: FollowUp[]
}

export interface FollowUp {
  trigger: string | string[]
  question: string
  expectedAnswer: string
  keyPoints: string[]
}

export interface Evaluation {
  questionId: string
  candidateAnswer: string
  keyPointsCovered: string[]
  score: number
  needsFollowUp: boolean
  followUpQuestion?: string
  feedback: string
}

export interface IntentDetection {
  intent: 'answer' | 'hint_request' | 'clarification_request' | 'skip_question'
  confidence: number
}

export interface CodeAnalysis {
  progress: number // 0-100
  approach: 'correct' | 'incorrect' | 'incomplete' | 'unsure'
  isStuck: boolean
  issues: string[]
  suggestedHint?: string
  hintLevel: 1 | 2 // Escalating hints: 1=data structure, 2=algorithm
  codeQuality: 'good' | 'fair' | 'poor'
  testable: boolean
}

export interface LLMResponse {
  text?: string
  action: 'speak' | 'evaluate' | 'transition' | 'hint' | 'clarification' | 'skip'
  evaluation?: Evaluation
  isAskingHint?: boolean
  isAskingClarifyingQuestion?: boolean
  functionCall?: {
    name: string
    arguments: any
  }
}

// Create reusable HTTP/HTTPS agents for connection pooling
// Keep connection alive for entire interview (set high, but server will close idle connections anyway)
// Note: This doesn't increase costs - keep-alive connections are free and actually save resources
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 7200000,  // 2 hours (high value, but servers close idle connections ~60-120s anyway)
  maxSockets: 10,          // Max concurrent connections per host
  maxFreeSockets: 2       // Max idle connections to keep
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 7200000,  // 2 hours (high value, but servers close idle connections ~60-120s anyway)
  maxSockets: 10,
  maxFreeSockets: 2
})

// Create shared axios instance with connection reuse
const axiosInstance = axios.create({
  httpAgent: httpAgent,
  httpsAgent: httpsAgent,
  timeout: 30000  // 30s timeout
})

export class LLMService extends EventEmitter {
  private serverUrl: string
  private axios: typeof axiosInstance  // Use shared instance with connection reuse
  private conversationHistory: ConversationMessage[] = []
  private currentQuestion: Question | null = null
  private currentQuestionIndex: number = 0
  private questions: Question[] = []
  private followUpDepth: number = 0
  private maxTheoreticalQuestions: number = 10
  private currentFollowUpQuestion: string | null = null // Track the current follow-up question text
  private hintLevel: 1 | 2 = 1 // Track current hint level

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
    this.axios = axiosInstance  // Use shared instance with connection reuse
  }

  // Helper method to add messages with metadata
  // Public method to add conversation messages (used by orchestrator for follow-ups, etc.)
  addConversationMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata: ConversationMessage['metadata']
  ): void {
    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
      metadata
    }
    this.conversationHistory.push(message)
    // Log occasionally to track conversation history growth
    if (this.conversationHistory.length % 10 === 0 || this.conversationHistory.length <= 5) {
      console.log(`💬 [LLM] Conversation history: ${this.conversationHistory.length} messages. Latest: ${role} - ${content.substring(0, 50)}...`)
    }
  }

  async processTranscript(text: string, detectedIntent?: IntentDetection): Promise<LLMResponse> {
    // Add user message to conversation history
    // Determine message type based on intent or context
    const messageType = detectedIntent?.intent === 'hint_request' ? 'hint' :
                        detectedIntent?.intent === 'clarification_request' ? 'clarification' :
                        detectedIntent?.intent === 'skip_question' ? 'skip_question' :
                        'answer'
    
    this.addConversationMessage('user', text, {
      type: messageType,
      questionId: this.currentQuestion?.id,
      section: 'theoretical'
    })

    try {
      // Use provided intent or detect it
      let intent: IntentDetection
      if (detectedIntent) {
        console.log('🔍 [LLM] Using pre-detected intent:', detectedIntent.intent, '(skipping duplicate detection)')
        intent = detectedIntent
      } else {
        console.log('🔍 [LLM] No intent provided, detecting...')
        intent = await this.detectIntent(text)
      }
      
      if (intent.intent === 'hint_request') {
        return await this.handleHintRequest()
      } else if (intent.intent === 'clarification_request') {
        return await this.handleClarificationRequest()
      } else if (intent.intent === 'skip_question') {
        return await this.handleSkipQuestion()
      } else if (intent.intent === 'answer') {
        // This is an answer - always evaluate it if we have a current question
        // The LLM evaluation endpoint will handle incomplete/partial answers appropriately
        if (this.currentQuestion) {
          return await this.evaluateAnswer(text, this.followUpDepth, this.maxTheoreticalQuestions)
        }
      }

      // Fallback to regular conversation
      // Convert ConversationMessage[] to Message[] for API compatibility
      const apiConversationHistory: Message[] = this.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
      
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-response`, {
        context: this.buildContext(),
        conversationHistory: apiConversationHistory
      })

      if (response.data.success) {
        const assistantMessage = response.data.response
        
        this.addConversationMessage('assistant', assistantMessage, {
          type: 'feedback',
          questionId: this.currentQuestion?.id,
          section: 'theoretical'
        })

        return {
          text: assistantMessage,
          action: 'speak'
        }
      } else {
        throw new Error(response.data.error || 'Server error')
      }

    } catch (error) {
      console.error('LLM processing error:', error)
      throw error
    }
  }

  private buildContext(): string {
    if (!this.currentQuestion) {
      return 'Conducting a technical interview. Be conversational, supportive, and professional.'
    }

    return `Conducting a technical interview.
Current Question: ${this.currentQuestion.question}
Expected Answer Key Points: ${this.currentQuestion.keyPoints.join(', ')}
Expected Answer: ${this.currentQuestion.expectedAnswer}`
  }

  private async evaluateAnswer(candidateAnswer: string, followUpDepth: number = 0, maxTheoreticalQuestions: number = 10): Promise<LLMResponse> {
    console.log('🔍 [LLM-Main] evaluateAnswer called with:', {
      questionId: this.currentQuestion?.id,
      followUpDepth,
      candidateAnswerLength: candidateAnswer.length
    })
    
    if (!this.currentQuestion) {
      return {
        text: "I don't have a current question to evaluate.",
        action: 'speak'
      }
    }

    try {
      console.log('🔍 [LLM-Main] Calling evaluate-answer API')
      const response = await this.axios.post(`${this.serverUrl}/api/llm/evaluate-answer`, {
        question: this.currentQuestion,
        candidateAnswer,
        followUpDepth,
        maxTheoreticalQuestions
      })

      if (response.data.success) {
        const evaluation = response.data.evaluation
        
        // Emit evaluation event
        this.emit('evaluation', evaluation)

        // Handle the 3 cases based on intent detection
        if (evaluation.isAskingHint && evaluation.isHintResponse) {
          this.addConversationMessage('assistant', evaluation.feedback, {
            type: 'hint',
            questionId: this.currentQuestion?.id,
            hintLevel: this.hintLevel,
            section: 'theoretical'
          })

          return {
            text: evaluation.feedback,
            action: 'hint',
            evaluation
          }
        }

        if (evaluation.isAskingClarifyingQuestion && evaluation.isClarificationResponse) {
          this.addConversationMessage('assistant', evaluation.feedback, {
            type: 'clarification',
            questionId: this.currentQuestion?.id,
            section: 'theoretical'
          })

          return {
            text: evaluation.feedback,
            action: 'clarification',
            evaluation
          }
        }

        if (evaluation.isAnsweringQuestion) {
          // This is a normal answer evaluation - proceed with normal flow
        }

        // Handle normal evaluation responses
        let responseText = ''
        if (evaluation.needsFollowUp) {
          // Don't add the follow-up question here - it will be added when askFollowUp event fires
          // Just provide a transition message
          responseText = "Let me ask a follow-up question about that."
          // Store the follow-up question for hint generation
          this.currentFollowUpQuestion = evaluation.followUpQuestion || null
          console.log('🎯 [LLM] Follow-up question stored for hints:', this.currentFollowUpQuestion?.substring(0, 50))
        } else {
          responseText = this.generatePositiveResponse(evaluation.score)
        }

        // Don't record feedback here - it will be recorded in handleEvaluation before speaking
        // This ensures we record evaluation.feedback (what will be spoken) instead of responseText

        return {
          text: responseText,
          action: 'evaluate',
          evaluation
        }
      } else {
        throw new Error(response.data.error || 'Evaluation failed')
      }
    } catch (error) {
      console.error('Error evaluating answer:', error)
      return {
        text: "I encountered an issue evaluating your answer. Let's continue.",
        action: 'speak'
      }
    }
  }

  async analyzeCode(code: string, problem: string, language: string = 'javascript'): Promise<CodeAnalysis> {
    try {
      const response = await this.axios.post(`${this.serverUrl}/api/llm/analyze-code`, {
        code,
        problem,
        language
      })

      if (response.data.success) {
        return response.data.analysis
      } else {
        throw new Error(response.data.error || 'Code analysis failed')
      }
    } catch (error) {
      console.error('Error analyzing code:', error)
      throw error
    }
  }

  async generateFollowUp(question: Question, candidateAnswer: string): Promise<string> {
    try {
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-followup`, {
        question,
        candidateAnswer
      })

      if (response.data.success) {
        return response.data.followUpQuestion
      } else {
        throw new Error(response.data.error || 'Follow-up generation failed')
      }
    } catch (error) {
      console.error('Error generating follow-up:', error)
      return 'Could you elaborate on that point?'
    }
  }

  async transitionToNextQuestion(): Promise<LLMResponse> {
    this.currentQuestionIndex++
    // Reset follow-up depth for new question
    this.resetFollowUpDepth()
    
    if (this.currentQuestionIndex < this.questions.length) {
      this.currentQuestion = this.questions[this.currentQuestionIndex]
      
      const responseText = `Great! Now, ${this.currentQuestion.question}`
      
      this.addConversationMessage('assistant', responseText, {
        type: 'question',
        questionId: this.currentQuestion.id,
        section: 'theoretical'
      })

      this.emit('questionChanged', this.currentQuestion)

      return {
        text: responseText,
        action: 'speak'
      }
    } else {
      // All questions done, transition to coding
      return await this.transitionToCoding()
    }
  }

  async transitionToCoding(): Promise<LLMResponse> {
    const responseText = "Excellent! Now let's move on to the coding section. I'll present you with a programming problem."
    
    this.addConversationMessage('assistant', responseText, {
      type: 'transition',
      section: 'theoretical'
    })

    this.emit('transitionToCoding')

    return {
      text: responseText,
      action: 'speak'
    }
  }

  async provideHint(hintText: string): Promise<LLMResponse> {
    this.addConversationMessage('assistant', hintText, {
      type: 'hint',
      questionId: this.currentQuestion?.id,
      hintLevel: this.hintLevel,
      section: 'theoretical'
    })

    return {
      text: hintText,
      action: 'speak'
    }
  }


  private generatePositiveResponse(score: number): string {
    if (score >= 90) {
      return "Excellent answer! You covered all the key points very well."
    } else if (score >= 80) {
      return "Good answer! You demonstrated solid understanding of the topic."
    } else if (score >= 70) {
      return "Good answer! You covered the main points well."
    } else if (score >= 60) {
      return "Thank you for that answer. You covered the key concepts."
    } else {
      // This should not be reached when needsFollowUp is false, but just in case
      return "Thank you for that answer."
    }
  }

  async generateTheoreticalHint(_question: Question, _hintLevel: number = 1): Promise<string> {
    console.log('🔍 [LLM] Generating automatic hint - using same hint generation as manual requests')
    console.log('🔍 [LLM] Current follow-up depth:', this.followUpDepth)
    console.log('🔍 [LLM] Current follow-up question:', this.currentFollowUpQuestion?.substring(0, 100))
    console.log('🔍 [LLM] Original question:', this.currentQuestion?.question.substring(0, 100))
    
    // Use the exact same hint generation as manual hint requests
    const response = await this.handleHintRequest()
    return response.text || 'Think about the key concepts and how they relate to the question.'
  }

  // Public methods for interview management
  setQuestions(questions: Question[]): void {
    this.questions = questions
    this.currentQuestionIndex = 0
    this.currentQuestion = questions[0] || null
  }

  getCurrentQuestion(): Question | null {
    return this.currentQuestion
  }

  getProgress(): { current: number, total: number } {
    return {
      current: this.currentQuestionIndex + 1,
      total: this.questions.length
    }
  }

  reset(): void {
    this.conversationHistory = []
    this.currentQuestionIndex = 0
    this.currentQuestion = this.questions[0] || null
    this.currentFollowUpQuestion = null // Clear follow-up question on reset
  }

  // Add to conversation history (legacy method - use addConversationMessage for new code)
  addToConversation(role: 'user' | 'assistant', content: string): void {
    this.addConversationMessage(role, content, {
      type: role === 'user' ? 'answer' : 'feedback',
      questionId: this.currentQuestion?.id,
      section: 'theoretical'
    })
  }

  // Set hint level for tracking
  setHintLevel(level: 1 | 2): void {
    this.hintLevel = level
  }

  getConversationHistory(): ConversationMessage[] {
    console.log(`💬 [LLM] getConversationHistory called: returning ${this.conversationHistory.length} messages`)
    if (this.conversationHistory.length > 0) {
      console.log(`💬 [LLM] First message: ${this.conversationHistory[0].role} - ${this.conversationHistory[0].content.substring(0, 50)}...`)
      console.log(`💬 [LLM] Last message: ${this.conversationHistory[this.conversationHistory.length - 1].role} - ${this.conversationHistory[this.conversationHistory.length - 1].content.substring(0, 50)}...`)
    }
    return [...this.conversationHistory]
  }

  clearConversation(): void {
    this.conversationHistory = []
  }

  // Follow-up depth management
  setFollowUpDepth(depth: number): void {
    this.followUpDepth = depth
  }

  incrementFollowUpDepth(): void {
    this.followUpDepth++
  }

  resetFollowUpDepth(): void {
    this.followUpDepth = 0
    this.currentFollowUpQuestion = null // Clear follow-up question when resetting depth
  }

  getFollowUpDepth(): number {
    return this.followUpDepth
  }

  moveToNextQuestion(): void {
    this.currentQuestionIndex++
    this.currentFollowUpQuestion = null // Clear follow-up question when moving to next
    if (this.currentQuestionIndex < this.questions.length) {
      this.currentQuestion = this.questions[this.currentQuestionIndex]
      console.log('🎯 [LLM] Moved to question:', this.currentQuestion.question.substring(0, 50))
    } else {
      this.currentQuestion = null
      console.log('🎯 [LLM] No more questions available')
    }
  }

  // Allow resuming at a specific question index
  setCurrentQuestionIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.questions.length - 1))
    this.currentQuestionIndex = clamped
    this.currentQuestion = this.questions[clamped] || null
    this.currentFollowUpQuestion = null // Clear follow-up question when changing question index
    console.log('🎯 [LLM] Set current question index to:', this.currentQuestionIndex)
  }

  // Max theoretical questions management
  setMaxTheoreticalQuestions(max: number): void {
    this.maxTheoreticalQuestions = max
  }

  getMaxTheoreticalQuestions(): number {
    return this.maxTheoreticalQuestions
  }

  // Intent detection - separate from evaluation
  async detectIntent(candidateInput: string): Promise<IntentDetection> {
    try {
      const url = `${this.serverUrl}/api/llm/detect-intent`
      console.log('🎯 [LLM] Calling detect-intent endpoint:', url)
      console.log('🎯 [LLM] Server URL:', this.serverUrl)
      const response = await this.axios.post(url, {
        candidateInput
      })

      if (response.data.success) {
        return response.data.intent
      } else {
        throw new Error(response.data.error || 'Intent detection failed')
      }
    } catch (error: any) {
      console.error('Error detecting intent:', error)
      console.error('🎯 [LLM] Detect-intent URL was:', `${this.serverUrl}/api/llm/detect-intent`)
      console.error('🎯 [LLM] Error status:', error.response?.status)
      console.error('🎯 [LLM] Error data:', error.response?.data)
      console.error('🎯 [LLM] Error message:', error.message)
      // Default to answer if detection fails
      return { intent: 'answer', confidence: 0.5 }
    }
  }

  // Handle hint request
  async handleHintRequest(): Promise<LLMResponse> {
    if (!this.currentQuestion) {
      return {
        text: "I don't have a current question to provide a hint for.",
        action: 'speak'
      }
    }

    // If we're in a follow-up, create a temporary question object with the follow-up question text
    const questionForHint = this.followUpDepth > 0 && this.currentFollowUpQuestion 
      ? {
          ...this.currentQuestion,
          question: this.currentFollowUpQuestion,
          // Keep original key points as they're still relevant
        }
      : this.currentQuestion;

    const questionText = questionForHint.question.substring(0, 100);
    console.log('🔍 [LLM] Generating hint for question:', questionText);
    console.log('🔍 [LLM] Follow-up depth:', this.followUpDepth);
    console.log('🔍 [LLM] Is follow-up hint:', this.followUpDepth > 0 && !!this.currentFollowUpQuestion);

    try {
      const url = `${this.serverUrl}/api/llm/generate-hint`
      console.log('🔍 [LLM] Calling hint endpoint:', url)
      const response = await this.axios.post(url, {
        question: questionForHint,
        candidateAnswer: '' // Parameter still required by API but not used
      })

      if (response.data.success) {
        const hintText = response.data.hint
        console.log('🔍 [LLM] Hint generated:', hintText)
        
        this.addConversationMessage('assistant', hintText, {
          type: 'hint',
          questionId: this.currentQuestion?.id,
          hintLevel: this.hintLevel,
          section: 'theoretical'
        })

        return {
          text: hintText,
          action: 'hint'
        }
      } else {
        throw new Error(response.data.error || 'Hint generation failed')
      }
    } catch (error: any) {
      console.error('Error generating hint:', error)
      console.error('🔍 [LLM] Hint endpoint URL was:', `${this.serverUrl}/api/llm/generate-hint`)
      console.error('🔍 [LLM] Error status:', error.response?.status)
      console.error('🔍 [LLM] Error message:', error.message)
      
      // Fallback hint if API fails
      const keyPoint = questionForHint.keyPoints?.[0] || 'the main topic'
      return {
        text: `Think about the key concepts: ${keyPoint}. How would you approach this?`,
        action: 'hint'
      }
    }
  }

  // Handle clarification request
  async handleClarificationRequest(): Promise<LLMResponse> {
    if (!this.currentQuestion) {
      return {
        text: "I don't have a current question to clarify.",
        action: 'speak'
      }
    }

    // If we're in a follow-up, clarify the follow-up question, not the original
    const questionForClarification = this.followUpDepth > 0 && this.currentFollowUpQuestion 
      ? {
          ...this.currentQuestion,
          question: this.currentFollowUpQuestion,
          // Keep original key points and expected answer as they're still relevant
        }
      : this.currentQuestion;

    const questionText = questionForClarification.question.substring(0, 100);
    console.log('🔍 [LLM] Generating clarification for question:', questionText);
    console.log('🔍 [LLM] Follow-up depth:', this.followUpDepth);
    console.log('🔍 [LLM] Is follow-up clarification:', this.followUpDepth > 0 && !!this.currentFollowUpQuestion);

    try {
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-clarification`, {
        question: questionForClarification
      })

      if (response.data.success) {
        const clarificationText = response.data.clarification
        
        this.addConversationMessage('assistant', clarificationText, {
          type: 'clarification',
          questionId: this.currentQuestion?.id,
          section: 'theoretical'
        })

        return {
          text: clarificationText,
          action: 'clarification'
        }
      } else {
        throw new Error(response.data.error || 'Clarification generation failed')
      }
    } catch (error) {
      console.error('Error generating clarification:', error)
      return {
        text: `Let me rephrase that: ${questionForClarification.question}`,
        action: 'clarification'
      }
    }
  }

  // Handle skip question request
  async handleSkipQuestion(): Promise<LLMResponse> {
    if (!this.currentQuestion) {
      return {
        text: "Moving on.",
        action: 'skip'
      }
    }

    console.log('🔍 [LLM] Handling skip question request')

    // Create a zero-score evaluation for the skipped question
    const evaluation: Evaluation = {
      questionId: this.currentQuestion.id,
      candidateAnswer: "User doesn't know the answer",
      keyPointsCovered: [],
      score: 0,
      needsFollowUp: false,
      feedback: "Okay let's skip this question."
    }
    
    // Emit evaluation event so it gets recorded
    this.emit('evaluation', evaluation)

    return {
      text: "Alright, let's move to the next question.",
      action: 'skip',
      evaluation
    }
  }

  // Generate coding-specific clarification
  async generateCodingClarification(
    problem: any,
    clarificationRequest: string,
    clarificationCount: number,
    currentCode: string = ''
  ): Promise<string> {
    try {
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-coding-clarification`, {
        problem,
        clarificationRequest,
        clarificationCount,
        currentCode
      })

      if (response.data.success) {
        return response.data.clarification
      } else {
        throw new Error(response.data.error || 'Coding clarification generation failed')
      }
    } catch (error) {
      console.error('Error generating coding clarification:', error)
      return `Let me clarify: ${problem.description || 'the problem requirements'}`
    }
  }

  // Generate detailed submission feedback
  async generateSubmissionFeedback(
    problem: any,
    submittedCode: string,
    analysis: {
      progress: number
      approach: 'correct' | 'incorrect' | 'incomplete' | 'unsure'
      issues: string[]
      codeQuality: 'good' | 'fair' | 'poor'
    }
  ): Promise<string> {
    try {
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-submission-feedback`, {
        problem,
        submittedCode,
        analysis
      })

      if (response.data.success) {
        return response.data.feedback
      } else {
        throw new Error(response.data.error || 'Submission feedback generation failed')
      }
    } catch (error) {
      console.error('Error generating submission feedback:', error)
      // Fallback to basic feedback
      if (analysis.approach === 'correct' && analysis.progress >= 80) {
        return "Your solution is correct. Well done."
      } else if (analysis.approach === 'incorrect') {
        const mainIssue = analysis.issues[0] || "there's a logic error in your approach"
        return `Your solution has issues. ${mainIssue}.`
      } else if (analysis.approach === 'incomplete') {
        const mainIssue = analysis.issues[0] || "some parts are missing"
        return `Your solution is incomplete. ${mainIssue}.`
      } else {
        return "Your solution needs more work. Let's move on."
      }
    }
  }

  // Evaluate follow-up answer with full context
  async evaluateFollowUpAnswer(
    originalQuestion: Question,
    originalCandidateAnswer: string,
    followUpQuestion: string,
    followUpAnswer: string,
    followUpDepth: number = 1
  ): Promise<LLMResponse> {
    console.log('🔍 [LLM-Main] evaluateFollowUpAnswer called with:', {
      originalQuestionId: originalQuestion.id,
      followUpDepth,
      followUpAnswerLength: followUpAnswer.length,
      followUpQuestion: followUpQuestion.substring(0, 50) + '...'
    })
    
    try {
      console.log('🔍 [LLM-Main] Calling evaluate-followup API')
      const response = await this.axios.post(`${this.serverUrl}/api/llm/evaluate-followup`, {
        originalQuestion,
        originalCandidateAnswer,
        followUpQuestion,
        followUpAnswer,
        followUpDepth
      })

      if (response.data.success) {
        const evaluation = response.data.evaluation
        
        // Emit evaluation event
        this.emit('evaluation', evaluation)

        return {
          text: evaluation.feedback,
          action: 'evaluate',
          evaluation
        }
      } else {
        throw new Error(response.data.error || 'Follow-up evaluation failed')
      }
    } catch (error) {
      console.error('Error evaluating follow-up answer:', error)
      return {
        text: "I had trouble evaluating your follow-up answer. Let's move on to the next question.",
        action: 'speak'
      }
    }
  }
}

// Factory function for easy initialization
export function createLLMService(serverUrl: string): LLMService {
  return new LLMService(serverUrl)
}