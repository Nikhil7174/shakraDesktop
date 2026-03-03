import { contextBridge, ipcRenderer } from 'electron'

// ✅ BEST PRACTICE: Expose ONLY what renderer needs
// Never expose full ipcRenderer or require()

// Interview API for voice interview functionality
const interviewAPI = {
  // Interview control
  startInterview: (interviewData: any) => ipcRenderer.invoke('start-interview', interviewData),
  pauseInterview: () => ipcRenderer.invoke('pause-interview'),
  resumeInterview: () => ipcRenderer.invoke('resume-interview'),
  stopInterview: () => ipcRenderer.invoke('stop-interview'),
  // App blocking / security control
  setAppBlockingEnabled: (enabled: boolean) => ipcRenderer.invoke('set-app-blocking-enabled', enabled),
  // Audio streaming (renderer -> main)
  sendAudioChunk: (data: Uint8Array) => ipcRenderer.send('audio-chunk', data),

  // Code analysis
  analyzeCode: (codeData: any) => ipcRenderer.invoke('analyze-code', codeData),
  submitSolution: (code: string, isTimeout?: boolean, timeComplexity?: string, spaceComplexity?: string) =>
    ipcRenderer.invoke('submit-solution', code, isTimeout, timeComplexity, spaceComplexity),

  // Audio permissions
  requestAudioPermissions: () => ipcRenderer.invoke('request-audio-permissions'),

  // Camera permissions
  requestCameraPermissions: () => ipcRenderer.invoke('request-camera-permissions'),

  // Vision security
  sendVisionSecurityData: (data: any) => ipcRenderer.send('vision-security-data', data),
  speakSecurityWarning: (message: string) => ipcRenderer.send('speak-security-warning', message),
  onVisionSecurityAlert: (callback: (alert: any) => void) => {
    ipcRenderer.on('vision-security-alert', (_event, alert) => callback(alert))
  },

  // LiveKit token management

  // Config management
  setAuthToken: (token: string | null) => ipcRenderer.invoke('set-auth-token', token),
  fetchConfig: (authToken: string) => ipcRenderer.invoke('fetch-config', authToken),
  getConfig: () => ipcRenderer.invoke('get-config'),
  refreshConfig: (authToken: string) => ipcRenderer.invoke('refresh-config', authToken),

  // Unfinished interview management
  checkUnfinishedInterview: () => ipcRenderer.invoke('check-unfinished-interview'),
  clearUnfinishedInterview: () => ipcRenderer.invoke('clear-unfinished-interview'),

  // Payload management
  markPayloadSent: () => ipcRenderer.invoke('mark-payload-sent'),

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

  onUserSpeakingStateChange: (callback: (speaking: boolean) => void) => {
    ipcRenderer.on('user-speaking-state-change', (_event, speaking) => callback(speaking))
  },

  onEvaluation: (callback: (evaluation: any) => void) => {
    ipcRenderer.on('evaluation', (_event, evaluation) => callback(evaluation))
  },

  onProgressUpdate: (callback: (progress: { current: number, total: number }) => void) => {
    ipcRenderer.on('progress-update', (_event, progress) => callback(progress))
  },

  onCodeAnalysis: (callback: (analysis: any) => void) => {
    ipcRenderer.on('code-analysis', (_event, analysis) => callback(analysis))
  },

  onInterviewCompleted: (callback: (results: any) => void) => {
    ipcRenderer.on('interview-completed', (_event, results) => callback(results))
  },

  onFinalEvaluationReady: (callback: (payload: any) => void) => {
    ipcRenderer.on('final-evaluation-ready', (_event, payload) => callback(payload))
  },

  onAudioData: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on('audio-data', (_event, data) => callback(data))
  },

  // Skip question confirmation
  onSkipQuestionRequest: (callback: () => void) => {
    ipcRenderer.on('skip-question-request', () => callback())
  },
  confirmSkipQuestion: (confirmed: boolean) =>
    ipcRenderer.invoke('confirm-skip-question', confirmed),

  // Deep Link
  onDeepLink: (callback: (url: string) => void) => {
    const subscription = (_event: any, url: string) => callback(url)
    ipcRenderer.on('deep-link', subscription)
    return () => {
      ipcRenderer.removeListener('deep-link', subscription)
    }
  },
  openExternal: (url: string) => ipcRenderer.send('open-external', url)
}

// Combined API
const electronAPI = {
  ...interviewAPI
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)