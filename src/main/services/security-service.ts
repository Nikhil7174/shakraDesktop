import { ipcMain } from 'electron'
import { Service } from './lifecycle'
import { ProcessMonitor } from '../process-monitor'

export class SecurityService implements Service {
  name = 'security'
  private monitor: ProcessMonitor | null = null
  private monitoringEnabled = false

  async initialize(): Promise<void> {
    this.monitor = new ProcessMonitor()

    // Default: DO NOT start monitoring until an interview is active.
    // Renderer explicitly enables/disables blocking via IPC.
    ipcMain.handle('set-app-blocking-enabled', async (_event, enabled: boolean) => {
      try {
        if (!this.monitor) {
          this.monitor = new ProcessMonitor()
        }

        if (enabled && !this.monitoringEnabled) {
          this.monitor.start()
          this.monitoringEnabled = true
          console.log('🔒 [Security] App blocking enabled')
        } else if (!enabled && this.monitoringEnabled) {
          this.monitor.stop()
          this.monitoringEnabled = false
          console.log('🔓 [Security] App blocking disabled')
        }

        return { success: true, enabled: this.monitoringEnabled }
      } catch (error) {
        console.error('❌ [Security] Failed to toggle app blocking:', error)
        return { success: false, enabled: this.monitoringEnabled, error: String(error) }
      }
    })
  }

  async shutdown(): Promise<void> {
    if (this.monitoringEnabled && this.monitor) {
      this.monitor.stop()
    }
    this.monitor = null
    this.monitoringEnabled = false
  }
}









