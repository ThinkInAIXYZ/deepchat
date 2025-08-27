/**
 * Enhanced error handling and recovery mechanisms for lifecycle management
 */

import { eventBus, SendTarget } from '@/eventbus'
import { LIFECYCLE_EVENTS } from '@/events'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { DIALOG_ERROR } from '@shared/dialog'
import { is } from '@electron-toolkit/utils'
import { LifecyclePhase } from '@shared/lifecycle'

export interface LifecycleError {
  hookName: string
  phase: LifecyclePhase
  error: Error
  timestamp: number
  duration: number
  critical: boolean
  retryCount?: number
  context?: any
}

export interface RetryConfig {
  maxRetries: number
  retryDelay: number
  backoffMultiplier: number
  maxRetryDelay: number
}

export interface ErrorRecoveryOptions {
  showErrorDialog: boolean
  allowRetry: boolean
  gracefulDegradation: boolean
  logLevel: 'error' | 'warn' | 'info'
}

export class LifecycleErrorHandler {
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxRetryDelay: 10000
  }

  private failedHooks = new Map<string, LifecycleError>()
  private retryAttempts = new Map<string, number>()

  constructor() {}

  /**
   * Handle hook execution error with recovery mechanisms
   */
  async handleHookError(
    hook: LifecycleHook,
    context: LifecycleContext,
    error: Error,
    duration: number,
    options: ErrorRecoveryOptions = {
      showErrorDialog: true,
      allowRetry: true,
      gracefulDegradation: true,
      logLevel: 'error'
    }
  ): Promise<{ shouldRetry: boolean; shouldContinue: boolean }> {
    const lifecycleError: LifecycleError = {
      hookName: hook.name,
      phase: context.phase,
      error,
      timestamp: Date.now(),
      duration,
      critical: hook.critical || false,
      retryCount: this.retryAttempts.get(hook.name) || 0,
      context: {
        priority: hook.priority || 100,
        timeout: hook.timeout,
        phase: context.phase
      }
    }

    // Store the error for tracking
    this.failedHooks.set(hook.name, lifecycleError)

    // Log the error with comprehensive context
    await this.logError(lifecycleError, options.logLevel)

    // Emit error event with detailed information
    await this.emitErrorEvent(lifecycleError)

    // Handle critical vs non-critical errors differently
    if (lifecycleError.critical) {
      return await this.handleCriticalError(lifecycleError, options)
    } else {
      return await this.handleNonCriticalError(lifecycleError, options)
    }
  }

  /**
   * Handle critical hook failures
   */
  private async handleCriticalError(
    error: LifecycleError,
    options: ErrorRecoveryOptions
  ): Promise<{ shouldRetry: boolean; shouldContinue: boolean }> {
    if (is.dev) {
      console.error(`[LifecycleErrorHandler] Critical error in hook: ${error.hookName}`)
    }

    // Show error dialog for critical failures if enabled
    if (options.showErrorDialog) {
      const userChoice = await this.showCriticalErrorDialog(error, options.allowRetry)

      switch (userChoice) {
        case 'retry':
          if (options.allowRetry && this.canRetry(error.hookName)) {
            return { shouldRetry: true, shouldContinue: false }
          }
        // Fall through to abort if retry not possible
        case 'abort':
          return { shouldRetry: false, shouldContinue: false }
        case 'continue':
          if (options.gracefulDegradation) {
            await this.logGracefulDegradation(error)
            return { shouldRetry: false, shouldContinue: true }
          }
          return { shouldRetry: false, shouldContinue: false }
        default:
          return { shouldRetry: false, shouldContinue: false }
      }
    }

    // If no dialog, check if graceful degradation is allowed
    if (options.gracefulDegradation) {
      await this.logGracefulDegradation(error)
      return { shouldRetry: false, shouldContinue: true }
    }

    // Default behavior for critical errors is to halt
    return { shouldRetry: false, shouldContinue: false }
  }

  /**
   * Handle non-critical hook failures
   */
  private async handleNonCriticalError(
    error: LifecycleError,
    options: ErrorRecoveryOptions
  ): Promise<{ shouldRetry: boolean; shouldContinue: boolean }> {
    if (is.dev) {
      console.warn(`[LifecycleErrorHandler] Non-critical error in hook: ${error.hookName}`)
    }

    // For non-critical hooks, attempt retry if configured
    if (options.allowRetry && this.canRetry(error.hookName)) {
      if (is.dev) {
        console.log(`[LifecycleErrorHandler] Scheduling retry for hook: ${error.hookName}`)
      }
      return { shouldRetry: true, shouldContinue: false }
    }

    // If retry not possible or not allowed, continue with graceful degradation
    if (options.gracefulDegradation) {
      await this.logGracefulDegradation(error)
      return { shouldRetry: false, shouldContinue: true }
    }

    // Default for non-critical is to continue
    return { shouldRetry: false, shouldContinue: true }
  }

  /**
   * Execute hook with retry mechanism
   */
  async executeHookWithRetry(
    hook: LifecycleHook,
    context: LifecycleContext,
    options: ErrorRecoveryOptions = {
      showErrorDialog: false,
      allowRetry: true,
      gracefulDegradation: true,
      logLevel: 'error'
    }
  ): Promise<void | boolean> {
    const startTime = Date.now()
    let lastError: Error | null = null

    const maxAttempts = this.canRetry(hook.name) ? this.retryConfig.maxRetries + 1 : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          const delay = this.calculateRetryDelay(attempt - 1)
          if (is.dev) {
            console.log(
              `[LifecycleErrorHandler] Retrying hook ${hook.name} (attempt ${attempt}/${maxAttempts}) after ${delay}ms delay`
            )
          }
          await this.sleep(delay)
        }

        // Execute the hook
        let result: void | boolean

        if (hook.timeout) {
          result = await Promise.race([
            hook.execute(context),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Hook timeout: ${hook.name}`)), hook.timeout)
            )
          ])
        } else {
          result = await hook.execute(context)
        }

        // Success - clear retry count and return result
        this.retryAttempts.delete(hook.name)

        if (attempt > 1) {
          console.log(`[LifecycleErrorHandler] Hook ${hook.name} succeeded on attempt ${attempt}`)

          // Emit recovery event
          eventBus.sendToMain(LIFECYCLE_EVENTS.HOOK_EXECUTED, {
            hookName: hook.name,
            phase: context.phase,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
            recovered: true,
            attempts: attempt
          })
        }

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.retryAttempts.set(hook.name, attempt)

        if (is.dev) {
          console.error(
            `[LifecycleErrorHandler] Hook ${hook.name} failed on attempt ${attempt}:`,
            lastError.message
          )
        }

        // If this is the last attempt, handle the error
        if (attempt === maxAttempts) {
          const duration = Date.now() - startTime
          const errorHandling = await this.handleHookError(
            hook,
            context,
            lastError,
            duration,
            options
          )

          if (errorHandling.shouldRetry && this.canRetry(hook.name)) {
            // Extend max attempts if user requested retry
            continue
          }

          if (!errorHandling.shouldContinue) {
            throw lastError
          }

          // Continue with graceful degradation
          return undefined
        }
      }
    }

    // This should not be reached, but handle it gracefully
    if (lastError) {
      throw lastError
    }
  }

  /**
   * Show critical error dialog to user
   */
  private async showCriticalErrorDialog(
    error: LifecycleError,
    allowRetry: boolean
  ): Promise<string> {
    try {
      // Import dialog presenter dynamically to avoid circular dependencies
      const { DialogPresenter } = await import('../../presenter/dialogPresenter')
      const dialogPresenter = new DialogPresenter()

      const buttons = [{ key: 'abort', label: 'Abort Startup', default: false }]

      if (allowRetry && this.canRetry(error.hookName)) {
        buttons.unshift({ key: 'retry', label: 'Retry', default: true })
      }

      buttons.push({ key: 'continue', label: 'Continue Anyway', default: false })

      const result = await dialogPresenter.showDialog({
        title: 'Critical Startup Error',
        description: `A critical error occurred during application startup in the "${error.hookName}" hook:\n\n${error.error.message}\n\nPhase: ${error.phase}\nDuration: ${error.duration}ms`,
        icon: DIALOG_ERROR,
        buttons,
        timeout: 30000 // 30 second timeout
      })

      return result
    } catch (dialogError) {
      console.error('[LifecycleErrorHandler] Failed to show error dialog:', dialogError)
      return 'abort' // Default to abort if dialog fails
    }
  }

  /**
   * Log error with comprehensive context
   */
  private async logError(error: LifecycleError, level: 'error' | 'warn' | 'info'): Promise<void> {
    const logMessage = `[LifecycleErrorHandler] ${error.critical ? 'CRITICAL' : 'NON-CRITICAL'} error in hook "${error.hookName}" during ${error.phase} phase`
    const logDetails = {
      hookName: error.hookName,
      phase: error.phase,
      error: error.error.message,
      stack: error.error.stack,
      duration: error.duration,
      timestamp: new Date(error.timestamp).toISOString(),
      critical: error.critical,
      retryCount: error.retryCount,
      context: error.context
    }

    switch (level) {
      case 'error':
        console.error(logMessage, logDetails)
        break
      case 'warn':
        console.warn(logMessage, logDetails)
        break
      case 'info':
        console.info(logMessage, logDetails)
        break
    }

    // Also log to file if logging system is available
    // This would integrate with any existing logging framework
  }

  /**
   * Log graceful degradation
   */
  private async logGracefulDegradation(error: LifecycleError): Promise<void> {
    const message = `[LifecycleErrorHandler] Graceful degradation: Continuing startup despite failure in hook "${error.hookName}"`
    console.warn(message, {
      hookName: error.hookName,
      phase: error.phase,
      error: error.error.message,
      timestamp: new Date().toISOString()
    })

    // Emit graceful degradation event
    eventBus.sendToMain(LIFECYCLE_EVENTS.ERROR_OCCURRED, {
      hookName: error.hookName,
      phase: error.phase,
      error: `Graceful degradation: ${error.error.message}`,
      timestamp: Date.now(),
      gracefulDegradation: true,
      critical: error.critical
    })
  }

  /**
   * Emit detailed error event
   */
  private async emitErrorEvent(error: LifecycleError): Promise<void> {
    const errorEvent = {
      hookName: error.hookName,
      phase: error.phase,
      error: error.error.message,
      errorStack: error.error.stack,
      duration: error.duration,
      timestamp: error.timestamp,
      critical: error.critical,
      retryCount: error.retryCount,
      context: error.context
    }

    // Emit to main process
    eventBus.sendToMain(LIFECYCLE_EVENTS.ERROR_OCCURRED, errorEvent)

    // Emit to renderer processes (without stack trace for security)
    eventBus.sendToRenderer(LIFECYCLE_EVENTS.ERROR_OCCURRED, SendTarget.ALL_WINDOWS, {
      ...errorEvent,
      errorStack: undefined
    })
  }

  /**
   * Check if a hook can be retried
   */
  private canRetry(hookName: string): boolean {
    const currentRetries = this.retryAttempts.get(hookName) || 0
    return currentRetries < this.retryConfig.maxRetries
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const delay =
      this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1)
    return Math.min(delay, this.retryConfig.maxRetryDelay)
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorStatistics(): {
    totalErrors: number
    criticalErrors: number
    nonCriticalErrors: number
    retriedHooks: number
    failedHooks: Array<{
      hookName: string
      phase: LifecyclePhase
      error: string
      timestamp: number
    }>
  } {
    const errors = Array.from(this.failedHooks.values())

    return {
      totalErrors: errors.length,
      criticalErrors: errors.filter((e) => e.critical).length,
      nonCriticalErrors: errors.filter((e) => !e.critical).length,
      retriedHooks: this.retryAttempts.size,
      failedHooks: errors.map((e) => ({
        hookName: e.hookName,
        phase: e.phase,
        error: e.error.message,
        timestamp: e.timestamp
      }))
    }
  }

  /**
   * Clear error history (useful for testing or reset)
   */
  clearErrorHistory(): void {
    this.failedHooks.clear()
    this.retryAttempts.clear()
  }

  /**
   * Update retry configuration
   */
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config }
  }
}
