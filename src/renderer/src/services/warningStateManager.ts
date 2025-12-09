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
  private readonly DEBOUNCE_DURATION = 200 // 200ms
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
      clearTimeout(pendingEnd.timeoutId)
      this.pendingEnds.delete(type)
      
      // CRITICAL: If we're starting a new warning, the previous one ended prematurely
      // Check if there's an active warning that should be discarded
      const activeWarning = this.activeWarnings.get(type)
      if (activeWarning) {
        const prematureDuration = now - activeWarning.startTime
        // const threshold = this.thresholds[type] || 0
        
        // If the previous warning didn't meet threshold, discard it silently
        // If it did meet threshold but we're restarting, it means detection flickered
        // In this case, we should KEEP the active warning to merge the events (debounce behavior)
        console.log(`[WarningStateManager] Resuming ${type} warning (current duration=${prematureDuration}ms) - debounce merge`)
        
        // Do NOT remove the active warning - let it continue accumulating duration
        // this.activeWarnings.delete(type) 
      }
    }

    // Check if we should start a new warning (prevent rapid flickering)
    // Only start if one isn't already active (or resumed above)
    if (!this.activeWarnings.has(type)) {
      const lastEndTime = this.lastWarningEndTime.get(type) || 0
      const timeSinceLastEnd = now - lastEndTime
      
      // Don't start a new warning if one just ended recently (prevent flickering)
      if (timeSinceLastEnd < this.MIN_WARNING_GAP && lastEndTime > 0) {
        // Too soon after last warning ended, skip starting new one
        return
      }

      const warning: ActiveWarning = {
        type,
        startTime: now
      }
      this.activeWarnings.set(type, warning)
      // Debug log removed to reduce per-frame noise
    }
  }

  endWarning(type: string): void {
    const activeWarning = this.activeWarnings.get(type)
    if (!activeWarning) {
      return // No active warning to end
    }

    // If there's already a pending end, don't create another one
    if (this.pendingEnds.has(type)) {
      return
    }

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
          
          if (this.onWarningComplete) {
            this.onWarningComplete(completedWarning)
          }
        } else {
          console.warn(`[WarningStateManager] Duplicate warning detected and skipped: ${type}`, completedWarning)
        }
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
    // Cancel all pending ends
    this.pendingEnds.forEach(pending => {
      clearTimeout(pending.timeoutId)
    })
    this.pendingEnds.clear()

    // Immediately end all active warnings (no debounce for final cleanup)
    const activeTypes = Array.from(this.activeWarnings.keys())
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
            
            if (this.onWarningComplete) {
              this.onWarningComplete(completedWarning)
            }
          }
        }
        
        this.activeWarnings.delete(type)
        this.lastWarningEndTime.set(type, endTime)
      }
    })
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