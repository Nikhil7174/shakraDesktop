import { EventEmitter } from 'events'
import axios from 'axios'
import http from 'http'
import https from 'https'
import { ConversationMessage } from '../../shared/types'

export interface CodingProblem {
  id: string
  title: string
  description: string
  language: string
  starterCode?: string
  // Support for multiple languages
  starterCodes?: Record<string, string> // e.g., { javascript: "code", python: "code", cpp: "code", java: "code" }
  solution: string
  hints: string[]
  testCases: TestCase[]
  difficulty: 'easy' | 'medium' | 'hard'
  constraints?: string[] | string // Optional constraints (can be array or JSON string)
  examples?: Array<{
    input?: string
    output?: string
    explanation?: string
  }> | string | any // Optional examples (can be array, object, or JSON string)
}

export interface TestCase {
  input: string
  expectedOutput: string
  description: string
}

export interface CodeSnapshot {
  code: string
  timestamp: number
  analysis?: CodeAnalysis
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

export interface Observation {
  timestamp: number
  code: string
  analysis: CodeAnalysis
}

// Create reusable HTTP/HTTPS agents for connection pooling (shared with llm-service)
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

export class CodeAnalysisService extends EventEmitter {
  private serverUrl: string
  private axios: typeof axiosInstance  // Use shared instance with connection reuse
  private observations: Observation[] = []
  private currentProblem: CodingProblem | null = null
  private startTime: number = 0
  // Simple stuck detection: store code every 60 seconds
  private lastStoredCode: string = ''
  private lastStoredTime: number = 0
  private lastCodeHash: string = ''
  // Conversation history for coding section
  private conversationHistory: ConversationMessage[] = []
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _hintLevel: 1 | 2 = 1
  private finalCode?: string
  private timeComplexity?: string
  private spaceComplexity?: string

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
    this.axios = axiosInstance  // Use shared instance with connection reuse
  }

  // Helper method to add messages with metadata for coding section
  // Made public to allow external code to add messages with custom metadata
  addConversationMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata: ConversationMessage['metadata']
  ): void {
    this.conversationHistory.push({
      role,
      content,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        section: 'coding',
        codingProblemId: this.currentProblem?.id
      }
    })
  }

  // Add verbal explanation/approach from candidate
  addVerbalExplanation(explanation: string): void {
    this.addConversationMessage('user', explanation, {
      type: 'answer'
    })
  }

  // Add user's hint request to conversation history
  addHintRequest(requestText: string): void {
    this.addConversationMessage('user', requestText, {
      type: 'hint'
    })
  }

  // Add hint provided during coding
  addHint(hintText: string, hintLevel: 1 | 2 = 1): void {
    this._hintLevel = hintLevel
    this.addConversationMessage('assistant', hintText, {
      type: 'hint',
      hintLevel
    })
  }

  // Add user's clarification request to conversation history
  addClarificationRequest(requestText: string): void {
    this.addConversationMessage('user', requestText, {
      type: 'clarification'
    })
  }

  // Add clarification provided during coding
  addClarification(clarificationText: string): void {
    this.addConversationMessage('assistant', clarificationText, {
      type: 'clarification'
    })
  }

  // Add code analysis update
  addCodeAnalysis(analysis: CodeAnalysis): void {
    this.addConversationMessage('system', `Code analysis: ${analysis.progress}% progress, ${analysis.approach} approach`, {
      type: 'code_analysis'
    })
  }

  // Store final code submission
  setFinalCode(code: string, timeComplexity?: string, spaceComplexity?: string): void {
    this.finalCode = code
    this.timeComplexity = timeComplexity
    this.spaceComplexity = spaceComplexity
    
    // Add code submission to conversation history with code and complexities in metadata
    this.addConversationMessage('user', 'Code submitted', {
      type: 'code_submission',
      code: code,
      timeComplexity: timeComplexity,
      spaceComplexity: spaceComplexity
    } as any)
  }

  // Get conversation history for current problem
  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory]
  }

  // Get final code and complexity
  getFinalSubmission(): {
    code?: string
    timeComplexity?: string
    spaceComplexity?: string
  } {
    return {
      code: this.finalCode,
      timeComplexity: this.timeComplexity,
      spaceComplexity: this.spaceComplexity
    }
  }

  async analyzeCode(code: string, problem: CodingProblem, forceAnalysis: boolean = false): Promise<CodeAnalysis> {
    try {
      const now = Date.now()
      const codeHash = this.normalizeCode(code)
      const codeChanged = codeHash !== this.lastCodeHash
      if (codeChanged) {
        this.lastCodeHash = codeHash
      }

      // Simple logic: always send to LLM (frontend sends every 60s)
      // Use stored code as previous, or starter code if first time
      let previousCode = ''
      if (this.lastStoredCode.length === 0) {
        // First time - use starter code
        previousCode = problem.starterCode || 
                      (problem.starterCodes?.[problem.language || 'cpp']) || 
                      ''
        console.log('🎯 [CodeAnalysis] First call - using starter code as previous')
      } else {
        // Use last stored code (from previous 60s check)
        previousCode = this.lastStoredCode
        const timeSinceLastStore = now - this.lastStoredTime
        console.log(`🎯 [CodeAnalysis] Comparing with code from ${Math.round(timeSinceLastStore/1000)}s ago`)
      }
      
      console.log('🎯 [CodeAnalysis] Sending to LLM - Current:', code.length, 'chars, Previous:', previousCode.length, 'chars')
      
      // Send to LLM for stuck detection
      const response = await this.axios.post(`${this.serverUrl}/api/llm/analyze-code`, {
        code,
        previousCode,
        problem: problem.description,
        language: problem.language
      })

      if (response.data.success) {
        const analysis = response.data.analysis
        
        // Store current code after LLM check (for next 60s comparison)
        // Only store if this is a regular call, not a forced analysis for hints
        if (!forceAnalysis) {
          this.lastStoredCode = code
          this.lastStoredTime = now
          console.log('🎯 [CodeAnalysis] Stored current code for next 60s check')
        } else {
          console.log('🎯 [CodeAnalysis] Forced analysis for hint generation - not storing')
        }
        
        // Store observation
        const observation: Observation = {
          timestamp: now,
          code,
          analysis
        }
        this.observations.push(observation)

        // Add to conversation history
        if (!forceAnalysis) {
          this.addCodeAnalysis(analysis)
        }

        // Emit analysis event
        this.emit('analysisComplete', analysis)

        return analysis
      } else {
        throw new Error(response.data.error || 'Code analysis failed')
      }
    } catch (error) {
      console.error('Error analyzing code:', error)
      throw error
    }
  }

  private normalizeCode(code: string): string {
    // Normalize code for comparison - remove ALL whitespace to detect actual changes
    // int sum = 0; and int sum=0; should be considered the same
    return code.replace(/\s+/g, '')
  }

  async evaluateApproach(verbalExplanation: string, problem: CodingProblem, currentCode: string = '', isFirstApproach: boolean = false): Promise<{
    isApproach: boolean
    isCorrect?: boolean
    isClarification: boolean
    feedback?: string
    clarification?: string
  }> {
    try {
      const starterCode =
        problem.starterCode ||
        (problem.starterCodes ? problem.starterCodes[problem.language || 'cpp'] : '') ||
        ''

      const hasCurrentCode = currentCode.trim().length > 0
      const hasStarterCode = starterCode.trim().length > 0

      let includeCode = false
      if (hasCurrentCode) {
        if (!hasStarterCode) {
          includeCode = true
        } else {
          includeCode = this.normalizeCode(currentCode) !== this.normalizeCode(starterCode)
        }
      }

      const requestBody: Record<string, any> = {
        explanation: verbalExplanation,
        problem: {
          title: problem.title,
          description: problem.description,
          constraints: problem.hints,
          language: problem.language
        },
        isFirstApproach: isFirstApproach
      }

      if (includeCode) {
        requestBody.starterCode = starterCode
        requestBody.currentCode = currentCode
      }

      const response = await this.axios.post(`${this.serverUrl}/api/llm/evaluate-coding-approach`, requestBody)

      if (response.data.success) {
        return response.data.evaluation
      } else {
        throw new Error(response.data.error || 'Approach evaluation failed')
      }
    } catch (error) {
      console.error('Error evaluating approach:', error)
      // Fallback response
      return {
        isApproach: true,
        isCorrect: true,
        isClarification: false,
        feedback: "I understand your approach. Continue with the implementation."
      }
    }
  }

  async getApproachHint(problem: CodingProblem, hintLevel: 1 | 2 = 1): Promise<string> {
    try {
      // For approach phase - only send problem info, NO code at all
      console.log(`🎯 [CodeAnalysis] Generating approach-phase hint level ${hintLevel} (no code context)`)
      
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-coding-approach-hint`, {
        problem: {
          title: problem.title || 'Coding Problem',
          description: problem.description,
          constraints: problem.constraints
        },
        hintLevel
      })

      if (response.data.success && response.data.hint) {
        console.log(`🎯 [CodeAnalysis] Approach-phase hint level ${hintLevel} generated:`, response.data.hint)
        this.addHint(response.data.hint, hintLevel)
        return response.data.hint
      } else {
        return this.getDefaultHint(problem, hintLevel)
      }
    } catch (error) {
      console.error('Error generating approach-phase hint:', error)
      return this.getDefaultHint(problem, hintLevel)
    }
  }

  async getHint(problem: CodingProblem, currentCode: string, hintLevel: 1 | 2 = 1): Promise<string> {
    try {
      // For monitoring phase - use monitoring hint endpoint (with code context)
      // This is used for manual hint requests during code monitoring phase
      console.log(`🎯 [CodeAnalysis] Generating monitoring-phase hint level ${hintLevel} (with code context)`)
      
      // First, analyze the current code to understand its state (force analysis for hints)
      const codeAnalysis = await this.analyzeCode(currentCode, problem, true) // Force analysis for hint generation
      
      // Check if code is complete - if so, provide encouragement instead of hint
      if (codeAnalysis.progress >= 85 && codeAnalysis.approach === 'correct') {
        console.log(`🎯 [CodeAnalysis] Code is complete (${codeAnalysis.progress}%), providing encouragement instead of hint`)
        return "Your solution looks complete! Review it and submit when ready."
      }
      
      // Use stored code as previous (or starter code if none stored)
      const previousCode = this.lastStoredCode || 
                          (problem.starterCode || 
                           (problem.starterCodes?.[problem.language || 'cpp']) || 
                           '')
      const hasChanged = this.normalizeCode(currentCode) !== this.normalizeCode(previousCode)
      
      console.log(`🎯 [CodeAnalysis] Code state - Progress: ${codeAnalysis.progress}%, Approach: ${codeAnalysis.approach}, Issues: ${codeAnalysis.issues.length}`)
      
      // Use monitoring hint endpoint (for code monitoring phase)
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-monitoring-hint`, {
        problem: {
          title: problem.title || 'Coding Problem',
          description: problem.description,
          constraints: problem.constraints
        },
        hintLevel,
        currentCode,
        previousCode: previousCode || null,
        hasCodeChanged: hasChanged,
        // Include code analysis for contextual hints
        codeAnalysis: {
          progress: codeAnalysis.progress,
          approach: codeAnalysis.approach,
          issues: codeAnalysis.issues,
          codeQuality: codeAnalysis.codeQuality
        }
      })

      if (response.data.success && response.data.hint) {
        console.log(`🎯 [CodeAnalysis] Manual hint level ${hintLevel} generated:`, response.data.hint)
        this.addHint(response.data.hint, hintLevel)
        return response.data.hint
      } else {
        return this.getDefaultHint(problem, hintLevel)
      }
    } catch (error) {
      console.error('Error generating coding hint:', error)
      return this.getDefaultHint(problem, hintLevel)
    }
  }

  private getDefaultHint(problem: CodingProblem, hintLevel: 1 | 2): string {
    const hints = problem.hints || []
    
    if (hints.length > 0) {
      const hintIndex = Math.min(hintLevel - 1, hints.length - 1)
      return hints[hintIndex]
    }

    // Fallback hints based on escalation level
    const fallbackHints = {
      1: "Think about what data structure might help you solve this efficiently. Consider using a hashmap, stack, or queue.",
      2: "Consider what algorithm or technique might be useful here. Think about binary search, dynamic programming, or two-pointer approaches."
    }

    return fallbackHints[hintLevel]
  }

  async checkProgress(problem: CodingProblem, currentCode: string): Promise<{
    progress: number
    isComplete: boolean
    issues: string[]
  }> {
    try {
      const analysis = await this.analyzeCode(currentCode, problem)
      
      return {
        progress: analysis.progress,
        isComplete: analysis.progress >= 90 && analysis.approach === 'correct',
        issues: analysis.issues
      }
    } catch (error) {
      console.error('Error checking progress:', error)
      return {
        progress: 0,
        isComplete: false,
        issues: ['Unable to analyze code']
      }
    }
  }

  setCurrentProblem(problem: CodingProblem): void {
    this.currentProblem = problem
    this.startTime = Date.now()
    this.observations = []
    // Reset simple stuck detection
    this.lastStoredCode = ''
    this.lastStoredTime = 0
    this.lastCodeHash = ''
    // Reset conversation history for new problem
    this.conversationHistory = []
    this.finalCode = undefined
    this.timeComplexity = undefined
    this.spaceComplexity = undefined
    this._hintLevel = 1
    
    // Build complete problem statement with all details
    let problemStatement = `Let's work on: ${problem.title}.\n\n${problem.description}`
    
    // Add constraints if available
    if (problem.constraints) {
      let constraintsText = ''
      if (Array.isArray(problem.constraints)) {
        constraintsText = problem.constraints.join('\n')
      } else if (typeof problem.constraints === 'string') {
        try {
          // Try to parse as JSON array
          const parsed = JSON.parse(problem.constraints)
          if (Array.isArray(parsed)) {
            constraintsText = parsed.join('\n')
          } else {
            constraintsText = problem.constraints
          }
        } catch {
          // If not JSON, use as-is
          constraintsText = problem.constraints
        }
      }
      if (constraintsText) {
        problemStatement += `\n\nConstraints:\n${constraintsText}`
      }
    }
    
    // Add examples if available
    if (problem.examples) {
      let examplesText = ''
      if (Array.isArray(problem.examples)) {
        examplesText = problem.examples.map((ex, idx) => {
          const parts: string[] = []
          if (ex.input !== undefined) parts.push(`Input: ${ex.input}`)
          if (ex.output !== undefined) parts.push(`Output: ${ex.output}`)
          if (ex.explanation !== undefined) parts.push(`Explanation: ${ex.explanation}`)
          return `Example ${idx + 1}:\n${parts.join('\n')}`
        }).join('\n\n')
      } else if (typeof problem.examples === 'string') {
        try {
          // Try to parse as JSON
          const parsed = JSON.parse(problem.examples)
          if (Array.isArray(parsed)) {
            examplesText = parsed.map((ex: any, idx: number) => {
              const parts: string[] = []
              if (ex.input !== undefined) parts.push(`Input: ${ex.input}`)
              if (ex.output !== undefined) parts.push(`Output: ${ex.output}`)
              if (ex.explanation !== undefined) parts.push(`Explanation: ${ex.explanation}`)
              return `Example ${idx + 1}:\n${parts.join('\n')}`
            }).join('\n\n')
          } else {
            examplesText = problem.examples
          }
        } catch {
          // If not JSON, use as-is
          examplesText = problem.examples
        }
      }
      if (examplesText) {
        problemStatement += `\n\nExamples:\n${examplesText}`
      }
    }
    
    // Add problem introduction to conversation with full statement
    this.addConversationMessage('assistant', problemStatement, {
      type: 'question'
    })
    
    console.log('🎯 [CodeAnalysis] Problem set - reset stuck detection and conversation history')
  }

  getCurrentProblem(): CodingProblem | null {
    return this.currentProblem
  }

  getLastStoredCode(): string {
    return this.lastStoredCode
  }

  getObservations(): Observation[] {
    return [...this.observations]
  }

  getTimeSpent(): number {
    return Date.now() - this.startTime
  }


  reset(): void {
    this.observations = []
    this.currentProblem = null
    this.startTime = 0
    this.lastStoredCode = ''
    this.lastStoredTime = 0
    this.lastCodeHash = ''
    this.conversationHistory = []
    this.finalCode = undefined
    this.timeComplexity = undefined
    this.spaceComplexity = undefined
    this._hintLevel = 1
  }

  // Get summary of coding session
  getSessionSummary(): {
    totalTime: number
    observations: number
    stuckTime: number
    averageProgress: number
    issues: string[]
  } {
    const totalTime = this.getTimeSpent()
    const observations = this.observations.length
    // Simple stuck detection doesn't track stuck time separately
    const stuckTime = 0
    
    const averageProgress = this.observations.length > 0 
      ? this.observations.reduce((sum, obs) => sum + obs.analysis.progress, 0) / this.observations.length
      : 0

    const allIssues = this.observations.flatMap(obs => obs.analysis.issues)
    const uniqueIssues = [...new Set(allIssues)]

    return {
      totalTime,
      observations,
      stuckTime,
      averageProgress,
      issues: uniqueIssues
    }
  }

}

export function createCodeAnalysisService(serverUrl: string): CodeAnalysisService {
  return new CodeAnalysisService(serverUrl)
}