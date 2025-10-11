import { ElectronAPI } from '@electron-toolkit/preload'
import { SecurityAgentAPI, ProcessStatsData, ProcessInfo } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    securityAgent: SecurityAgentAPI
  }
}
