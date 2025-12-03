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
        
        if (this.onWarningComplete) {
          this.onWarningComplete(completedWarning)
        }
      } else {
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
    
    
    this.completedWarnings.forEach(warning => {
      if (!stats[warning.type]) {
        stats[warning.type] = { count: 0, totalDuration: 0, events: [] }
      }
      stats[warning.type].count++
      stats[warning.type].totalDuration += warning.duration || 0
      stats[warning.type].events.push(warning)
    })
    
    return stats
  }

  endAllActiveWarnings(): void {
    const activeTypes = Array.from(this.activeWarnings.keys())
    activeTypes.forEach(type => this.endWarning(type))
  }

  clear(): void {
    this.activeWarnings.clear()
    this.completedWarnings = []
  }
}