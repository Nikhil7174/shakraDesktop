import { EventEmitter } from 'events'
import axios from 'axios'
import http from 'http'
import https from 'https'

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

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
    this.axios = axiosInstance  // Use shared instance with connection reuse
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

  async evaluateApproach(verbalExplanation: string, problem: CodingProblem, currentCode: string = ''): Promise<{
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
        }
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

  async getMonitoringHint(problem: CodingProblem, currentCode: string, hintLevel: 1 | 2 = 1): Promise<string> {
    try {
      // First, analyze the current code to understand its state (force analysis for hints)
      console.log(`🎯 [CodeAnalysis] Analyzing code for monitoring hint level ${hintLevel}`)
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
      
      // Use monitoring-specific hint endpoint
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
        console.log(`🎯 [CodeAnalysis] Monitoring hint level ${hintLevel} generated:`, response.data.hint)
        return response.data.hint
      } else {
        return this.getDefaultHint(problem, hintLevel)
      }
    } catch (error) {
      console.error('Error generating monitoring hint:', error)
      return this.getDefaultHint(problem, hintLevel)
    }
  }

  async getHint(problem: CodingProblem, currentCode: string, hintLevel: 1 | 2 = 1): Promise<string> {
    try {
      // First, analyze the current code to understand its state (force analysis for hints)
      console.log(`🎯 [CodeAnalysis] Analyzing current code before generating manual hint level ${hintLevel}`)
      const codeAnalysis = await this.analyzeCode(currentCode, problem, true) // Force analysis for hint generation
      
      // Use stored code as previous (or starter code if none stored)
      const previousCode = this.lastStoredCode || 
                          (problem.starterCode || 
                           (problem.starterCodes?.[problem.language || 'cpp']) || 
                           '')
      const hasChanged = this.normalizeCode(currentCode) !== this.normalizeCode(previousCode)
      
      console.log(`🎯 [CodeAnalysis] Code state - Progress: ${codeAnalysis.progress}%, Approach: ${codeAnalysis.approach}, Issues: ${codeAnalysis.issues.length}`)
      
      // Use general hint endpoint for manual requests
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-coding-hint`, {
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
    console.log('🎯 [CodeAnalysis] Problem set - reset stuck detection')
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