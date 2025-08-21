/**
 * Test suite for Migration Manager
 * Tests legacy database detection, migration orchestration, and backup management
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import {
  LegacyDatabaseDetector,
  BackupManager,
  MigrationManager,
  type MigrationProgress
} from './migrationManager'

// Mock electron app for testing
const mockApp = {
  getPath: (name: string) => {
    if (name === 'userData') {
      return path.join(__dirname, 'test-data')
    }
    return '/tmp'
  },
  getAppPath: () => path.join(__dirname, 'test-app')
}

// Replace electron app with mock for testing
Object.defineProperty(app, 'getPath', { value: mockApp.getPath })
Object.defineProperty(app, 'getAppPath', { value: mockApp.getAppPath })

/**
 * Test helper to create mock database files
 */
class TestDatabaseHelper {
  private testDataDir: string

  constructor() {
    this.testDataDir = path.join(__dirname, 'test-data')
  }

  async setupTestEnvironment(): Promise<void> {
    // Clean up any existing test data
    await this.cleanupTestEnvironment()

    // Create test directories
    const appDbDir = path.join(this.testDataDir, 'app_db')
    const knowledgeDir = path.join(this.testDataDir, 'knowledge')

    fs.mkdirSync(appDbDir, { recursive: true })
    fs.mkdirSync(knowledgeDir, { recursive: true })

    // Create mock SQLite database
    await this.createMockSQLiteDatabase(path.join(appDbDir, 'chat.db'))

    // Create mock DuckDB database
    await this.createMockDuckDBDatabase(path.join(knowledgeDir, 'vectors.duckdb'))
  }

  async cleanupTestEnvironment(): Promise<void> {
    if (fs.existsSync(this.testDataDir)) {
      fs.rmSync(this.testDataDir, { recursive: true, force: true })
    }
  }

  private async createMockSQLiteDatabase(filePath: string): Promise<void> {
    // Create a minimal SQLite database file with proper magic bytes
    const sqliteMagic = Buffer.from('SQLite format 3\0')
    const padding = Buffer.alloc(1024 - sqliteMagic.length, 0)
    const mockDb = Buffer.concat([sqliteMagic, padding])

    fs.writeFileSync(filePath, mockDb)
    console.log(`Created mock SQLite database: ${filePath}`)
  }

  private async createMockDuckDBDatabase(filePath: string): Promise<void> {
    // Create a minimal DuckDB database file with proper magic bytes
    const duckdbMagic = Buffer.from('DUCK')
    const padding = Buffer.alloc(1024 - duckdbMagic.length, 0)
    const mockDb = Buffer.concat([duckdbMagic, padding])

    fs.writeFileSync(filePath, mockDb)
    console.log(`Created mock DuckDB database: ${filePath}`)
  }
}

/**
 * Test suite for LegacyDatabaseDetector
 */
async function testLegacyDatabaseDetector(): Promise<void> {
  console.log('\n=== Testing Legacy Database Detector ===')

  const helper = new TestDatabaseHelper()
  const detector = new LegacyDatabaseDetector()

  try {
    // Setup test environment
    await helper.setupTestEnvironment()

    // Test 1: Detect legacy databases
    console.log('\nTest 1: Detecting legacy databases')
    const detection = await detector.detectLegacyDatabases()

    console.log('Detection result:', {
      hasLegacyDatabases: detection.hasLegacyDatabases,
      sqliteCount: detection.sqliteDatabases.length,
      duckdbCount: detection.duckdbDatabases.length,
      totalSize: detection.totalSize,
      requiresMigration: detection.requiresMigration
    })

    if (!detection.hasLegacyDatabases) {
      throw new Error('Expected to find legacy databases')
    }

    if (detection.sqliteDatabases.length === 0) {
      throw new Error('Expected to find SQLite databases')
    }

    if (detection.duckdbDatabases.length === 0) {
      throw new Error('Expected to find DuckDB databases')
    }

    // Test 2: Check database compatibility
    console.log('\nTest 2: Checking database compatibility')
    const allDatabases = [...detection.sqliteDatabases, ...detection.duckdbDatabases]
    const compatibility = await detector.checkDatabaseCompatibility(allDatabases)

    console.log('Compatibility result:', {
      compatible: compatibility.compatible,
      issuesCount: compatibility.issues.length,
      warningsCount: compatibility.warnings.length
    })

    console.log('✅ Legacy Database Detector tests passed')
  } catch (error) {
    console.error('❌ Legacy Database Detector tests failed:', error)
    throw error
  } finally {
    await helper.cleanupTestEnvironment()
  }
}

/**
 * Test suite for BackupManager
 */
async function testBackupManager(): Promise<void> {
  console.log('\n=== Testing Backup Manager ===')

  const helper = new TestDatabaseHelper()
  const detector = new LegacyDatabaseDetector()
  const backupManager = new BackupManager()

  try {
    // Setup test environment
    await helper.setupTestEnvironment()

    // Get test databases
    const detection = await detector.detectLegacyDatabases()
    const testDatabases = [...detection.sqliteDatabases, ...detection.duckdbDatabases]

    // Test 1: Create backups
    console.log('\nTest 1: Creating backups')
    const backups = await backupManager.createBackups(testDatabases, {
      verify: true,
      includeTimestamp: true
    })

    console.log(`Created ${backups.length} backups`)

    if (backups.length !== testDatabases.length) {
      throw new Error(`Expected ${testDatabases.length} backups, got ${backups.length}`)
    }

    // Test 2: Verify backups
    console.log('\nTest 2: Verifying backups')
    for (const backup of backups) {
      const isValid = await backupManager.verifyBackup(backup)
      console.log(`Backup ${backup.id}: ${isValid ? 'valid' : 'invalid'}`)

      if (!isValid) {
        throw new Error(`Backup verification failed for ${backup.id}`)
      }
    }

    // Test 3: List backups
    console.log('\nTest 3: Listing backups')
    const listedBackups = await backupManager.listBackups()
    console.log(`Found ${listedBackups.length} backups in backup directory`)

    if (listedBackups.length < backups.length) {
      console.warn(`Expected at least ${backups.length} backups, found ${listedBackups.length}`)
    }

    // Test 4: Restore from backup (dry run)
    console.log('\nTest 4: Testing backup restoration')
    const testBackup = backups[0]
    const tempRestorePath = path.join(
      path.dirname(testBackup.originalPath),
      `restored_${Date.now()}.db`
    )

    const restored = await backupManager.restoreFromBackup(testBackup, tempRestorePath)
    console.log(`Backup restoration: ${restored ? 'success' : 'failed'}`)

    if (!restored) {
      throw new Error('Backup restoration failed')
    }

    // Clean up restored file
    if (fs.existsSync(tempRestorePath)) {
      fs.unlinkSync(tempRestorePath)
    }

    console.log('✅ Backup Manager tests passed')
  } catch (error) {
    console.error('❌ Backup Manager tests failed:', error)
    throw error
  } finally {
    await helper.cleanupTestEnvironment()
  }
}

/**
 * Test suite for MigrationManager
 */
async function testMigrationManager(): Promise<void> {
  console.log('\n=== Testing Migration Manager ===')

  const helper = new TestDatabaseHelper()
  const migrationManager = new MigrationManager()

  try {
    // Setup test environment
    await helper.setupTestEnvironment()

    // Test 1: Check migration requirement
    console.log('\nTest 1: Checking migration requirement')
    const isRequired = await migrationManager.isMigrationRequired()
    console.log(`Migration required: ${isRequired}`)

    if (!isRequired) {
      throw new Error('Expected migration to be required')
    }

    // Test 2: Get migration requirements
    console.log('\nTest 2: Getting migration requirements')
    const requirements = await migrationManager.getMigrationRequirements()

    console.log('Migration requirements:', {
      required: requirements.required,
      databaseCount: requirements.databases.length,
      compatible: requirements.compatibility.compatible,
      estimatedDuration: requirements.estimatedDuration,
      diskSpaceRequired: requirements.diskSpaceRequired
    })

    if (!requirements.required) {
      throw new Error('Expected migration to be required')
    }

    if (requirements.databases.length === 0) {
      throw new Error('Expected to find databases to migrate')
    }

    // Test 3: Execute dry run migration
    console.log('\nTest 3: Executing dry run migration')

    const progressUpdates: MigrationProgress[] = []
    const result = await migrationManager.executeMigration({
      dryRun: true,
      createBackups: true,
      progressCallback: (progress) => {
        progressUpdates.push({ ...progress })
        console.log(
          `Progress: ${progress.phase} - ${progress.currentStep} (${progress.percentage}%)`
        )
      }
    })

    console.log('Migration result:', {
      success: result.success,
      phase: result.phase,
      duration: result.duration,
      errorsCount: result.errors.length,
      warningsCount: result.warnings.length,
      backupsCreated: result.backupPaths?.length || 0
    })

    if (!result.success) {
      throw new Error(`Migration failed: ${result.errors.join(', ')}`)
    }

    if (progressUpdates.length === 0) {
      throw new Error('Expected progress updates during migration')
    }

    console.log(`Received ${progressUpdates.length} progress updates`)

    // Test 4: Check migration status
    console.log('\nTest 4: Checking migration status')
    const inProgress = migrationManager.isMigrationInProgress()
    console.log(`Migration in progress: ${inProgress}`)

    if (inProgress) {
      throw new Error('Migration should not be in progress after completion')
    }

    console.log('✅ Migration Manager tests passed')
  } catch (error) {
    console.error('❌ Migration Manager tests failed:', error)
    throw error
  } finally {
    await helper.cleanupTestEnvironment()
  }
}

/**
 * Run all tests
 */
async function runAllTests(): Promise<void> {
  console.log('🧪 Starting Migration Manager Test Suite')

  try {
    await testLegacyDatabaseDetector()
    await testBackupManager()
    await testMigrationManager()

    console.log('\n🎉 All Migration Manager tests passed!')
  } catch (error) {
    console.error('\n💥 Migration Manager tests failed:', error)
    process.exit(1)
  }
}

// Export test functions for individual testing
export {
  testLegacyDatabaseDetector,
  testBackupManager,
  testMigrationManager,
  runAllTests,
  TestDatabaseHelper
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error)
}
