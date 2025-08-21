/**
 * Migration Guard Utility
 * Provides utilities to check and prevent operations during migration
 * Implements requirement 7.2 for data access prevention during migration
 */

import { useMigrationState } from '@/composables/useMigrationState'

export interface OperationGuardResult {
  allowed: boolean
  reason?: string
  suggestedAction?: string
}

export interface GuardOptions {
  showUserMessage?: boolean
  throwError?: boolean
  customMessage?: string
}

/**
 * Migration Guard Class
 * Provides methods to check if operations are allowed during migration
 */
export class MigrationGuard {
  private static instance: MigrationGuard | null = null
  private migrationState = useMigrationState()

  private constructor() {}

  static getInstance(): MigrationGuard {
    if (!MigrationGuard.instance) {
      MigrationGuard.instance = new MigrationGuard()
    }
    return MigrationGuard.instance
  }

  /**
   * Check if a database operation is allowed
   * Supports requirement 7.2 for data access prevention during migration
   */
  async checkDatabaseOperation(
    operation: string,
    options: GuardOptions = {}
  ): Promise<OperationGuardResult> {
    try {
      // Check if migration is in progress
      if (this.migrationState.isOperationBlocked.value) {
        const result: OperationGuardResult = {
          allowed: false,
          reason: 'Database operations are blocked during migration',
          suggestedAction:
            'Please wait for the migration to complete before performing this operation'
        }

        if (options.showUserMessage) {
          this.showBlockedOperationMessage(operation, options.customMessage)
        }

        if (options.throwError) {
          throw new Error(result.reason)
        }

        return result
      }

      // Check with the main process
      const isAllowed = await this.migrationState.checkOperationAllowed(operation)

      if (!isAllowed) {
        const result: OperationGuardResult = {
          allowed: false,
          reason: `Operation '${operation}' is not allowed during migration`,
          suggestedAction: 'Please wait for the migration to complete'
        }

        if (options.showUserMessage) {
          this.showBlockedOperationMessage(operation, options.customMessage)
        }

        if (options.throwError) {
          throw new Error(result.reason)
        }

        return result
      }

      return { allowed: true }
    } catch (error) {
      console.error('[Migration Guard] Error checking operation permission:', error)

      // In case of error, allow the operation to prevent blocking the app
      return { allowed: true }
    }
  }

  /**
   * Check if UI interactions are allowed
   */
  checkUIInteraction(): OperationGuardResult {
    if (!this.migrationState.canShowUI.value) {
      return {
        allowed: false,
        reason: 'User interface is blocked during migration',
        suggestedAction: 'Please wait for the migration to complete'
      }
    }

    return { allowed: true }
  }

  /**
   * Guard a function to prevent execution during migration
   */
  guardFunction<T extends (...args: any[]) => any>(
    operation: string,
    fn: T,
    options: GuardOptions = {}
  ): T {
    return ((...args: any[]) => {
      return this.executeGuarded(operation, () => fn(...args), options)
    }) as T
  }

  /**
   * Guard an async function to prevent execution during migration
   */
  guardAsyncFunction<T extends (...args: any[]) => Promise<any>>(
    operation: string,
    fn: T,
    options: GuardOptions = {}
  ): T {
    return (async (...args: any[]) => {
      return await this.executeGuardedAsync(operation, () => fn(...args), options)
    }) as T
  }

  /**
   * Execute a function with migration guard
   */
  async executeGuarded<T>(operation: string, fn: () => T, options: GuardOptions = {}): Promise<T> {
    const guardResult = await this.checkDatabaseOperation(operation, options)

    if (!guardResult.allowed) {
      if (options.throwError) {
        throw new Error(guardResult.reason)
      } else {
        // Return a default value or throw based on the function type
        throw new Error(guardResult.reason)
      }
    }

    return fn()
  }

  /**
   * Execute an async function with migration guard
   */
  async executeGuardedAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    options: GuardOptions = {}
  ): Promise<T> {
    const guardResult = await this.checkDatabaseOperation(operation, options)

    if (!guardResult.allowed) {
      if (options.throwError) {
        throw new Error(guardResult.reason)
      } else {
        return Promise.reject(new Error(guardResult.reason))
      }
    }

    return await fn()
  }

  /**
   * Show a user-friendly message when an operation is blocked
   */
  private showBlockedOperationMessage(operation: string, customMessage?: string): void {
    const message =
      customMessage ||
      `The operation "${operation}" is currently unavailable during database migration. Please wait for the migration to complete.`

    // You can customize this to show a toast, modal, or other UI element
    console.warn('[Migration Guard]', message)

    // If you have a notification system, you can use it here
    // For example: useNotification().warning(message)
  }

  /**
   * Get current migration status
   */
  getMigrationStatus() {
    return {
      isDetected: this.migrationState.migrationState.value.isDetected,
      isInProgress: this.migrationState.migrationState.value.isInProgress,
      isBlocked: this.migrationState.migrationState.value.isBlocked,
      canUserInteract: this.migrationState.migrationState.value.canUserInteract,
      currentPhase: this.migrationState.migrationState.value.currentPhase,
      progressPercentage: this.migrationState.migrationState.value.progressPercentage
    }
  }
}

// Convenience functions for common operations
export const migrationGuard = MigrationGuard.getInstance()

/**
 * Check if a database operation is allowed
 */
export async function checkDatabaseOperation(
  operation: string,
  options: GuardOptions = {}
): Promise<OperationGuardResult> {
  return await migrationGuard.checkDatabaseOperation(operation, options)
}

/**
 * Check if UI interactions are allowed
 */
export function checkUIInteraction(): OperationGuardResult {
  return migrationGuard.checkUIInteraction()
}

/**
 * Guard a function to prevent execution during migration
 */
export function guardFunction<T extends (...args: any[]) => any>(
  operation: string,
  fn: T,
  options: GuardOptions = {}
): T {
  return migrationGuard.guardFunction(operation, fn, options)
}

/**
 * Guard an async function to prevent execution during migration
 */
export function guardAsyncFunction<T extends (...args: any[]) => Promise<any>>(
  operation: string,
  fn: T,
  options: GuardOptions = {}
): T {
  return migrationGuard.guardAsyncFunction(operation, fn, options)
}

/**
 * Execute a function with migration guard
 */
export async function executeGuarded<T>(
  operation: string,
  fn: () => T,
  options: GuardOptions = {}
): Promise<T> {
  return await migrationGuard.executeGuarded(operation, fn, options)
}

/**
 * Execute an async function with migration guard
 */
export async function executeGuardedAsync<T>(
  operation: string,
  fn: () => Promise<T>,
  options: GuardOptions = {}
): Promise<T> {
  return await migrationGuard.executeGuardedAsync(operation, fn, options)
}

/**
 * Decorator for guarding class methods
 */
export function GuardedMethod(operation: string, options: GuardOptions = {}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const guardResult = await checkDatabaseOperation(operation, options)

      if (!guardResult.allowed) {
        if (options.throwError) {
          throw new Error(guardResult.reason)
        } else {
          console.warn('[Migration Guard] Method blocked:', operation, guardResult.reason)
          return
        }
      }

      return originalMethod.apply(this, args)
    }

    return descriptor
  }
}

/**
 * Higher-order component for guarding Vue components
 */
export function withMigrationGuard<T extends Record<string, any>>(
  component: T,
  guardedMethods: string[] = []
): T {
  const guardedComponent = { ...component } as any

  // Guard specified methods
  for (const methodName of guardedMethods) {
    if (typeof (component as any).methods?.[methodName] === 'function') {
      const originalMethod = (component as any).methods[methodName]

      guardedComponent.methods = {
        ...guardedComponent.methods,
        [methodName]: guardFunction(`component:${methodName}`, originalMethod, {
          showUserMessage: true
        })
      }
    }
  }

  return guardedComponent
}
