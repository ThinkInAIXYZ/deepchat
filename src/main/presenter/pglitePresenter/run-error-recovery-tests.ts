/**
 * Test Runner for Error Handling and Recovery System
 * Executes all error handling and recovery tests
 * Supports requirements 2.5, 8.2, 8.4, 10.3, 10.4 for comprehensive testing
 */

import { runErrorHandlingTests } from './test-error-handling'
import { runRollbackTests } from './test-rollback'
import { runErrorRecoveryIntegrationTests } from './test-error-recovery-integration'

/**
 * Main test runner for error handling and recovery system
 */
export async function runAllErrorRecoveryTests(): Promise<void> {
  console.log('🚀 Starting Error Handling and Recovery Test Suite')
  console.log('='.repeat(80))

  const startTime = Date.now()
  let totalTests = 0
  let passedTests = 0
  let failedTests = 0

  try {
    // Test 1: Error Handling System
    console.log('\n📋 Test Suite 1: Error Handling System')
    console.log('-'.repeat(50))
    try {
      await runErrorHandlingTests()
      console.log('✅ Error Handling System Tests: PASSED')
      passedTests++
    } catch (error) {
      console.error('❌ Error Handling System Tests: FAILED')
      console.error('Error:', error)
      failedTests++
    }
    totalTests++

    // Test 2: Rollback and Recovery System
    console.log('\n📋 Test Suite 2: Rollback and Recovery System')
    console.log('-'.repeat(50))
    try {
      await runRollbackTests()
      console.log('✅ Rollback and Recovery System Tests: PASSED')
      passedTests++
    } catch (error) {
      console.error('❌ Rollback and Recovery System Tests: FAILED')
      console.error('Error:', error)
      failedTests++
    }
    totalTests++

    // Test 3: Integration Tests
    console.log('\n📋 Test Suite 3: Error Recovery Integration Tests')
    console.log('-'.repeat(50))
    try {
      await runErrorRecoveryIntegrationTests()
      console.log('✅ Error Recovery Integration Tests: PASSED')
      passedTests++
    } catch (error) {
      console.error('❌ Error Recovery Integration Tests: FAILED')
      console.error('Error:', error)
      failedTests++
    }
    totalTests++

    // Test Summary
    const endTime = Date.now()
    const duration = endTime - startTime

    console.log('\n' + '='.repeat(80))
    console.log('📊 TEST SUMMARY')
    console.log('='.repeat(80))
    console.log(`Total Test Suites: ${totalTests}`)
    console.log(`Passed: ${passedTests}`)
    console.log(`Failed: ${failedTests}`)
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`)
    console.log(`Total Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`)

    if (failedTests === 0) {
      console.log('\n🎉 ALL ERROR HANDLING AND RECOVERY TESTS PASSED!')
      console.log('✅ Error handling system is working correctly')
      console.log('✅ Rollback and recovery mechanisms are functional')
      console.log('✅ Integration between components is successful')
    } else {
      console.log('\n💥 SOME TESTS FAILED!')
      console.log(`❌ ${failedTests} out of ${totalTests} test suites failed`)
      throw new Error(`${failedTests} test suite(s) failed`)
    }
  } catch (error) {
    console.error('\n💥 TEST SUITE EXECUTION FAILED!')
    console.error('Error:', error)
    throw error
  }
}

/**
 * Run specific test category
 */
export async function runSpecificTests(
  category: 'error-handling' | 'rollback' | 'integration' | 'all'
): Promise<void> {
  console.log(`🚀 Running ${category} tests...`)

  try {
    switch (category) {
      case 'error-handling':
        await runErrorHandlingTests()
        console.log('✅ Error handling tests completed successfully')
        break

      case 'rollback':
        await runRollbackTests()
        console.log('✅ Rollback tests completed successfully')
        break

      case 'integration':
        await runErrorRecoveryIntegrationTests()
        console.log('✅ Integration tests completed successfully')
        break

      case 'all':
      default:
        await runAllErrorRecoveryTests()
        break
    }
  } catch (error) {
    console.error(`❌ ${category} tests failed:`, error)
    throw error
  }
}

/**
 * Validate error handling implementation
 */
export async function validateErrorHandlingImplementation(): Promise<{
  isValid: boolean
  issues: string[]
  recommendations: string[]
}> {
  console.log('🔍 Validating Error Handling Implementation...')

  const issues: string[] = []
  const recommendations: string[] = []

  try {
    // Check if all required components exist
    const { MigrationErrorHandler } = await import('./errorHandler')
    const { RollbackManager } = await import('./rollbackManager')
    const { MigrationManager } = await import('./migrationManager')

    // Validate error handler
    const errorHandler = new MigrationErrorHandler()
    if (!errorHandler) {
      issues.push('MigrationErrorHandler cannot be instantiated')
    }

    // Validate rollback manager
    const rollbackManager = new RollbackManager()
    if (!rollbackManager) {
      issues.push('RollbackManager cannot be instantiated')
    }

    // Validate migration manager
    const migrationManager = new MigrationManager()
    if (!migrationManager) {
      issues.push('MigrationManager cannot be instantiated')
    }

    // Check method availability
    const requiredMethods = [
      { obj: errorHandler, method: 'handleError', name: 'MigrationErrorHandler.handleError' },
      { obj: rollbackManager, method: 'executeRollback', name: 'RollbackManager.executeRollback' },
      {
        obj: rollbackManager,
        method: 'createRecoveryPoint',
        name: 'RollbackManager.createRecoveryPoint'
      },
      {
        obj: migrationManager,
        method: 'handleMigrationError',
        name: 'MigrationManager.handleMigrationError'
      }
    ]

    for (const { obj, method, name } of requiredMethods) {
      if (typeof obj[method] !== 'function') {
        issues.push(`Required method ${name} is not available`)
      }
    }

    // Provide recommendations
    if (issues.length === 0) {
      recommendations.push('Consider adding performance monitoring for error handling')
      recommendations.push('Implement error analytics and reporting')
      recommendations.push('Add user notification system for critical errors')
      recommendations.push('Consider implementing automated error recovery for common issues')
    }

    const isValid = issues.length === 0

    console.log(`✅ Error handling implementation validation: ${isValid ? 'VALID' : 'INVALID'}`)
    if (issues.length > 0) {
      console.log('Issues found:')
      issues.forEach((issue) => console.log(`  - ${issue}`))
    }

    return { isValid, issues, recommendations }
  } catch (error) {
    issues.push(`Validation failed: ${error}`)
    return { isValid: false, issues, recommendations }
  }
}

// CLI interface for running tests
if (require.main === module) {
  const args = process.argv.slice(2)
  const command = args[0] || 'all'

  console.log('Error Handling and Recovery Test Runner')
  console.log(
    'Usage: node run-error-recovery-tests.js [error-handling|rollback|integration|all|validate]'
  )
  console.log('')

  if (command === 'validate') {
    validateErrorHandlingImplementation()
      .then((result) => {
        if (result.isValid) {
          console.log('✅ Implementation is valid')
          process.exit(0)
        } else {
          console.log('❌ Implementation has issues')
          process.exit(1)
        }
      })
      .catch((error) => {
        console.error('💥 Validation failed:', error)
        process.exit(1)
      })
  } else {
    runSpecificTests(command as any)
      .then(() => {
        console.log('✅ Tests completed successfully')
        process.exit(0)
      })
      .catch((error) => {
        console.error('💥 Tests failed:', error)
        process.exit(1)
      })
  }
}

export default runAllErrorRecoveryTests
