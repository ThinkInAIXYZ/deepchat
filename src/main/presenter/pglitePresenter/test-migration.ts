/**
 * Migration System Test
 * Simple test to verify the migration system functionality
 */

import { PGliteSchemaManager } from './schema'
import { PGliteMigrationEngine } from './migration'
import { PGliteDataValidator } from './validation'

/**
 * Test the migration system components
 * This is a basic integration test to verify the system works
 */
export async function testMigrationSystem(): Promise<boolean> {
  try {
    console.log('[Migration Test] Starting migration system test')

    // Test 1: Schema Manager initialization
    const schemaManager = new PGliteSchemaManager(1536)
    console.log('[Migration Test] ✓ Schema manager initialized')

    // Test 2: Migration Engine initialization
    const _migrationEngine = new PGliteMigrationEngine(1536)
    console.log('[Migration Test] ✓ Migration engine initialized')

    // Test 3: Data Validator initialization
    const dataValidator = new PGliteDataValidator()
    console.log('[Migration Test] ✓ Data validator initialized')

    // Test 4: Schema SQL generation
    const schemaSQL = schemaManager.getUnifiedSchemaSQL()
    if (!schemaSQL || schemaSQL.length === 0) {
      throw new Error('Schema SQL generation failed')
    }
    console.log('[Migration Test] ✓ Schema SQL generated successfully')

    // Test 5: Index SQL generation
    const indexSQL = schemaManager.getIndexesSQL()
    if (!indexSQL || indexSQL.length === 0) {
      throw new Error('Index SQL generation failed')
    }
    console.log('[Migration Test] ✓ Index SQL generated successfully')

    // Test 6: Validation rules initialization
    const validationCategories = dataValidator.getValidationCategories()
    if (validationCategories.length === 0) {
      throw new Error('No validation categories found')
    }
    console.log(`[Migration Test] ✓ Found ${validationCategories.length} validation categories`)

    // Test 7: Migration definitions
    const migrations = PGliteSchemaManager.getMigrations()
    if (migrations.length === 0) {
      throw new Error('No migrations defined')
    }
    console.log(`[Migration Test] ✓ Found ${migrations.length} migration definitions`)

    console.log('[Migration Test] All tests passed successfully!')
    return true
  } catch (error) {
    console.error('[Migration Test] Test failed:', error)
    return false
  }
}

/**
 * Test schema validation functionality
 */
export function testSchemaValidation(): boolean {
  try {
    console.log('[Schema Test] Testing schema validation components')

    const schemaManager = new PGliteSchemaManager(1536)

    // Test schema SQL contains required elements
    const schemaSQL = schemaManager.getUnifiedSchemaSQL()

    const requiredElements = [
      'CREATE EXTENSION IF NOT EXISTS vector',
      'CREATE TABLE IF NOT EXISTS conversations',
      'CREATE TABLE IF NOT EXISTS messages',
      'CREATE TABLE IF NOT EXISTS knowledge_files',
      'CREATE TABLE IF NOT EXISTS knowledge_chunks',
      'CREATE TABLE IF NOT EXISTS knowledge_vectors',
      'vector(1536)',
      'REFERENCES conversations(conv_id)',
      'REFERENCES knowledge_files(id)'
    ]

    for (const element of requiredElements) {
      if (!schemaSQL.includes(element)) {
        throw new Error(`Schema SQL missing required element: ${element}`)
      }
    }

    console.log('[Schema Test] ✓ All required schema elements present')

    // Test index SQL contains required indexes
    const indexSQL = schemaManager.getIndexesSQL()

    const requiredIndexes = [
      'idx_conversations_conv_id',
      'idx_messages_conversation',
      'idx_knowledge_vectors_embedding_cosine',
      'idx_knowledge_chunks_file',
      'idx_knowledge_files_status'
    ]

    for (const index of requiredIndexes) {
      if (!indexSQL.includes(index)) {
        throw new Error(`Index SQL missing required index: ${index}`)
      }
    }

    console.log('[Schema Test] ✓ All required indexes present')
    console.log('[Schema Test] Schema validation test passed!')
    return true
  } catch (error) {
    console.error('[Schema Test] Schema validation test failed:', error)
    return false
  }
}

/**
 * Test migration engine functionality
 */
export function testMigrationEngine(): boolean {
  try {
    console.log('[Migration Engine Test] Testing migration engine components')

    const _migrationEngine = new PGliteMigrationEngine(1536)

    // Test migration definitions
    const migrations = PGliteSchemaManager.getMigrations()

    if (migrations.length === 0) {
      throw new Error('No migrations found')
    }

    // Verify first migration has required properties
    const firstMigration = migrations[0]
    if (!firstMigration.version || !firstMigration.description || !firstMigration.downScript) {
      throw new Error('First migration missing required properties')
    }

    console.log('[Migration Engine Test] ✓ Migration definitions valid')
    console.log('[Migration Engine Test] Migration engine test passed!')
    return true
  } catch (error) {
    console.error('[Migration Engine Test] Migration engine test failed:', error)
    return false
  }
}

/**
 * Run all migration system tests
 */
export async function runAllMigrationTests(): Promise<boolean> {
  console.log('[Migration Tests] Starting comprehensive migration system tests')

  const results = [await testMigrationSystem(), testSchemaValidation(), testMigrationEngine()]

  const allPassed = results.every((result) => result === true)

  if (allPassed) {
    console.log('[Migration Tests] ✅ All migration system tests passed!')
  } else {
    console.log('[Migration Tests] ❌ Some migration system tests failed!')
  }

  return allPassed
}
