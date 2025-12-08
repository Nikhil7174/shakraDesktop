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

interface PendingEnd {
  type: string
  scheduledEndTime: number
  timeoutId: ReturnType<typeof setTimeout>
}

export class WarningStateManager {
  private activeWarnings: Map<string, ActiveWarning> = new Map()
  private completedWarnings: WarningEvent[] = []
  private onWarningComplete?: (warning: WarningEvent) => void
  private thresholds: { [key: string]: number }
  private pendingEnds: Map<string, PendingEnd> = new Map()
  private lastWarningEndTime: Map<string, number> = new Map()
  
  // Debounce: Only end warning if condition is false for this duration
  private readonly DEBOUNCE_DURATION = 500 // 500ms
  // Minimum gap between warnings of the same type to prevent rapid flickering
  private readonly MIN_WARNING_GAP = 1000 // 1 second

  constructor(thresholds: { [key: string]: number }, onWarningComplete?: (warning: WarningEvent) => void) {
    this.thresholds = thresholds
    this.onWarningComplete = onWarningComplete
  }

  startWarning(type: string): void {
    const now = Date.now()
    
    // Cancel any pending end for this warning type
    const pendingEnd = this.pendingEnds.get(type)
    if (pendingEnd) {
      // Cancel the pending end - the warning condition is true again
      // so we want to keep the current warning active (don't end it)
      clearTimeout(pendingEnd.timeoutId)
      this.pendingEnds.delete(type)
      console.log(`[WarningStateManager] Cancelled pending end for ${type}, keeping warning active`)
      // If warning is already active, we're done (just keep it active)
      // If warning is not active, we need to start a new one below
    }

    // Check if we should start a new warning (prevent rapid flickering)
    if (!this.activeWarnings.has(type)) {
      const lastEndTime = this.lastWarningEndTime.get(type) || 0
      const timeSinceLastEnd = now - lastEndTime
      
      // Don't start a new warning if one just ended recently (prevent flickering)
      if (timeSinceLastEnd < this.MIN_WARNING_GAP && lastEndTime > 0) {
        console.log(`[WarningStateManager] Skipping ${type} start - too soon after last end (${timeSinceLastEnd}ms < ${this.MIN_WARNING_GAP}ms)`)
        // Too soon after last warning ended, skip starting new one
        return
      }

      const warning: ActiveWarning = {
        type,
        startTime: now
      }
      this.activeWarnings.set(type, warning)
      console.log(`[WarningStateManager] ✅ Started warning: ${type} at ${now}`)
    }
  }

  endWarning(type: string): void {
    const activeWarning = this.activeWarnings.get(type)
    if (!activeWarning) {
      // console.log(`[WarningStateManager] No active warning to end for ${type}`)
      return // No active warning to end
    }

    // If there's already a pending end, don't create another one
    if (this.pendingEnds.has(type)) {
      // console.log(`[WarningStateManager] Pending end already exists for ${type}`)
      return
    }

    const currentDuration = Date.now() - activeWarning.startTime
    console.log(`[WarningStateManager] Scheduling end for ${type} (current duration: ${currentDuration}ms, threshold: ${this.thresholds[type]}ms)`)

    // Schedule the actual end after debounce duration
    const timeoutId = setTimeout(() => {
      // Check if warning is still active (might have been restarted)
      const stillActive = this.activeWarnings.get(type)
      if (!stillActive || stillActive.startTime !== activeWarning.startTime) {
        // Warning was restarted or doesn't exist, cancel this end
        this.pendingEnds.delete(type)
        return
      }

      // Actually end the warning
      const endTime = Date.now()
      const duration = endTime - activeWarning.startTime
      
      // Only store if duration exceeds threshold
      const threshold = this.thresholds[type] || 0
      console.log(`[WarningStateManager] Ending ${type}: duration=${duration}ms, threshold=${threshold}ms, willStore=${duration >= threshold}`)
      
      // Store warning if it meets threshold
      if (duration >= threshold) {
          const completedWarning: WarningEvent = {
            type: activeWarning.type,
            startTime: activeWarning.startTime,
            endTime,
            duration
          }

          // Check for duplicate before adding
          const isDuplicate = this.completedWarnings.some(w => 
            w.type === completedWarning.type &&
            w.startTime === completedWarning.startTime &&
            w.endTime === completedWarning.endTime
          )
          
          if (!isDuplicate) {
            this.completedWarnings.push(completedWarning)
            console.log(`[WarningStateManager] ✅ Stored completed warning: ${type}, duration=${duration}ms, total completed: ${this.completedWarnings.length}`)
            
            if (this.onWarningComplete) {
              this.onWarningComplete(completedWarning)
            }
          } else {
            console.warn(`[WarningStateManager] Duplicate warning detected and skipped: ${type}`, completedWarning)
          }
        } else {
          console.log(`[WarningStateManager] ⏭️ Skipping ${type} - duration ${duration}ms < threshold ${threshold}ms`)
        }
      
      this.activeWarnings.delete(type)
      this.pendingEnds.delete(type)
      this.lastWarningEndTime.set(type, endTime)
    }, this.DEBOUNCE_DURATION)

    this.pendingEnds.set(type, {
      type,
      scheduledEndTime: Date.now() + this.DEBOUNCE_DURATION,
      timeoutId
    })
  }

  isWarningActive(type: string): boolean {
    return this.activeWarnings.has(type)
  }

  isWarningStillActive(type: string, startTime: number): boolean {
    const activeWarning = this.activeWarnings.get(type)
    return activeWarning !== undefined && activeWarning.startTime === startTime
  }

  getActiveWarnings(): ActiveWarning[] {
    return Array.from(this.activeWarnings.values())
  }

  getActiveWarning(type: string): ActiveWarning | undefined {
    return this.activeWarnings.get(type)
  }

  getCompletedWarnings(): WarningEvent[] {
    return [...this.completedWarnings]
  }

  getWarningStats(): { [key: string]: { count: number; totalDuration: number; events: WarningEvent[] } } {
    const stats: { [key: string]: { count: number; totalDuration: number; events: WarningEvent[] } } = {}
    
    console.log(`[WarningStateManager] getWarningStats called - total completed warnings: ${this.completedWarnings.length}`)
    this.completedWarnings.forEach(warning => {
      console.log(`[WarningStateManager] Processing completed warning: ${warning.type}, duration=${warning.duration}ms`)
      if (!stats[warning.type]) {
        stats[warning.type] = { count: 0, totalDuration: 0, events: [] }
      }
      stats[warning.type].count++
      stats[warning.type].totalDuration += warning.duration || 0
      stats[warning.type].events.push(warning)
    })
    
    console.log(`[WarningStateManager] getWarningStats returning:`, Object.keys(stats).map(type => `${type}: ${stats[type].count} events`).join(', '))
    return stats
  }

  endAllActiveWarnings(): { [key: string]: { count: number; totalDuration: number; events: WarningEvent[] } } {
    console.log(`[WarningStateManager] endAllActiveWarnings called - active warnings: ${this.activeWarnings.size}`)
    
    // Cancel all pending ends
    this.pendingEnds.forEach(pending => {
      clearTimeout(pending.timeoutId)
    })
    this.pendingEnds.clear()

    // Immediately end all active warnings (no debounce for final cleanup)
    const activeTypes = Array.from(this.activeWarnings.keys())
    console.log(`[WarningStateManager] Ending ${activeTypes.length} active warnings:`, activeTypes)
    activeTypes.forEach(type => {
      const activeWarning = this.activeWarnings.get(type)
      if (activeWarning) {
        const endTime = Date.now()
        const duration = endTime - activeWarning.startTime
        const threshold = this.thresholds[type] || 0
        
        if (duration >= threshold) {
          const completedWarning: WarningEvent = {
            type: activeWarning.type,
            startTime: activeWarning.startTime,
            endTime,
            duration
          }

          // Check for duplicate before adding
          const isDuplicate = this.completedWarnings.some(w => 
            w.type === completedWarning.type &&
            w.startTime === completedWarning.startTime &&
            w.endTime === completedWarning.endTime
          )
          
          if (!isDuplicate) {
            this.completedWarnings.push(completedWarning)
            console.log(`[WarningStateManager] ✅ Stored final warning: ${type}, duration=${duration}ms, total completed: ${this.completedWarnings.length}`)
            
            if (this.onWarningComplete) {
              this.onWarningComplete(completedWarning)
            }
          }
        } else {
          console.log(`[WarningStateManager] ⏭️ Skipping final ${type} - duration ${duration}ms < threshold ${threshold}ms`)
        }
        
        this.activeWarnings.delete(type)
        this.lastWarningEndTime.set(type, endTime)
      }
    })
    
    // Return stats after ending all warnings
    const finalStats = this.getWarningStats()
    console.log(`[WarningStateManager] endAllActiveWarnings complete - returning stats with ${Object.keys(finalStats).length} warning types`)
    return finalStats
  }

  clear(): void {
    // Cancel all pending ends
    this.pendingEnds.forEach(pending => {
      clearTimeout(pending.timeoutId)
    })
    this.pendingEnds.clear()
    
    this.activeWarnings.clear()
    this.completedWarnings = []
    this.lastWarningEndTime.clear()
  }
}