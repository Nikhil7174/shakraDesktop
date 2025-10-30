import { EventEmitter } from 'events'
import axios from 'axios'

export interface CodingProblem {
  id: string
  title: string
  description: string
  language: string
  starterCode?: string
  solution: string
  hints: string[]
  testCases: TestCase[]
  difficulty: 'easy' | 'medium' | 'hard'
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
  hintLevel: 1 | 2 | 3
  timeStuck: number // milliseconds
  codeQuality: 'good' | 'fair' | 'poor'
  testable: boolean
}

export interface Observation {
  timestamp: number
  code: string
  analysis: CodeAnalysis
}

export class CodeAnalysisService extends EventEmitter {
  private serverUrl: string
  private observations: Observation[] = []
  private currentProblem: CodingProblem | null = null
  private startTime: number = 0
  // private lastAnalysisTime: number = 0
  private stuckStartTime: number = 0
  private isStuck: boolean = false

  constructor(serverUrl: string) {
    super()
    this.serverUrl = serverUrl
  }

  async analyzeCode(code: string, problem: CodingProblem): Promise<CodeAnalysis> {
    try {
      const response = await axios.post(`${this.serverUrl}/api/llm/analyze-code`, {
        code,
        problem: problem.description,
        language: problem.language
      })

      if (response.data.success) {
        const analysis = response.data.analysis
        
        // Store observation
        const observation: Observation = {
          timestamp: Date.now(),
          code,
          analysis
        }
        this.observations.push(observation)

        // Update stuck state
        this.updateStuckState(analysis)

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

  async evaluateApproach(verbalExplanation: string, problem: CodingProblem): Promise<{
    isApproach: boolean
    isCorrect?: boolean
    isClarification: boolean
    feedback?: string
    clarification?: string
  }> {
    try {
      const response = await axios.post(`${this.serverUrl}/api/llm/evaluate-coding-approach`, {
        explanation: verbalExplanation,
        problem: {
          title: problem.title,
          description: problem.description,
          constraints: problem.hints,
          language: problem.language
        }
      })

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

  private updateStuckState(analysis: CodeAnalysis): void {
    const now = Date.now()
    
    if (analysis.isStuck && !this.isStuck) {
      // Just got stuck
      this.isStuck = true
      this.stuckStartTime = now
    } else if (!analysis.isStuck && this.isStuck) {
      // No longer stuck
      this.isStuck = false
      this.stuckStartTime = 0
    }

    // Update time stuck
    if (this.isStuck) {
      analysis.timeStuck = now - this.stuckStartTime
    } else {
      analysis.timeStuck = 0
    }
  }

  async getHint(problem: CodingProblem, currentCode: string, hintLevel: 1 | 2 | 3 = 1): Promise<string> {
    try {
      // First analyze the current code
      const analysis = await this.analyzeCode(currentCode, problem)
      
      if (analysis.suggestedHint) {
        return analysis.suggestedHint
      }

      // Generate hint based on level
      const hintContext = hintLevel === 1 
        ? "Provide a gentle hint about the approach"
        : hintLevel === 2
        ? "Provide a moderate hint about the implementation"
        : "Provide a direct hint about the solution"

      const response = await axios.post(`${this.serverUrl}/api/llm/generate-response`, {
        context: `${hintContext}. Coding problem: ${problem.description}. Current code: ${currentCode}.`,
        conversationHistory: []
      })

      if (response.data.success) {
        return response.data.response
      } else {
        return this.getDefaultHint(problem, hintLevel)
      }
    } catch (error) {
      console.error('Error generating hint:', error)
      return this.getDefaultHint(problem, hintLevel)
    }
  }

  private getDefaultHint(problem: CodingProblem, hintLevel: 1 | 2 | 3): string {
    const hints = problem.hints || []
    
    if (hints.length > 0) {
      const hintIndex = Math.min(hintLevel - 1, hints.length - 1)
      return hints[hintIndex]
    }

    // Fallback hints based on level
    const fallbackHints = {
      1: "Think about the problem step by step. What's the first thing you need to do?",
      2: "Consider the data structures and algorithms that might be useful here.",
      3: "Look at the test cases to understand the expected input and output format."
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
}

export function createCodeAnalysisService(serverUrl: string): CodeAnalysisService {
  return new CodeAnalysisService(serverUrl)
}