import { contextBridge, ipcRenderer } from 'electron'
import { 
  SecurityAgentAPI, 
  SecurityStatus, 
  ProcessStatsData
} from '../shared/types'

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