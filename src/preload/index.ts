import { contextBridge, ipcRenderer } from 'electron'
import { 
  SecurityAgentAPI, 
  SecurityStatus, 
  ProcessStatsData
} from '../shared/types'

// ✅ BEST PRACTICE: Expose ONLY what renderer needs
// Never expose full ipcRenderer or require()
const securityAgentAPI: SecurityAgentAPI = {
  getStatus: () => ipcRenderer.invoke('get-status'),
  
  onStatusUpdate: (callback: (status: SecurityStatus) => void) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status))
  },

  getProcessStats: () => ipcRenderer.invoke('get-process-stats'),
  
  onProcessStatsUpdate: (callback: (stats: ProcessStatsData) => void) => {
    ipcRenderer.on('process-stats-update', (_event, stats) => callback(stats))
  }
}

// Interview API for voice interview functionality
const interviewAPI = {
  // Interview control
  startInterview: (interviewData: any) => ipcRenderer.invoke('start-interview', interviewData),
  pauseInterview: () => ipcRenderer.invoke('pause-interview'),
  resumeInterview: () => ipcRenderer.invoke('resume-interview'),
  stopInterview: () => ipcRenderer.invoke('stop-interview'),
  // Audio streaming (renderer -> main)
  sendAudioChunk: (data: Uint8Array) => ipcRenderer.send('audio-chunk', data),
  
  // Code analysis
  analyzeCode: (codeData: any) => ipcRenderer.invoke('analyze-code', codeData),
  submitSolution: (code: string) => ipcRenderer.invoke('submit-solution', code),
  
  // Audio permissions
  requestAudioPermissions: () => ipcRenderer.invoke('request-audio-permissions'),
  
  // STT token management
  getSTTToken: () => ipcRenderer.invoke('get-stt-token'),
  updateSTTToken: (token: string) => ipcRenderer.invoke('update-stt-token', token),
  
  // Unfinished interview management
  checkUnfinishedInterview: () => ipcRenderer.invoke('check-unfinished-interview'),
  clearUnfinishedInterview: () => ipcRenderer.invoke('clear-unfinished-interview'),
  
  // Event listeners
  onAudioCaptureRequired: (callback: () => void) => {
    ipcRenderer.on('audio-capture-required', () => callback())
  },
  onInterviewStateChange: (callback: (state: string) => void) => {
    ipcRenderer.on('interview-state-change', (_event, state) => callback(state))
  },
  
  onQuestionChanged: (callback: (question: any) => void) => {
    ipcRenderer.on('question-changed', (_event, question) => callback(question))
  },
  
  onFollowUpAsked: (callback: (followUpText: string) => void) => {
    ipcRenderer.on('follow-up-asked', (_event, followUpText) => callback(followUpText))
  },
  
  onCodingProblemChanged: (callback: (problem: any) => void) => {
    ipcRenderer.on('coding-problem-changed', (_event, problem) => callback(problem))
  },
  
  onListeningStateChange: (callback: (listening: boolean) => void) => {
    ipcRenderer.on('listening-state-change', (_event, listening) => callback(listening))
  },
  
  onSpeakingStateChange: (callback: (speaking: boolean) => void) => {
    ipcRenderer.on('speaking-state-change', (_event, speaking) => callback(speaking))
  },
  
  onEvaluation: (callback: (evaluation: any) => void) => {
    ipcRenderer.on('evaluation', (_event, evaluation) => callback(evaluation))
  },
  
  onCodeAnalysis: (callback: (analysis: any) => void) => {
    ipcRenderer.on('code-analysis', (_event, analysis) => callback(analysis))
  },
  
  onInterviewCompleted: (callback: (results: any) => void) => {
    ipcRenderer.on('interview-completed', (_event, results) => callback(results))
  },
  
  onAudioData: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on('audio-data', (_event, data) => callback(data))
  }
}

// Combined API
const electronAPI = {
  ...securityAgentAPI,
  ...interviewAPI
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)