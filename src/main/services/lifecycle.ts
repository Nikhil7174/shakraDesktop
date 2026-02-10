export interface Service {
  name: string
  initialize(): Promise<void>
  shutdown(): Promise<void>
}

export class LifecycleManager {
  private services: Service[] = []
  private isShuttingDown = false

  register(service: Service) {
    this.services.push(service)
  }

  async start() {
    console.log('[Lifecycle] Starting services...')
    for (const service of this.services) {
      try {
        console.log(`[Lifecycle] Starting ${service.name}...`)
        await service.initialize()
        console.log(`[Lifecycle] ✓ ${service.name} started`)
      } catch (error) {
        console.error(`[Lifecycle] ✗ Failed to start ${service.name}:`, error)
        await this.stop()
        throw error
      }
    }
    console.log('[Lifecycle] All services started successfully')
  }

  async stop() {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    
    console.log('[Lifecycle] Stopping services...')
    // Stop in reverse order
    for (const service of [...this.services].reverse()) {
      try {
        console.log(`[Lifecycle] Stopping ${service.name}...`)
        await service.shutdown()
        console.log(`[Lifecycle] ✓ ${service.name} stopped`)
      } catch (error) {
        console.error(`[Lifecycle] ✗ Failed to stop ${service.name}:`, error)
      }
    }
    console.log('[Lifecycle] All services stopped')
  }
}









