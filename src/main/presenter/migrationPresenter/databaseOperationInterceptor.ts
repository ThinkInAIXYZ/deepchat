/**
 * Database Operation Interceptor
 * Intercepts database operations during migration to prevent data corruption
 * Implements requirement 7.2 for data access prevention during migration
 */

import { ApplicationStateManager } from './applicationStateManager'

export interface DatabaseOperation {
  operation: string
  presenter: string
  method: string
  args: any[]
  timestamp: number
}

export interface InterceptionResult {
  allowed: boolean
  reason?: string
  suggestedAction?: string
}

/**
 * Database Operation Interceptor for preventing data access during migration
 * Supports requirement 7.2 for data access prevention and user interface blocking
 */
export class DatabaseOperationInterceptor {
  private applicationStateManager: ApplicationStateManager
  private interceptedOperations: Map<string, DatabaseOperation[]> = new Map()

  constructor(applicationStateManager: ApplicationStateManager) {
    this.applicationStateManager = applicationStateManager
  }

  /**
   * Intercept a database operation and check if it's allowed
   * Supports requirement 7.2 for data access prevention during migration
   */
  interceptOperation(presenter: string, method: string, args: any[]): InterceptionResult {
    const operation = `${presenter}:${method}`
    const timestamp = Date.now()

    // Check if operation is allowed
    const isAllowed = this.applicationStateManager.isOperationAllowed(operation)

    if (!isAllowed) {
      // Log the intercepted operation
      this.logInterceptedOperation({
        operation,
        presenter,
        method,
        args: this.sanitizeArgs(args),
        timestamp
      })

      const state = this.applicationStateManager.getCurrentState()

      return {
        allowed: false,
        reason: `Operation blocked during migration (phase: ${state.migrationPhase})`,
        suggestedAction:
          'Please wait for the migration to complete before performing this operation'
      }
    }

    return { allowed: true }
  }

  /**
   * Create a wrapper function that intercepts calls to a presenter method
   */
  createInterceptedMethod<T extends (...args: any[]) => any>(
    presenter: string,
    method: string,
    originalMethod: T
  ): T {
    return ((...args: any[]) => {
      // Check if operation is allowed
      const interceptionResult = this.interceptOperation(presenter, method, args)

      if (!interceptionResult.allowed) {
        // Throw an error or return a rejected promise
        const error = new Error(
          interceptionResult.reason || 'Operation not allowed during migration'
        )
        error.name = 'MigrationBlockedError'

        // If the original method returns a promise, return a rejected promise
        if (originalMethod.constructor.name === 'AsyncFunction') {
          return Promise.reject(error)
        } else {
          throw error
        }
      }

      // Call the original method if allowed
      return originalMethod.apply(this, args)
    }) as T
  }

  /**
   * Wrap all methods of a presenter with interception
   */
  wrapPresenterMethods(presenterName: string, presenter: any): any {
    const wrappedPresenter = { ...presenter }

    // Get all method names from the presenter
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(presenter)).filter(
      (name) => {
        return (
          name !== 'constructor' &&
          typeof presenter[name] === 'function' &&
          this.isDatabaseMethod(name)
        )
      }
    )

    // Wrap each database method
    for (const methodName of methodNames) {
      const originalMethod = presenter[methodName].bind(presenter)
      wrappedPresenter[methodName] = this.createInterceptedMethod(
        presenterName,
        methodName,
        originalMethod
      )
    }

    return wrappedPresenter
  }

  /**
   * Get intercepted operations for a specific presenter
   */
  getInterceptedOperations(presenter?: string): DatabaseOperation[] {
    if (presenter) {
      return this.interceptedOperations.get(presenter) || []
    }

    // Return all intercepted operations
    const allOperations: DatabaseOperation[] = []
    for (const operations of this.interceptedOperations.values()) {
      allOperations.push(...operations)
    }

    return allOperations.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Clear intercepted operations log
   */
  clearInterceptedOperations(presenter?: string): void {
    if (presenter) {
      this.interceptedOperations.delete(presenter)
    } else {
      this.interceptedOperations.clear()
    }
  }

  /**
   * Get statistics about intercepted operations
   */
  getInterceptionStatistics(): {
    totalIntercepted: number
    byPresenter: Record<string, number>
    byOperation: Record<string, number>
    recentInterceptions: DatabaseOperation[]
  } {
    const allOperations = this.getInterceptedOperations()
    const byPresenter: Record<string, number> = {}
    const byOperation: Record<string, number> = {}

    for (const op of allOperations) {
      byPresenter[op.presenter] = (byPresenter[op.presenter] || 0) + 1
      byOperation[op.operation] = (byOperation[op.operation] || 0) + 1
    }

    // Get recent interceptions (last 10)
    const recentInterceptions = allOperations.slice(0, 10)

    return {
      totalIntercepted: allOperations.length,
      byPresenter,
      byOperation,
      recentInterceptions
    }
  }

  /**
   * Log an intercepted operation
   */
  private logInterceptedOperation(operation: DatabaseOperation): void {
    console.warn(
      `[Database Interceptor] Blocked operation: ${operation.operation} during migration`
    )

    // Store the operation for logging/debugging
    const presenterOps = this.interceptedOperations.get(operation.presenter) || []
    presenterOps.push(operation)

    // Keep only the last 100 operations per presenter
    if (presenterOps.length > 100) {
      presenterOps.splice(0, presenterOps.length - 100)
    }

    this.interceptedOperations.set(operation.presenter, presenterOps)
  }

  /**
   * Check if a method name represents a database operation
   */
  private isDatabaseMethod(methodName: string): boolean {
    const databaseMethodPatterns = [
      /^(get|find|query|search|list)/i,
      /^(create|insert|add|save)/i,
      /^(update|modify|edit|change)/i,
      /^(delete|remove|destroy)/i,
      /^(count|exists|has)/i,
      /^(backup|restore|migrate)/i,
      /^(begin|commit|rollback)/i,
      /^(execute|run|exec)/i
    ]

    return databaseMethodPatterns.some((pattern) => pattern.test(methodName))
  }

  /**
   * Sanitize arguments for logging (remove sensitive data)
   */
  private sanitizeArgs(args: any[]): any[] {
    return args.map((arg) => {
      if (typeof arg === 'string' && arg.length > 100) {
        return arg.substring(0, 100) + '...'
      }
      if (typeof arg === 'object' && arg !== null) {
        // Remove potentially sensitive fields
        const sanitized = { ...arg }
        const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth']

        for (const field of sensitiveFields) {
          if (field in sanitized) {
            sanitized[field] = '[REDACTED]'
          }
        }

        return sanitized
      }
      return arg
    })
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    console.log('[Database Interceptor] Cleaning up database operation interceptor')
    this.interceptedOperations.clear()
  }
}
