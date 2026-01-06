import { Service } from './lifecycle'
import { ProcessMonitor } from '../process-monitor'

export class SecurityService implements Service {
  name = 'security'
  private monitor: ProcessMonitor | null = null

  async initialize(): Promise<void> {
    this.monitor = new ProcessMonitor()
    this.monitor.start()
  }

  async shutdown(): Promise<void> {
    this.monitor?.stop()
    this.monitor = null
  }
}






