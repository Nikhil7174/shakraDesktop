// Centralized type definitions for the Security Agent App
// This file contains all shared interfaces to avoid duplication

// ============================================================================
// CORE SECURITY TYPES
// ============================================================================

export interface SecurityStatus {
  connected: boolean
  blockedApps: string[]
  timestamp: number
  error?: string
  blockedAndKilled?: boolean
  message?: string
}

// ============================================================================
// PROCESS MONITORING TYPES
// ============================================================================

export interface ProcessInfo {
  name: string
  pid: number
  cpu: number
  memory: number
  status: string
}

export interface ProcessStatus {
  totalProcesses: number
  blockedAppsDetected: Array<{
    name: string
    pid: number
    reason: string
  }>
  timestamp: number
  error?: string
  blockedAndKilled?: boolean
  message?: string
}

export interface ProcessStatsData {
  totalProcesses: number
  blockedAppsDetected: Array<{
    name: string
    pid: number
    reason?: string
  }>
  systemInfo: {
    cpuUsage: number
    memoryUsage: number
    uptime: number
  }
  recentProcesses: ProcessInfo[]
  timestamp: number
  error?: string
}

export interface ProcessKillNotification {
  processName: string
  pid: number
  reason: string
  timestamp: number
}


// ============================================================================
// NETWORK TRAFFIC MONITORING TYPES
// ============================================================================

export interface NetworkRequest {
  timestamp: number
  method: string
  url: string
  domain: string
  service: string
  processName: string
  pid: number
  responseCode?: number
  size?: number
}

export interface NetworkTrafficStatus {
  recentRequests: NetworkRequest[]
  totalRequests: number
  aiApiRequests: NetworkRequest[]
  timestamp: number
  error?: string
}

// ============================================================================
// BROWSER AI MONITORING TYPES
// ============================================================================

export interface BrowserAIActivity {
  timestamp: number
  browser: string
  processName: string
  pid: number
  connectionType: string
  remoteAddress: string
  service: string
  confidence: 'high' | 'medium' | 'low'
}

export interface BrowserAIStatus {
  recentActivity: BrowserAIActivity[]
  totalActivity: number
  highConfidenceActivity: BrowserAIActivity[]
  timestamp: number
  error?: string
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export interface ProcessMonitorProps {
  onStatusUpdate: (status: SecurityStatus) => void
}


export interface ProcessStatsProps {
  isVisible: boolean
  onClose: () => void
}

// ============================================================================
// INTERVIEW TYPES
// ============================================================================

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

export interface Evaluation {
  questionId: string
  candidateAnswer: string
  keyPointsCovered: string[]
  score: number
  needsFollowUp: boolean
  followUpQuestion?: string
  feedback: string
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

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata: {
    type: 'question' | 'answer' | 'hint' | 'clarification' | 'followup' | 'feedback' | 'code_submission' | 'code_analysis' | 'transition' | 'skip_question'
    questionId?: string  // Link to original question
    evaluation?: {
      score?: number
      keyPointsCovered?: string[]
      needsFollowUp?: boolean
    }
    hintLevel?: 1 | 2  // For hints
    section?: 'theoretical' | 'coding'  // Which section of interview
    codingProblemId?: string  // For coding section messages
  }
}

export interface InterviewSession {
  id: string
  candidateId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  startTime: Date
  endTime?: Date
  status: 'scheduled' | 'in_progress' | 'completed'
  // Conversation history fields
  conversationHistory?: ConversationMessage[]  // Full chronological history
  theoreticalConversations?: {
    questionId: string
    question: string
    conversation: ConversationMessage[]  // Subset for this question
    evaluations: Evaluation[]
  }[]
  codingConversations?: {
    problemId: string
    problem: CodingProblem
    conversation: ConversationMessage[]  // Verbal conversation during coding
    finalCode?: string
    timeComplexity?: string
    spaceComplexity?: string
    codeAnalysisHistory: CodeAnalysis[]  // Progress snapshots
    submittedAt?: Date
    evaluation?: {
      score: number
      feedback: string
      testResults?: Array<{
        passed: boolean
        input: string
        expectedOutput: string
        actualOutput: string
      }>
    }
  }[]
}

export interface FinalEvaluationPayload {
  // Session metadata
  sessionId: string
  candidateId: string
  interviewLinkId?: number
  startTime: string  // ISO string for JSON serialization
  endTime: string    // ISO string for JSON serialization
  duration: number   // milliseconds

  // Full chronological conversation (all sections)
  // This is the complete interview transcript in order
  fullConversationHistory: ConversationMessage[]

  // Structured breakdowns for easy analysis
  theoreticalSection: {
    questions: Question[]
    conversations: {
      questionId: string
      question: string
      conversation: ConversationMessage[]  // All interactions for this question
      evaluations: Evaluation[]
      totalScore: number
    }[]
    overallScore: number
    totalQuestions: number
  }

  codingSection: {
    problems: CodingProblem[]
    conversations: {
      problemId: string
      problem: CodingProblem
      conversation: ConversationMessage[]  // Verbal conversation during coding
      finalCode?: string
      timeComplexity?: string
      spaceComplexity?: string
      codeAnalysisHistory: CodeAnalysis[]  // Progress snapshots over time
      submittedAt?: string  // ISO string
      evaluation?: {
        score: number
        feedback: string
        testResults?: Array<{
          passed: boolean
          input: string
          expectedOutput: string
          actualOutput: string
        }>
      }
    }[]
    overallScore: number
    totalProblems: number
  }

  // Summary metrics
  totalScore: number
  strengths: string[]
  areasForImprovement: string[]
  overallFeedback: string

  // Additional metadata
  hintRequestCount: number
  clarificationRequestCount: number
  followUpCount: number
  averageTimePerQuestion: number
  averageTimePerCodingProblem: number
}

// ============================================================================
// SECURITY AGENT API TYPES
// ============================================================================

export interface SecurityAgentAPI {
  getStatus: () => Promise<SecurityStatus>
  onStatusUpdate: (callback: (status: SecurityStatus) => void) => void
  getProcessStats: () => Promise<ProcessStatsData>
  onProcessStatsUpdate: (callback: (stats: ProcessStatsData) => void) => void
}

// ============================================================================
// VISION SECURITY TYPES
// ============================================================================

export type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'away'

export type SuspiciousHandPattern = 'phone_usage' | 'typing' | 'hand_near_face' | 'hand_near_ear' | 'rapid_movement'

export type SuspiciousEvent = {
  type: 'gaze_away' | 'multiple_faces' | 'face_absent' | 'abnormal_blink' | 'suspicious_hand_pattern'
  timestamp: number
  severity: 'low' | 'medium' | 'high'
  description: string
  duration?: number // milliseconds
}

export interface VisionSecurityStatus {
  gazeDirection: GazeDirection
  blinkRate: number // blinks per minute
  faceDetected: boolean
  multipleFacesDetected: boolean
  facePresenceConfidence: number // 0-1
  gazeAwayDuration: number // milliseconds
  handsDetected: boolean
  handCount: number
  suspiciousHandPatterns: SuspiciousHandPattern[]
  handMovementIntensity: number // 0-1, indicating rapid hand movements
  suspiciousEvents: SuspiciousEvent[]
  timestamp: number
}


