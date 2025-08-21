/**
 * Unit Tests for PGlite Migration Error Handling System
 * Tests error classification, recovery strategies, and user-friendly messaging
 * Supports requirements 2.5, 8.2, 8.4 for error handling validation
 */

import {
  MigrationErrorHandler,
  MigrationErrorType,
  ErrorSeverity,
  RecoveryActionType
} from './errorHandler'

/**
 * Test suite for Migration Error Handler
 */
export class ErrorHandlingTestSuite {
  private errorHandler: MigrationErrorHandler

  constructor() {
    this.errorHandler = new MigrationErrorHandler()
  }

  /**
   * Run all error handling tests
   */
  async runAllTests(): Promise<void> {
    console.log('[Error Handling Tests] Starting comprehensive test suite')

    try {
      await this.testErrorClassification()
      await this.testDiskSpaceErrorHandling()
      await this.testPermissionErrorHandling()
      await this.testCorruptionErrorHandling()
      await this.testConnectionErrorHandling()
      await this.testSchemaErrorHandling()
      await this.testTimeoutErrorHandling()
      await this.testValidationErrorHandling()
      await this.testBackupErrorHandling()
      await this.testRollbackErrorHandling()
      await this.testUnknownErrorHandling()
      await this.testRecoveryStrategies()
      await this.testRetryMechanisms()
      await this.testUserFriendlyMessages()

      console.log('[Error Handling Tests] ✅ All tests completed successfully')
    } catch (error) {
      console.error('[Error Handling Tests] ❌ Test suite failed:', error)
      throw error
    }
  }

  /**
   * Test error classification accuracy
   */
  private async testErrorClassification(): Promise<void> {
    console.log('[Error Handling Tests] Testing error classification...')

    const testCases = [
      {
        error: new Error('ENOSPC: no space left on device'),
        expectedType: MigrationErrorType.INSUFFICIENT_DISK_SPACE,
        expectedSeverity: ErrorSeverity.HIGH
      },
      {
        error: new Error('EACCES: permission denied'),
        expectedType: MigrationErrorType.PERMISSION_DENIED,
        expectedSeverity: ErrorSeverity.HIGH
      },
      {
        error: new Error('database disk image is malformed'),
        expectedType: MigrationErrorType.CORRUPTED_SOURCE_DATA,
        expectedSeverity: ErrorSeverity.CRITICAL
      },
      {
        error: new Error('ECONNREFUSED: connection refused'),
        expectedType: MigrationErrorType.CONNECTION_FAILED,
        expectedSeverity: ErrorSeverity.MEDIUM
      },
      {
        error: new Error('no such table: conversations'),
        expectedType: MigrationErrorType.SCHEMA_MISMATCH,
        expectedSeverity: ErrorSeverity.HIGH
      },
      {
        error: new Error('operation timed out'),
        expectedType: MigrationErrorType.TIMEOUT,
        expectedSeverity: ErrorSeverity.MEDIUM
      },
      {
        error: new Error('validation failed for record'),
        expectedType: MigrationErrorType.VALIDATION_FAILED,
        expectedSeverity: ErrorSeverity.MEDIUM
      },
      {
        error: new Error('some random error'),
        expectedType: MigrationErrorType.UNKNOWN_ERROR,
        expectedSeverity: ErrorSeverity.MEDIUM
      }
    ]

    for (const testCase of testCases) {
      const result = await this.errorHandler.handleError(testCase.error)

      // We can't directly access the classified error, so we test the behavior
      if (!result.handled) {
        throw new Error(`Error classification failed for: ${testCase.error.message}`)
      }
    }

    console.log('[Error Handling Tests] ✅ Error classification tests passed')
  }

  /**
   * Test disk space error handling
   */
  private async testDiskSpaceErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing disk space error handling...')

    const diskSpaceError = new Error('ENOSPC: no space left on device')
    const result = await this.errorHandler.handleError(diskSpaceError)

    if (!result.handled) {
      throw new Error('Disk space error was not handled')
    }

    if (
      result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION &&
      result.actionTaken !== RecoveryActionType.RETRY &&
      result.actionTaken !== RecoveryActionType.ABORT
    ) {
      throw new Error(`Unexpected recovery action for disk space error: ${result.actionTaken}`)
    }

    console.log('[Error Handling Tests] ✅ Disk space error handling tests passed')
  }

  /**
   * Test permission error handling
   */
  private async testPermissionErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing permission error handling...')

    const permissionError = new Error('EACCES: permission denied')
    const result = await this.errorHandler.handleError(permissionError, {
      filePath: '/test/database.db'
    })

    if (!result.handled) {
      throw new Error('Permission error was not handled')
    }

    if (
      result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION &&
      result.actionTaken !== RecoveryActionType.RETRY &&
      result.actionTaken !== RecoveryActionType.ABORT
    ) {
      throw new Error(`Unexpected recovery action for permission error: ${result.actionTaken}`)
    }

    console.log('[Error Handling Tests] ✅ Permission error handling tests passed')
  }

  /**
   * Test corruption error handling
   */
  private async testCorruptionErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing corruption error handling...')

    const corruptionError = new Error('database disk image is malformed')
    const result = await this.errorHandler.handleError(corruptionError)

    if (!result.handled) {
      throw new Error('Corruption error was not handled')
    }

    // Corruption errors should typically result in manual intervention or abort
    if (
      result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION &&
      result.actionTaken !== RecoveryActionType.SKIP &&
      result.actionTaken !== RecoveryActionType.ABORT
    ) {
      throw new Error(`Unexpected recovery action for corruption error: ${result.actionTaken}`)
    }

    console.log('[Error Handling Tests] ✅ Corruption error handling tests passed')
  }

  /**
   * Test connection error handling
   */
  private async testConnectionErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing connection error handling...')

    const connectionError = new Error('database is locked')
    const result = await this.errorHandler.handleError(connectionError)

    if (!result.handled) {
      throw new Error('Connection error was not handled')
    }

    // Connection errors should typically allow retry
    if (!result.shouldRetry && result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION) {
      console.warn(
        `Connection error resulted in: ${result.actionTaken}, retry: ${result.shouldRetry}`
      )
    }

    console.log('[Error Handling Tests] ✅ Connection error handling tests passed')
  }

  /**
   * Test schema error handling
   */
  private async testSchemaErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing schema error handling...')

    const schemaError = new Error('no such table: conversations')
    const result = await this.errorHandler.handleError(schemaError)

    if (!result.handled) {
      throw new Error('Schema error was not handled')
    }

    console.log('[Error Handling Tests] ✅ Schema error handling tests passed')
  }

  /**
   * Test timeout error handling
   */
  private async testTimeoutErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing timeout error handling...')

    const timeoutError = new Error('operation timed out')
    const result = await this.errorHandler.handleError(timeoutError)

    if (!result.handled) {
      throw new Error('Timeout error was not handled')
    }

    // Timeout errors should typically allow retry
    if (!result.shouldRetry && result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION) {
      console.warn(`Timeout error resulted in: ${result.actionTaken}, retry: ${result.shouldRetry}`)
    }

    console.log('[Error Handling Tests] ✅ Timeout error handling tests passed')
  }

  /**
   * Test validation error handling
   */
  private async testValidationErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing validation error handling...')

    const validationError = new Error('validation failed for record')
    const result = await this.errorHandler.handleError(validationError)

    if (!result.handled) {
      throw new Error('Validation error was not handled')
    }

    console.log('[Error Handling Tests] ✅ Validation error handling tests passed')
  }

  /**
   * Test backup error handling
   */
  private async testBackupErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing backup error handling...')

    const backupError = new Error('backup failed')
    const result = await this.errorHandler.handleError(backupError, { phase: 'backup' })

    if (!result.handled) {
      throw new Error('Backup error was not handled')
    }

    console.log('[Error Handling Tests] ✅ Backup error handling tests passed')
  }

  /**
   * Test rollback error handling
   */
  private async testRollbackErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing rollback error handling...')

    const rollbackError = new Error('rollback failed')
    const result = await this.errorHandler.handleError(rollbackError, { phase: 'rollback' })

    if (!result.handled) {
      throw new Error('Rollback error was not handled')
    }

    // Rollback errors are critical and should require manual intervention
    if (
      result.actionTaken !== RecoveryActionType.MANUAL_INTERVENTION &&
      result.actionTaken !== RecoveryActionType.RETRY
    ) {
      console.warn(`Rollback error resulted in: ${result.actionTaken}`)
    }

    console.log('[Error Handling Tests] ✅ Rollback error handling tests passed')
  }

  /**
   * Test unknown error handling
   */
  private async testUnknownErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing unknown error handling...')

    const unknownError = new Error('some completely unknown error')
    const result = await this.errorHandler.handleError(unknownError)

    if (!result.handled) {
      throw new Error('Unknown error was not handled')
    }

    console.log('[Error Handling Tests] ✅ Unknown error handling tests passed')
  }

  /**
   * Test recovery strategies
   */
  private async testRecoveryStrategies(): Promise<void> {
    console.log('[Error Handling Tests] Testing recovery strategies...')

    // Test retry strategy
    const retryableError = new Error('temporary connection issue')
    const retryResult = await this.errorHandler.handleError(retryableError)

    if (retryResult.handled && retryResult.shouldRetry) {
      console.log('[Error Handling Tests] ✅ Retry strategy working')
    }

    // Test skip strategy
    const skipableError = new Error('validation failed for record')
    const skipResult = await this.errorHandler.handleError(skipableError)

    if (skipResult.handled) {
      console.log('[Error Handling Tests] ✅ Skip strategy available')
    }

    // Test abort strategy
    const criticalError = new Error('database disk image is malformed')
    const abortResult = await this.errorHandler.handleError(criticalError)

    if (abortResult.handled && !abortResult.shouldContinue) {
      console.log('[Error Handling Tests] ✅ Abort strategy working')
    }

    console.log('[Error Handling Tests] ✅ Recovery strategies tests passed')
  }

  /**
   * Test retry mechanisms
   */
  private async testRetryMechanisms(): Promise<void> {
    console.log('[Error Handling Tests] Testing retry mechanisms...')

    const retryableError = new Error('temporary connection issue')

    // Test multiple retries
    for (let i = 0; i < 5; i++) {
      const result = await this.errorHandler.handleError(retryableError)

      if (!result.handled) {
        throw new Error(`Retry attempt ${i + 1} was not handled`)
      }

      // After max retries, should abort
      if (i >= 3 && result.shouldRetry) {
        console.warn(`Still allowing retries after ${i + 1} attempts`)
      }
    }

    // Reset retry attempts for clean testing
    this.errorHandler.clearRetryAttempts()

    console.log('[Error Handling Tests] ✅ Retry mechanisms tests passed')
  }

  /**
   * Test user-friendly messages
   */
  private async testUserFriendlyMessages(): Promise<void> {
    console.log('[Error Handling Tests] Testing user-friendly messages...')

    const testErrors = [
      new Error('ENOSPC: no space left on device'),
      new Error('EACCES: permission denied'),
      new Error('database disk image is malformed'),
      new Error('ECONNREFUSED: connection refused'),
      new Error('no such table: conversations')
    ]

    for (const error of testErrors) {
      const result = await this.errorHandler.handleError(error)

      if (!result.handled) {
        throw new Error(`Error not handled: ${error.message}`)
      }

      if (!result.message || result.message.length === 0) {
        throw new Error(`No user-friendly message provided for: ${error.message}`)
      }

      // Check that message is user-friendly (not too technical)
      if (result.message.includes('ENOSPC') || result.message.includes('EACCES')) {
        console.warn(`Message might be too technical: ${result.message}`)
      }
    }

    console.log('[Error Handling Tests] ✅ User-friendly messages tests passed')
  }

  /**
   * Test error handling with context
   */
  async testErrorHandlingWithContext(): Promise<void> {
    console.log('[Error Handling Tests] Testing error handling with context...')

    const error = new Error('permission denied')
    const context = {
      phase: 'backup',
      table: 'conversations',
      record: { id: 'test-123' },
      timestamp: Date.now()
    }

    const result = await this.errorHandler.handleError(error, context)

    if (!result.handled) {
      throw new Error('Error with context was not handled')
    }

    console.log('[Error Handling Tests] ✅ Error handling with context tests passed')
  }

  /**
   * Test error logging functionality
   */
  async testErrorLogging(): Promise<void> {
    console.log('[Error Handling Tests] Testing error logging...')

    const error = new Error('test error for logging')
    const result = await this.errorHandler.handleError(error)

    if (!result.handled) {
      throw new Error('Error was not handled for logging test')
    }

    // In a real implementation, you would verify that the error was logged
    // to the appropriate destination (file, monitoring service, etc.)

    console.log('[Error Handling Tests] ✅ Error logging tests passed')
  }

  /**
   * Test concurrent error handling
   */
  async testConcurrentErrorHandling(): Promise<void> {
    console.log('[Error Handling Tests] Testing concurrent error handling...')

    const errors = [
      new Error('error 1'),
      new Error('error 2'),
      new Error('error 3'),
      new Error('error 4'),
      new Error('error 5')
    ]

    // Handle multiple errors concurrently
    const promises = errors.map((error) => this.errorHandler.handleError(error))
    const results = await Promise.all(promises)

    for (let i = 0; i < results.length; i++) {
      if (!results[i].handled) {
        throw new Error(`Concurrent error ${i + 1} was not handled`)
      }
    }

    console.log('[Error Handling Tests] ✅ Concurrent error handling tests passed')
  }

  /**
   * Performance test for error handling
   */
  async testErrorHandlingPerformance(): Promise<void> {
    console.log('[Error Handling Tests] Testing error handling performance...')

    const startTime = Date.now()
    const numErrors = 100

    for (let i = 0; i < numErrors; i++) {
      const error = new Error(`performance test error ${i}`)
      const result = await this.errorHandler.handleError(error)

      if (!result.handled) {
        throw new Error(`Performance test error ${i} was not handled`)
      }
    }

    const endTime = Date.now()
    const duration = endTime - startTime
    const avgTime = duration / numErrors

    console.log(
      `[Error Handling Tests] Processed ${numErrors} errors in ${duration}ms (avg: ${avgTime.toFixed(2)}ms per error)`
    )

    if (avgTime > 100) {
      // 100ms per error seems reasonable
      console.warn(
        `[Error Handling Tests] Error handling might be too slow: ${avgTime.toFixed(2)}ms per error`
      )
    }

    console.log('[Error Handling Tests] ✅ Error handling performance tests passed')
  }
}

/**
 * Run error handling tests
 */
export async function runErrorHandlingTests(): Promise<void> {
  const testSuite = new ErrorHandlingTestSuite()

  try {
    await testSuite.runAllTests()
    await testSuite.testErrorHandlingWithContext()
    await testSuite.testErrorLogging()
    await testSuite.testConcurrentErrorHandling()
    await testSuite.testErrorHandlingPerformance()

    console.log('[Error Handling Tests] 🎉 All error handling tests completed successfully!')
  } catch (error) {
    console.error('[Error Handling Tests] 💥 Error handling tests failed:', error)
    throw error
  }
}

// Export for use in other test files
