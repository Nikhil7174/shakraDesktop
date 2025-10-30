import { ElectronAPI } from '@electron-toolkit/preload'
import { SecurityAgentAPI } from '../shared/types'

type InterviewAPI = {
  startInterview: (interviewData: any) => Promise<{ success: boolean; error?: string }>
  pauseInterview: () => Promise<{ success: boolean; error?: string }>
  resumeInterview: () => Promise<{ success: boolean; error?: string }>
  stopInterview: () => Promise<{ success: boolean; error?: string }>
  analyzeCode: (codeData: any) => Promise<{ success: boolean; analysis?: any; error?: string }>
  submitSolution: (code: string) => Promise<{ success: boolean; error?: string; hasNextProblem?: boolean; feedback?: string }>
  requestAudioPermissions: () => Promise<{ success: boolean; error?: string }>
  sendAudioChunk: (data: Uint8Array) => void
  getSTTToken: () => Promise<{ success: boolean; token?: string; error?: string }>
  updateSTTToken: (token: string) => Promise<{ success: boolean; error?: string }>
  checkUnfinishedInterview: () => Promise<{ hasUnfinished: boolean; sessionInfo?: any; error?: string }>
  clearUnfinishedInterview: () => Promise<{ success: boolean; error?: string }>
  onAudioCaptureRequired: (callback: () => void) => void
  onInterviewStateChange: (callback: (state: string) => void) => void
  onQuestionChanged: (callback: (question: any) => void) => void
  onCodingProblemChanged: (callback: (problem: any) => void) => void
  onListeningStateChange: (callback: (listening: boolean) => void) => void
  onSpeakingStateChange: (callback: (speaking: boolean) => void) => void
  onEvaluation: (callback: (evaluation: any) => void) => void
  onCodeAnalysis: (callback: (analysis: any) => void) => void
  onInterviewCompleted: (callback: (results: any) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    securityAgent: SecurityAgentAPI
    electronAPI: SecurityAgentAPI & InterviewAPI
  }
}
