import { EventEmitter } from 'events'

export interface ErrorContext {
  service: string
  operation: string
  timestamp: number
  retryCount?: number
  originalError?: Error
}

export interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

export class ErrorHandler extends EventEmitter {
  private retryConfigs: Map<string, RetryConfig> = new Map()
  private errorCounts: Map<string, number> = new Map()

  constructor() {
    super()
    this.initializeRetryConfigs()
  }

  private initializeRetryConfigs() {
    // STT service retry config
    this.retryConfigs.set('stt', {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2
    })

    // LLM service retry config
    this.retryConfigs.set('llm', {
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 15000,
      backoffMultiplier: 2
    })

    // TTS service retry config
    this.retryConfigs.set('tts', {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 8000,
      backoffMultiplier: 1.5
    })

    // Code analysis retry config
    this.retryConfigs.set('codeAnalysis', {
      maxRetries: 2,
      baseDelay: 1500,
      maxDelay: 12000,
      backoffMultiplier: 2
    })
  }

  async handleError(
    error: Error,
    context: ErrorContext,
    retryFunction?: () => Promise<any>
  ): Promise<any> {
    const errorKey = `${context.service}:${context.operation}`
    const currentCount = this.errorCounts.get(errorKey) || 0
    this.errorCounts.set(errorKey, currentCount + 1)

    // Log error
    console.error(`Error in ${context.service}.${context.operation}:`, {
      message: error.message,
      stack: error.stack,
      context,
      retryCount: currentCount
    })

    // Emit error event
    this.emit('error', {
      error,
      context,
      retryCount: currentCount
    })

    // Check if we should retry
    const retryConfig = this.retryConfigs.get(context.service)
    if (retryConfig && retryFunction && currentCount < retryConfig.maxRetries) {
      const delay = this.calculateRetryDelay(retryConfig, currentCount)
      
      console.log(`Retrying ${context.service}.${context.operation} in ${delay}ms (attempt ${currentCount + 1}/${retryConfig.maxRetries})`)
      
      await this.delay(delay)
      
      try {
        return await retryFunction()
      } catch (retryError) {
        return this.handleError(retryError as Error, {
          ...context,
          retryCount: currentCount + 1,
          originalError: error
        }, retryFunction)
      }
    }

    // Max retries exceeded or no retry function
    this.emit('maxRetriesExceeded', {
      error,
      context,
      retryCount: currentCount
    })

    throw error
  }

  private calculateRetryDelay(config: RetryConfig, retryCount: number): number {
    const delay = config.baseDelay * Math.pow(config.backoffMultiplier, retryCount)
    return Math.min(delay, config.maxDelay)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Service-specific error handlers
  async handleSTTError(error: Error, operation: string, retryFunction?: () => Promise<any>) {
    return this.handleError(error, {
      service: 'stt',
      operation,
      timestamp: Date.now()
    }, retryFunction)
  }

  async handleLLMError(error: Error, operation: string, retryFunction?: () => Promise<any>) {
    return this.handleError(error, {
      service: 'llm',
      operation,
      timestamp: Date.now()
    }, retryFunction)
  }

  async handleTTSError(error: Error, operation: string, retryFunction?: () => Promise<any>) {
    return this.handleError(error, {
      service: 'tts',
      operation,
      timestamp: Date.now()
    }, retryFunction)
  }

  async handleCodeAnalysisError(error: Error, operation: string, retryFunction?: () => Promise<any>) {
    return this.handleError(error, {
      service: 'codeAnalysis',
      operation,
      timestamp: Date.now()
    }, retryFunction)
  }

  // Circuit breaker pattern
  isServiceHealthy(service: string): boolean {
    const errorKey = service
    const errorCount = this.errorCounts.get(errorKey) || 0
    return errorCount < 5 // Allow up to 5 errors before considering unhealthy
  }

  resetErrorCount(service: string) {
    this.errorCounts.delete(service)
  }

  getErrorStats(): { [service: string]: number } {
    const stats: { [service: string]: number } = {}
    for (const [key, count] of this.errorCounts.entries()) {
      stats[key] = count
    }
    return stats
  }

  // Graceful degradation
  getFallbackResponse(service: string, _operation: string): any {
    switch (service) {
      case 'stt':
        return {
          text: '[Audio transcription unavailable]',
          isFinal: true,
          confidence: 0,
          timestamp: Date.now()
        }
      
      case 'llm':
        return {
          text: 'I apologize, but I\'m experiencing technical difficulties. Please try again.',
          action: 'speak'
        }
      
      case 'tts':
        return {
          audio: Buffer.alloc(0),
          duration: 0,
          text: '[Audio generation unavailable]'
        }
      
      case 'codeAnalysis':
        return {
          progress: 0,
          approach: 'unsure',
          isStuck: false,
          issues: ['Analysis unavailable'],
          suggestedHint: 'Please continue working on your solution.',
          hintLevel: 1,
          codeQuality: 'fair',
          testable: false
        }
      
      default:
        return null
    }
  }
}

// Singleton instance
export const errorHandler = new ErrorHandler()


