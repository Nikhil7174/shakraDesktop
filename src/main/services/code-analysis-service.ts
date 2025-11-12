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
  timeStuck: number // milliseconds
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
  // private lastAnalysisTime: number = 0
  private stuckStartTime: number = 0
  private isStuck: boolean = false
  private lastCodeChangeTime: number = 0
  private lastCodeHash: string = ''
  private codeHistory: CodeSnapshot[] = [] // Track code snapshots over time

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
    this.axios = axiosInstance  // Use shared instance with connection reuse
  }

  async analyzeCode(code: string, problem: CodingProblem): Promise<CodeAnalysis> {
    try {
      const now = Date.now()
      const codeHash = this.normalizeCode(code)
      
      // Track code changes for inactivity detection and history
      if (codeHash !== this.lastCodeHash) {
        this.lastCodeChangeTime = now
        this.lastCodeHash = codeHash
        
        // Store code snapshot in history
        this.codeHistory.push({
          code,
          timestamp: now
        })
        
        // Keep only last 20 snapshots to avoid memory issues
        if (this.codeHistory.length > 20) {
          this.codeHistory.shift()
        }
      }

      const response = await this.axios.post(`${this.serverUrl}/api/llm/analyze-code`, {
        code,
        problem: problem.description,
        language: problem.language
      })

      if (response.data.success) {
        const analysis = response.data.analysis
        
        // Store observation
        const observation: Observation = {
          timestamp: now,
          code,
          analysis
        }
        this.observations.push(observation)

        // Update stuck state (includes inactivity check)
        this.updateStuckState(analysis, code)

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

  private updateStuckState(analysis: CodeAnalysis, code: string): void {
    const now = Date.now()
    const INACTIVITY_THRESHOLD = 60000 // 60 seconds
    
    // Check for inactivity (no code changes for >60 seconds)
    const timeSinceLastChange = now - this.lastCodeChangeTime
    const hasInactivity = this.lastCodeChangeTime > 0 && timeSinceLastChange > INACTIVITY_THRESHOLD
    
    // Check if code is essentially empty or just starter code
    const normalizedCode = this.normalizeCode(code)
    const starterCode = this.currentProblem?.starterCode || ''
    const normalizedStarter = this.normalizeCode(starterCode)
    const isMinimalCode = normalizedCode.length < 50 || normalizedCode === normalizedStarter
    
    // Consider stuck if:
    // 1. LLM detected stuck, OR
    // 2. No code changes for >60 seconds AND code is minimal/unchanged
    const shouldBeStuck = analysis.isStuck || (hasInactivity && isMinimalCode)
    
    if (shouldBeStuck && !this.isStuck) {
      // Just got stuck
      this.isStuck = true
      // Use the earlier of: LLM stuck time or inactivity start time
      if (analysis.isStuck && this.stuckStartTime > 0) {
        // Keep existing stuck start time if LLM already detected it
      } else {
        // Start tracking from when inactivity began
        this.stuckStartTime = this.lastCodeChangeTime > 0 
          ? this.lastCodeChangeTime + INACTIVITY_THRESHOLD 
          : now
      }
      console.log(`🎯 [CodeAnalysis] User marked as stuck - LLM: ${analysis.isStuck}, Inactivity: ${hasInactivity}, Time since change: ${Math.round(timeSinceLastChange/1000)}s`)
    } else if (!shouldBeStuck && this.isStuck) {
      // No longer stuck
      this.isStuck = false
      this.stuckStartTime = 0
      console.log(`✅ [CodeAnalysis] User no longer stuck`)
    }

    // Update time stuck
    if (this.isStuck) {
      analysis.timeStuck = now - this.stuckStartTime
      analysis.isStuck = true // Ensure isStuck is set to true
    } else {
      analysis.timeStuck = 0
    }
  }

  // Get code from 1 minute ago, or starter code if first time
  private getPreviousCode(): string {
    const now = Date.now()
    const oneMinuteAgo = now - 60000
    
    // Find code snapshot from ~1 minute ago
    for (let i = this.codeHistory.length - 1; i >= 0; i--) {
      const snapshot = this.codeHistory[i]
      if (snapshot.timestamp <= oneMinuteAgo) {
        return snapshot.code
      }
    }
    
    // If no history or first time, return starter code
    if (this.currentProblem) {
      return this.currentProblem.starterCode || 
             (this.currentProblem.starterCodes?.[this.currentProblem.language || 'cpp']) || 
             ''
    }
    
    return ''
  }

  // Check if any code change was made (without LLM) - compares current code with last known code
  hasCodeChanged(currentCode: string): boolean {
    const normalizedCurrent = this.normalizeCode(currentCode)
    
    // Compare with last known code hash
    if (this.lastCodeHash && normalizedCurrent !== this.lastCodeHash) {
      return true
    }
    
    // If no history yet, check if current code differs from starter code
    if (this.codeHistory.length === 0) {
      const starterCode = this.currentProblem?.starterCode || 
                         (this.currentProblem?.starterCodes?.[this.currentProblem.language || 'cpp']) || 
                         ''
      const normalizedStarter = this.normalizeCode(starterCode)
      return normalizedCurrent !== normalizedStarter && normalizedCurrent.length > 0
    }
    
    // Compare with latest code in history
    const latestCode = this.codeHistory[this.codeHistory.length - 1].code
    const normalizedLatest = this.normalizeCode(latestCode)
    return normalizedCurrent !== normalizedLatest
  }

  async getHint(problem: CodingProblem, currentCode: string, hintLevel: 1 | 2 = 1): Promise<string> {
    try {
      // Get code from 1 minute ago (or starter code if first time)
      const previousCode = this.getPreviousCode()
      const hasChanged = this.hasCodeChanged(currentCode)
      
      console.log(`🎯 [CodeAnalysis] Generating hint level ${hintLevel}, code changed: ${hasChanged}`)
      
      // Use enhanced hint endpoint that compares current code with previous code
      const response = await this.axios.post(`${this.serverUrl}/api/llm/generate-coding-hint`, {
        problem: {
          title: problem.title || 'Coding Problem',
          description: problem.description,
          constraints: problem.constraints
        },
        hintLevel,
        currentCode,
        previousCode: previousCode || null, // Code from 1 min ago or starter code
        hasCodeChanged: hasChanged
      })

      if (response.data.success && response.data.hint) {
        console.log(`🎯 [CodeAnalysis] Hint level ${hintLevel} generated:`, response.data.hint)
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
    this.isStuck = false
    this.stuckStartTime = 0
    this.lastCodeChangeTime = Date.now()
    this.lastCodeHash = ''
    this.codeHistory = []
    
    // Initialize with starter code as first snapshot
    const starterCode = problem.starterCode || 
                       (problem.starterCodes?.[problem.language || 'cpp']) || 
                       ''
    if (starterCode) {
      this.codeHistory.push({
        code: starterCode,
        timestamp: Date.now()
      })
    }
  }

  getCurrentProblem(): CodingProblem | null {
    return this.currentProblem
  }

  getObservations(): Observation[] {
    return [...this.observations]
  }

  getTimeSpent(): number {
    return Date.now() - this.startTime
  }

  getStuckTime(): number {
    if (this.isStuck) {
      return Date.now() - this.stuckStartTime
    }
    return 0
  }

  isCurrentlyStuck(): boolean {
    return this.isStuck
  }

  reset(): void {
    this.observations = []
    this.currentProblem = null
    this.startTime = 0
    this.isStuck = false
    this.stuckStartTime = 0
    this.lastCodeChangeTime = 0
    this.lastCodeHash = ''
    this.codeHistory = []
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
    const stuckTime = this.getStuckTime()
    
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

  resetStuckTimer(): void {
    if (this.isStuck) {
      this.stuckStartTime = Date.now()
    }
    // Also reset inactivity tracking when hint is provided
    this.lastCodeChangeTime = Date.now()
  }
  
  // Check for inactivity without full analysis (for periodic checks)
  checkInactivity(): { isStuck: boolean; timeStuck: number } {
    const now = Date.now()
    const INACTIVITY_THRESHOLD = 60000 // 60 seconds
    const timeSinceLastChange = now - this.lastCodeChangeTime
    
    if (this.lastCodeChangeTime > 0 && timeSinceLastChange > INACTIVITY_THRESHOLD) {
      if (!this.isStuck) {
        this.isStuck = true
        this.stuckStartTime = this.lastCodeChangeTime + INACTIVITY_THRESHOLD
        console.log(`🎯 [CodeAnalysis] Inactivity detected - no changes for ${Math.round(timeSinceLastChange/1000)}s`)
      }
      return {
        isStuck: true,
        timeStuck: now - this.stuckStartTime
      }
    }
    
    return {
      isStuck: this.isStuck,
      timeStuck: this.isStuck ? now - this.stuckStartTime : 0
    }
  }
}

export function createCodeAnalysisService(serverUrl: string): CodeAnalysisService {
  return new CodeAnalysisService(serverUrl)
}