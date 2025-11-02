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
  hintLevel: 1 | 2 | 3
  timeStuck: number // milliseconds
  codeQuality: 'good' | 'fair' | 'poor'
  testable: boolean
}

export interface InterviewSession {
  id: string
  candidateId: string
  questions: Question[]
  codingProblems: CodingProblem[]
  startTime: Date
  endTime?: Date
  status: 'scheduled' | 'in_progress' | 'completed'
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


