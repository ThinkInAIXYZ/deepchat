/**
 * Migration System Packaging Script
 * Ensures migration system components are properly packaged for distribution
 * Supports requirements 6.1, 7.1 for Version N deployment
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Package migration system for distribution
 */
async function packageMigrationSystem() {
  console.log('[Migration System] Packaging migration system for distribution...')
  
  try {
    // Define paths
    const buildResourcesPath = path.join(projectRoot, 'build', 'migration')
    const srcPath = path.join(projectRoot, 'src')
    
    // Ensure build resources directory exists
    await fs.mkdir(buildResourcesPath, { recursive: true })
    
    // Create migration system manifest
    const manifest = {
      version: await getApplicationVersion(),
      migrationSystemVersion: '1.0.0',
      supportedLegacyVersions: ['0.1.x', '0.2.x', '0.3.x'],
      requiredComponents: [
        'PGlitePresenter',
        'MigrationManager',
        'MigrationPresenter',
        'MigrationEngine',
        'ErrorHandler',
        'RollbackManager'
      ],
      migrationCapabilities: {
        sqliteToPglite: true,
        duckdbToPglite: true,
        dataValidation: true,
        rollbackSupport: true,
        progressTracking: true,
        errorRecovery: true
      },
      timestamp: new Date().toISOString(),
      buildPlatform: process.platform,
      buildArch: process.arch
    }
    
    // Write manifest
    const manifestPath = path.join(buildResourcesPath, 'migration-manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    
    // Create migration configuration template
    const migrationConfig = {
      migration: {
        enabled: true,
        autoDetect: true,
        autoStart: true,
        batchSize: 1000,
        validateData: true,
        createBackups: true,
        backupRetentionDays: 30,
        progressReporting: {
          enabled: true,
          updateInterval: 1000
        },
        errorHandling: {
          continueOnError: false,
          maxRetries: 3,
          retryDelay: 5000
        },
        ui: {
          showProgress: true,
          allowCancel: true,
          showDetails: false
        }
      }
    }
    
    const configPath = path.join(buildResourcesPath, 'migration-config.json')
    await fs.writeFile(configPath, JSON.stringify(migrationConfig, null, 2))
    
    // Create migration documentation index
    const docsIndex = {
      userGuide: 'docs/pglite-migration-user-guide.md',
      troubleshooting: 'docs/pglite-migration-troubleshooting.md',
      developerGuide: 'docs/pglite-architecture-developer-guide.md',
      releaseNotes: 'MIGRATION_RELEASE_NOTES.md'
    }
    
    const docsIndexPath = path.join(buildResourcesPath, 'docs-index.json')
    await fs.writeFile(docsIndexPath, JSON.stringify(docsIndex, null, 2))
    
    console.log('[Migration System] ✅ Created migration manifest')
    console.log('[Migration System] ✅ Created migration configuration template')
    console.log('[Migration System] ✅ Created documentation index')
    console.log('[Migration System] ✅ Migration system packaged successfully')
    
    return {
      success: true,
      packagePath: buildResourcesPath,
      manifest,
      configTemplate: migrationConfig
    }
  } catch (error) {
    console.error('[Migration System] ❌ Failed to package migration system:', error)
    throw error
  }
}

/**
 * Validate migration system components
 */
async function validateMigrationComponents() {
  console.log('[Migration System] Validating migration system components...')
  
  try {
    const srcPath = path.join(projectRoot, 'src')
    
    // Required migration system files
    const requiredFiles = [
      'main/presenter/pglitePresenter/index.ts',
      'main/presenter/pglitePresenter/migrationManager.ts',
      'main/presenter/migrationPresenter/index.ts',
      'main/presenter/pglitePresenter/migration.ts',
      'main/presenter/pglitePresenter/errorHandler.ts',
      'main/presenter/pglitePresenter/rollbackManager.ts',
      'renderer/src/composables/useMigrationState.ts',
      'renderer/src/utils/migrationGuard.ts'
    ]
    
    const missingFiles = []
    
    for (const file of requiredFiles) {
      const filePath = path.join(srcPath, file)
      try {
        await fs.access(filePath)
        console.log(`[Migration System] ✅ Found ${file}`)
      } catch {
        missingFiles.push(file)
      }
    }
    
    if (missingFiles.length > 0) {
      throw new Error(`Missing required migration system files: ${missingFiles.join(', ')}`)
    }
    
    // Check for migration UI components
    const uiComponentsPath = path.join(srcPath, 'renderer/src/components/migration')
    try {
      await fs.access(uiComponentsPath)
      const uiFiles = await fs.readdir(uiComponentsPath)
      console.log(`[Migration System] ✅ Found ${uiFiles.length} migration UI components`)
    } catch {
      console.warn('[Migration System] ⚠️ Migration UI components directory not found')
    }
    
    console.log('[Migration System] ✅ Migration system components validated')
    return true
  } catch (error) {
    console.error('[Migration System] ❌ Migration system validation failed:', error.message)
    throw error
  }
}

/**
 * Get application version from package.json
 */
async function getApplicationVersion() {
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json')
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
    return packageJson.version || 'unknown'
  } catch (error) {
    console.warn('[Migration System] Could not determine application version:', error.message)
    return 'unknown'
  }
}

/**
 * Create migration system deployment checklist
 */
async function createDeploymentChecklist() {
  const checklist = {
    preDeployment: [
      'Validate PGlite WASM assets are included',
      'Verify migration system components are packaged',
      'Test migration on sample legacy databases',
      'Validate backup and rollback functionality',
      'Check cross-platform compatibility',
      'Verify error handling and recovery',
      'Test progress reporting and UI',
      'Validate documentation completeness'
    ],
    deployment: [
      'Package application with migration system',
      'Include PGlite WASM assets in distribution',
      'Ensure proper file permissions for WASM files',
      'Include migration configuration templates',
      'Package user documentation and guides',
      'Create release notes with migration information',
      'Test installation on clean systems',
      'Verify auto-update compatibility'
    ],
    postDeployment: [
      'Monitor migration success rates',
      'Track error reports and recovery actions',
      'Collect user feedback on migration experience',
      'Monitor performance impact of PGlite',
      'Validate data integrity after migrations',
      'Track support requests related to migration',
      'Monitor application stability post-migration',
      'Prepare for Version N+1 legacy removal'
    ]
  }
  
  const checklistPath = path.join(projectRoot, 'build', 'migration', 'deployment-checklist.json')
  await fs.writeFile(checklistPath, JSON.stringify(checklist, null, 2))
  
  console.log('[Migration System] ✅ Created deployment checklist')
  return checklist
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('[Migration System] Starting migration system packaging...')
    
    // Validate migration system components
    await validateMigrationComponents()
    
    // Package migration system
    const result = await packageMigrationSystem()
    
    // Create deployment checklist
    await createDeploymentChecklist()
    
    console.log('[Migration System] ✅ Migration system packaging completed successfully')
    console.log('[Migration System] Package location:', result.packagePath)
    
    return result
  } catch (error) {
    console.error('[Migration System] ❌ Migration system packaging failed:', error)
    process.exit(1)
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('packageMigrationSystem.js')) {
  main()
}

export { packageMigrationSystem, validateMigrationComponents, createDeploymentChecklist }