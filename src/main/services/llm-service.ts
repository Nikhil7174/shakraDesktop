import { EventEmitter } from 'events'
import axios from 'axios'

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
  intent: 'answer' | 'hint_request' | 'clarification_request'
  confidence: number
}

export interface CodeAnalysis {
  progress: number // 0-100
  approach: 'correct' | 'incorrect' | 'incomplete' | 'unsure'
  isStuck: boolean
  issues: string[]
  suggestedHint?: string
  hintLevel: 1 | 2 | 3
  timeStuck: number // milliseconds
  codeQuality: 'good' | 'fair' | 'poor'
  testable: boolean
}

export interface LLMResponse {
  text?: string
  action: 'speak' | 'evaluate' | 'transition' | 'hint' | 'clarification'
  evaluation?: Evaluation
  isAskingHint?: boolean
  isAskingClarifyingQuestion?: boolean
  functionCall?: {
    name: string
    arguments: any
  }
}

export class LLMService extends EventEmitter {
  private serverUrl: string
  private conversationHistory: Message[] = []
  private currentQuestion: Question | null = null
  private currentQuestionIndex: number = 0
  private questions: Question[] = []
  private followUpDepth: number = 0
  private maxTheoreticalQuestions: number = 10
  private currentFollowUpQuestion: string | null = null // Track the current follow-up question text

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
  }

  async processTranscript(text: string, detectedIntent?: IntentDetection): Promise<LLMResponse> {
    // Add user message to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: text
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
      } else if (intent.intent === 'answer') {
        // This is an answer - always evaluate it if we have a current question
        // The LLM evaluation endpoint will handle incomplete/partial answers appropriately
        if (this.currentQuestion) {
          return await this.evaluateAnswer(text, this.followUpDepth, this.maxTheoreticalQuestions)
        }
      }

      // Fallback to regular conversation
      const response = await axios.post(`${this.serverUrl}/api/llm/generate-response`, {
        context: this.buildContext(),
        conversationHistory: this.conversationHistory
      })

      if (response.data.success) {
        const assistantMessage = response.data.response
        
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantMessage
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
      const response = await axios.post(`${this.serverUrl}/api/llm/evaluate-answer`, {
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
          this.conversationHistory.push({
            role: 'assistant',
            content: evaluation.feedback
          })

          return {
            text: evaluation.feedback,
            action: 'hint',
            evaluation
          }
        }

        if (evaluation.isAskingClarifyingQuestion && evaluation.isClarificationResponse) {
          this.conversationHistory.push({
            role: 'assistant',
            content: evaluation.feedback
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
          responseText = evaluation.followUpQuestion || "Let me ask a follow-up question about that."
          // Store the follow-up question for hint generation
          this.currentFollowUpQuestion = evaluation.followUpQuestion || null
          console.log('🎯 [LLM] Follow-up question stored for hints:', this.currentFollowUpQuestion?.substring(0, 50))
        } else {
          responseText = this.generatePositiveResponse(evaluation.score)
        }

        // Add assistant message to conversation
        this.conversationHistory.push({
          role: 'assistant',
          content: responseText
        })

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
      const response = await axios.post(`${this.serverUrl}/api/llm/analyze-code`, {
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
      const response = await axios.post(`${this.serverUrl}/api/llm/generate-followup`, {
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
      
      this.conversationHistory.push({
        role: 'assistant',
        content: responseText
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
    
    this.conversationHistory.push({
      role: 'assistant',
      content: responseText
    })

    this.emit('transitionToCoding')

    return {
      text: responseText,
      action: 'speak'
    }
  }

  async provideHint(hintText: string): Promise<LLMResponse> {
    this.conversationHistory.push({
      role: 'assistant',
      content: hintText
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
    } else {
      return "Thank you for that answer. Let me ask a follow-up question."
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

  // Add to conversation history
  addToConversation(role: 'user' | 'assistant', content: string): void {
    this.conversationHistory.push({ role, content })
  }

  getConversationHistory(): Message[] {
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
      const response = await axios.post(`${this.serverUrl}/api/llm/detect-intent`, {
        candidateInput
      })

      if (response.data.success) {
        return response.data.intent
      } else {
        throw new Error(response.data.error || 'Intent detection failed')
      }
    } catch (error) {
      console.error('Error detecting intent:', error)
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
      const response = await axios.post(`${this.serverUrl}/api/llm/generate-hint`, {
        question: questionForHint,
        candidateAnswer: '' // Parameter still required by API but not used
      })

      if (response.data.success) {
        const hintText = response.data.hint
        console.log('🔍 [LLM] Hint generated:', hintText)
        
        this.conversationHistory.push({
          role: 'assistant',
          content: hintText
        })

        return {
          text: hintText,
          action: 'hint'
        }
      } else {
        throw new Error(response.data.error || 'Hint generation failed')
      }
    } catch (error) {
      console.error('Error generating hint:', error)
      const keyPoint = questionForHint.keyPoints[0] || 'the main topic'
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
      const response = await axios.post(`${this.serverUrl}/api/llm/generate-clarification`, {
        question: questionForClarification
      })

      if (response.data.success) {
        const clarificationText = response.data.clarification
        
        this.conversationHistory.push({
          role: 'assistant',
          content: clarificationText
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
      const response = await axios.post(`${this.serverUrl}/api/llm/evaluate-followup`, {
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