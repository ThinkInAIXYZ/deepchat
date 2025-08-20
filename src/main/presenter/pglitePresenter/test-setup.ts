/**
 * Test setup for PGlite infrastructure
 * This file can be used to verify that PGlite is working correctly
 */
import { PGlitePresenter } from './index'
import { PGliteConfigManager, PGliteEnvironment } from './config'
import { PGliteConnectionManager } from './connection'
import fs from 'fs'

export class PGliteTestSetup {
  /**
   * Test basic PGlite functionality
   */
  static async testBasicSetup(): Promise<{ success: boolean; error?: string }> {
    let presenter: PGlitePresenter | null = null

    try {
      // Create test configuration
      const testConfig = PGliteConfigManager.getTestConfig()
      const pgliteConfig = PGliteConfigManager.createPGliteConfig(testConfig)

      // Ensure test directory is clean
      if (fs.existsSync(pgliteConfig.dbPath)) {
        fs.rmSync(pgliteConfig.dbPath, { recursive: true, force: true })
      }

      // Create presenter and initialize
      presenter = new PGlitePresenter(pgliteConfig.dbPath)
      await presenter.initialize(pgliteConfig)

      // Test basic operations
      const schemaVersion = await presenter.getCurrentSchemaVersion()
      console.log(`[PGlite Test] Schema version: ${schemaVersion}`)

      // Test integrity check
      const integrityResult = await presenter.validateIntegrity()
      if (!integrityResult.isValid) {
        throw new Error(`Integrity check failed: ${integrityResult.errors.join(', ')}`)
      }

      console.log('[PGlite Test] Basic setup test passed')
      return { success: true }
    } catch (error) {
      const errorMessage = `PGlite test failed: ${error}`
      console.error(`[PGlite Test] ${errorMessage}`)
      return { success: false, error: errorMessage }
    } finally {
      // Cleanup
      if (presenter) {
        try {
          await presenter.close()
        } catch (error) {
          console.warn('[PGlite Test] Error during cleanup:', error)
        }
      }
    }
  }

  /**
   * Test connection management
   */
  static async testConnectionManagement(): Promise<{ success: boolean; error?: string }> {
    try {
      const manager = PGliteConnectionManager.getInstance()

      // Test configuration validation
      const testConfig = PGliteConfigManager.getTestConfig()
      const validation = PGliteConfigManager.validateConfig(testConfig)

      if (!validation.isValid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`)
      }

      // Test connection creation
      const pgliteConfig = PGliteConfigManager.createPGliteConfig(testConfig)

      // Clean up any existing test database
      if (fs.existsSync(pgliteConfig.dbPath)) {
        fs.rmSync(pgliteConfig.dbPath, { recursive: true, force: true })
      }

      await manager.createConnection(pgliteConfig)

      // Test connection status
      const status = manager.getConnectionStatus(pgliteConfig.dbPath)
      if (!status || !status.isConnected) {
        throw new Error('Connection status check failed')
      }

      // Test database info
      const dbInfo = await manager.getDatabaseInfo(pgliteConfig.dbPath)
      if (!dbInfo.exists) {
        throw new Error('Database info check failed')
      }

      // Cleanup
      await manager.closeConnection(pgliteConfig.dbPath)

      console.log('[PGlite Test] Connection management test passed')
      return { success: true }
    } catch (error) {
      const errorMessage = `Connection management test failed: ${error}`
      console.error(`[PGlite Test] ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Test environment configuration
   */
  static async testEnvironmentConfig(): Promise<{ success: boolean; error?: string }> {
    try {
      // Test environment detection
      const isDev = PGliteEnvironment.isDevelopment()
      const isTest = PGliteEnvironment.isTest()

      console.log(`[PGlite Test] Environment - Dev: ${isDev}, Test: ${isTest}`)

      // Test environment-specific configs
      const envConfig = PGliteEnvironment.getEnvironmentConfig()
      const validation = PGliteConfigManager.validateConfig(envConfig)

      if (!validation.isValid) {
        throw new Error(`Environment config validation failed: ${validation.errors.join(', ')}`)
      }

      // Test custom configurations
      const customDimConfig = PGliteConfigManager.createConfigWithDimensions(768)
      if (customDimConfig.vectorDimensions !== 768) {
        throw new Error('Custom dimensions configuration failed')
      }

      const customIndexConfig = PGliteConfigManager.createConfigWithIndexOptions({
        metric: 'l2',
        M: 32,
        efConstruction: 400
      })

      if (customIndexConfig.indexOptions.metric !== 'l2') {
        throw new Error('Custom index configuration failed')
      }

      console.log('[PGlite Test] Environment configuration test passed')
      return { success: true }
    } catch (error) {
      const errorMessage = `Environment configuration test failed: ${error}`
      console.error(`[PGlite Test] ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Run all tests
   */
  static async runAllTests(): Promise<{
    success: boolean
    results: Array<{ test: string; success: boolean; error?: string }>
  }> {
    console.log('[PGlite Test] Starting PGlite infrastructure tests...')

    const results: Array<{ test: string; success: boolean; error?: string }> = []

    // Test basic setup
    const basicTest = await this.testBasicSetup()
    results.push({ test: 'Basic Setup', ...basicTest })

    // Test connection management
    const connectionTest = await this.testConnectionManagement()
    results.push({ test: 'Connection Management', ...connectionTest })

    // Test environment configuration
    const envTest = await this.testEnvironmentConfig()
    results.push({ test: 'Environment Configuration', ...envTest })

    const allPassed = results.every((result) => result.success)

    console.log('[PGlite Test] Test results:')
    results.forEach((result) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL'
      console.log(`  ${status} ${result.test}`)
      if (!result.success && result.error) {
        console.log(`    Error: ${result.error}`)
      }
    })

    if (allPassed) {
      console.log('[PGlite Test] All tests passed! PGlite infrastructure is ready.')
    } else {
      console.log('[PGlite Test] Some tests failed. Please check the errors above.')
    }

    return { success: allPassed, results }
  }
}

// Export for use in other modules
export { PGlitePresenter, PGliteConfigManager, PGliteConnectionManager, PGliteEnvironment }
