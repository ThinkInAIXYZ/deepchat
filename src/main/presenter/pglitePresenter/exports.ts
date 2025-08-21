/**
 * PGlite Presenter Exports
 * Central export file for all PGlite-related functionality
 */

// Core presenter and interfaces
export { PGlitePresenter } from './index'
export type { IPGlitePresenter, PGliteConfig, ValidationResult, IndexOptions } from './index'

// Configuration management
export { PGliteConfigManager, PGliteEnvironment } from './config'
export type { PGliteConnectionConfig } from './config'

// Connection management
export { PGliteConnectionManager, PGliteConnectionUtils } from './connection'
export type { ConnectionStatus } from './connection'

// Schema management
export { PGliteSchemaManager } from './schema'
export type { SchemaMigration, MigrationResult, SchemaValidationResult } from './schema'

// Migration system
export { PGliteMigrationEngine } from './migration'
export type { MigrationExecutionOptions, MigrationProgress, MigrationPlan } from './migration'

// Migration manager and orchestration
export { MigrationManager, LegacyDatabaseDetector, BackupManager } from './migrationManager'
export type {
  LegacyDatabaseInfo,
  DatabaseDetectionResult,
  MigrationOptions,
  MigrationResult as MigrationManagerResult,
  BackupInfo,
  BackupOptions
} from './migrationManager'

// Data validation
export { PGliteDataValidator } from './validation'
export type { ValidationRule, DataValidationResult, IntegrityCheckResult } from './validation'

// Test utilities
export { PGliteTestSetup } from './test-setup'
export {
  runAllMigrationTests,
  testMigrationSystem,
  testSchemaValidation,
  testMigrationEngine
} from './test-migration'
export { runAllValidationTests, testValidationSystem, testValidationRules } from './test-validation'
export {
  runAllTests as runAllMigrationManagerTests,
  testLegacyDatabaseDetector,
  testBackupManager,
  testMigrationManager,
  TestDatabaseHelper
} from './test-migration-manager'
