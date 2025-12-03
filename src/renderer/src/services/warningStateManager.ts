interface WarningEvent {
  type: string
  startTime: number
  endTime?: number
  duration?: number
  sessionId?: string
}

interface ActiveWarning {
  type: string
  startTime: number
}

export class WarningStateManager {
  private activeWarnings: Map<string, ActiveWarning> = new Map()
  private completedWarnings: WarningEvent[] = []
  private onWarningComplete?: (warning: WarningEvent) => void
  private thresholds: { [key: string]: number }

  constructor(thresholds: { [key: string]: number }, onWarningComplete?: (warning: WarningEvent) => void) {
    this.thresholds = thresholds
    this.onWarningComplete = onWarningComplete
  }

  startWarning(type: string): void {
    if (!this.activeWarnings.has(type)) {
      const warning: ActiveWarning = {
        type,
        startTime: Date.now()
      }
      this.activeWarnings.set(type, warning)
      // Debug log removed to reduce per-frame noise
    }
  }

  endWarning(type: string): void {
    const activeWarning = this.activeWarnings.get(type)
    if (activeWarning) {
      const endTime = Date.now()
      const duration = endTime - activeWarning.startTime
      
      // Only store if duration exceeds threshold
      const threshold = this.thresholds[type] || 0
      console.log(`[WarningStateManager] Ending ${type}: duration=${duration}ms, threshold=${threshold}ms, willStore=${duration >= threshold}`)
      
      if (duration >= threshold) {
        const completedWarning: WarningEvent = {
          type: activeWarning.type,
          startTime: activeWarning.startTime,
          endTime,
          duration
        }

        this.completedWarnings.push(completedWarning)
        console.log(`[WarningStateManager] ✅ Stored ${type} warning (${Math.round(duration/1000)}s). Total completed: ${this.completedWarnings.length}`)
        
        if (this.onWarningComplete) {
          this.onWarningComplete(completedWarning)
        }
      } else {
        console.log(`[WarningStateManager] ⏭️ Skipped ${type} - below threshold (${duration}ms < ${threshold}ms)`)
      }
      
      this.activeWarnings.delete(type)
    }
  }

  isWarningActive(type: string): boolean {
    return this.activeWarnings.has(type)
  }

  getActiveWarnings(): ActiveWarning[] {
    return Array.from(this.activeWarnings.values())
  }

  getCompletedWarnings(): WarningEvent[] {
    return [...this.completedWarnings]
  }

  getWarningStats(): { [key: string]: { count: number; totalDuration: number; events: WarningEvent[] } } {
    const stats: { [key: string]: { count: number; totalDuration: number; events: WarningEvent[] } } = {}
    
    console.log(`[WarningStateManager] Getting stats from ${this.completedWarnings.length} completed warnings`)
    console.log(`[WarningStateManager] Active warnings: ${this.activeWarnings.size}`, Array.from(this.activeWarnings.keys()))
    
    this.completedWarnings.forEach(warning => {
      if (!stats[warning.type]) {
        stats[warning.type] = { count: 0, totalDuration: 0, events: [] }
      }
      stats[warning.type].count++
      stats[warning.type].totalDuration += warning.duration || 0
      stats[warning.type].events.push(warning)
    })
    
    console.log(`[WarningStateManager] Returning stats with ${Object.keys(stats).length} warning types`)
    Object.keys(stats).forEach(type => {
      console.log(`[WarningStateManager]   - ${type}: ${stats[type].count} events, ${Math.round(stats[type].totalDuration / 1000)}s total`)
    })
    
    return stats
  }

  endAllActiveWarnings(): void {
    const activeTypes = Array.from(this.activeWarnings.keys())
    console.log(`[WarningStateManager] 🚨 endAllActiveWarnings called. Active: ${activeTypes.length}, Completed: ${this.completedWarnings.length}`)
    console.log(`[WarningStateManager] Active types:`, activeTypes)
    activeTypes.forEach(type => this.endWarning(type))
    console.log(`[WarningStateManager] ✅ After ending all. Completed: ${this.completedWarnings.length}`)
  }

  clear(): void {
    this.activeWarnings.clear()
    this.completedWarnings = []
  }
}