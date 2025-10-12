import { ElectronAPI } from '@electron-toolkit/preload'
import { SecurityAgentAPI } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    securityAgent: SecurityAgentAPI
  }
}
