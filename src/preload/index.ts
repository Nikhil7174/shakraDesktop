import { contextBridge, ipcRenderer } from 'electron'

// Define typed API
export interface SecurityAgentAPI {
  getStatus: () => Promise<SecurityStatus>
  onStatusUpdate: (callback: (status: SecurityStatus) => void) => void
  getProcessStats: () => Promise<ProcessStatsData>
  onProcessStatsUpdate: (callback: (stats: ProcessStatsData) => void) => void
}

export interface SecurityStatus {
  connected: boolean
  blockedApps: string[]
  timestamp: number
}

export interface ProcessInfo {
  name: string
  pid: number
  cpu: number
  memory: number
  status: string
}

export interface ProcessStatsData {
  totalProcesses: number
  blockedAppsDetected: Array<{ name: string; pid: number; reason?: string }>
  systemInfo: {
    cpuUsage: number
    memoryUsage: number
    uptime: number
  }
  recentProcesses: ProcessInfo[]
  timestamp: number
  error?: string
}

// ✅ BEST PRACTICE: Expose ONLY what renderer needs
// Never expose full ipcRenderer or require()
contextBridge.exposeInMainWorld('securityAgent', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  
  onStatusUpdate: (callback: (status: SecurityStatus) => void) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status))
  },

  getProcessStats: () => ipcRenderer.invoke('get-process-stats'),
  
  onProcessStatsUpdate: (callback: (stats: ProcessStatsData) => void) => {
    ipcRenderer.on('process-stats-update', (_event, stats) => callback(stats))
  }
} as SecurityAgentAPI)