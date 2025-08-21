/**
 * Deployment Validation Script
 * Validates that Version N deployment is properly configured for PGlite migration
 * Supports requirements 6.1, 7.1 for Version N deployment validation
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Validation results class
 */
class ValidationResult {
  constructor() {
    this.passed = []
    this.failed = []
    this.warnings = []
    this.info = []
  }

  addPass(message) {
    this.passed.push(message)
  }

  addFail(message) {
    this.failed.push(message)
  }

  addWarning(message) {
    this.warnings.push(message)
  }

  addInfo(message) {
    this.info.push(message)
  }

  get isValid() {
    return this.failed.length === 0
  }

  get summary() {
    return {
      total: this.passed.length + this.failed.length,
      passed: this.passed.length,
      failed: this.failed.length,
      warnings: this.warnings.length,
      isValid: this.isValid
    }
  }
}

/**
 * Validate PGlite dependencies and assets
 */
async function validatePGliteAssets(result) {
  console.log('[Validation] Checking PGlite assets...')

  try {
    // Check PGlite dependency in package.json
    const packageJsonPath = path.join(projectRoot, 'package.json')
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
    
    if (packageJson.dependencies['@electric-sql/pglite']) {
      result.addPass(`PGlite dependency found: ${packageJson.dependencies['@electric-sql/pglite']}`)
    } else {
      result.addFail('PGlite dependency not found in package.json')
    }

    // Check for PGlite WASM assets in node_modules
    const pgliteDistPath = path.join(projectRoot, 'node_modules', '@electric-sql', 'pglite', 'dist')
    
    try {
      await fs.access(pgliteDistPath)
      result.addPass('PGlite distribution directory found')

      // Check for required WASM files
      const requiredFiles = ['pglite.wasm', 'pglite.data']
      for (const file of requiredFiles) {
        const filePath = path.join(pgliteDistPath, file)
        try {
          const stats = await fs.stat(filePath)
          result.addPass(`Found ${file} (${Math.round(stats.size / 1024)}KB)`)
        } catch {
          result.addFail(`Missing required PGlite file: ${file}`)
        }
      }
    } catch {
      result.addFail('PGlite distribution directory not found - run pnpm install')
    }

    // Check build assets preparation
    const buildPglitePath = path.join(projectRoot, 'build', 'pglite')
    try {
      await fs.access(buildPglitePath)
      result.addPass('Build PGlite assets directory exists')
      
      const manifest = path.join(buildPglitePath, 'manifest.json')
      try {
        await fs.access(manifest)
        result.addPass('PGlite asset manifest found')
      } catch {
        result.addWarning('PGlite asset manifest not found - run prepare:pglite script')
      }
    } catch {
      result.addWarning('Build PGlite assets not prepared - will be created during build')
    }

  } catch (error) {
    result.addFail(`Error validating PGlite assets: ${error.message}`)
  }
}

/**
 * Validate migration system components
 */
async function validateMigrationSystem(result) {
  console.log('[Validation] Checking migration system components...')

  try {
    const srcPath = path.join(projectRoot, 'src')

    // Core migration system files
    const coreFiles = [
      'main/presenter/pglitePresenter/index.ts',
      'main/presenter/pglitePresenter/migrationManager.ts',
      'main/presenter/migrationPresenter/index.ts',
      'main/presenter/pglitePresenter/migration.ts',
      'main/presenter/pglitePresenter/errorHandler.ts',
      'main/presenter/pglitePresenter/rollbackManager.ts'
    ]

    for (const file of coreFiles) {
      const filePath = path.join(srcPath, file)
      try {
        await fs.access(filePath)
        result.addPass(`Migration component found: ${file}`)
      } catch {
        result.addFail(`Missing migration component: ${file}`)
      }
    }

    // UI components
    const uiFiles = [
      'renderer/src/composables/useMigrationState.ts',
      'renderer/src/utils/migrationGuard.ts'
    ]

    for (const file of uiFiles) {
      const filePath = path.join(srcPath, file)
      try {
        await fs.access(filePath)
        result.addPass(`Migration UI component found: ${file}`)
      } catch {
        result.addFail(`Missing migration UI component: ${file}`)
      }
    }

    // Check migration UI components directory
    const migrationComponentsPath = path.join(srcPath, 'renderer/src/components/migration')
    try {
      await fs.access(migrationComponentsPath)
      const components = await fs.readdir(migrationComponentsPath)
      result.addPass(`Migration UI components directory found with ${components.length} components`)
    } catch {
      result.addWarning('Migration UI components directory not found')
    }

    // Check migration system packaging
    const migrationBuildPath = path.join(projectRoot, 'build', 'migration')
    try {
      await fs.access(migrationBuildPath)
      result.addPass('Migration system build directory exists')
      
      const manifest = path.join(migrationBuildPath, 'migration-manifest.json')
      try {
        await fs.access(manifest)
        result.addPass('Migration system manifest found')
      } catch {
        result.addWarning('Migration system manifest not found - run package:migration script')
      }
    } catch {
      result.addWarning('Migration system not packaged - will be created during build')
    }

  } catch (error) {
    result.addFail(`Error validating migration system: ${error.message}`)
  }
}

/**
 * Validate build configuration
 */
async function validateBuildConfiguration(result) {
  console.log('[Validation] Checking build configuration...')

  try {
    // Check electron-builder.yml
    const builderConfigPath = path.join(projectRoot, 'electron-builder.yml')
    const builderConfig = await fs.readFile(builderConfigPath, 'utf8')

    // Check for PGlite WASM asset configuration
    if (builderConfig.includes('@electric-sql/pglite')) {
      result.addPass('Electron builder configured for PGlite assets')
    } else {
      result.addFail('Electron builder not configured for PGlite assets')
    }

    if (builderConfig.includes('pglite.wasm')) {
      result.addPass('WASM assets configured in electron-builder')
    } else {
      result.addFail('WASM assets not configured in electron-builder')
    }

    if (builderConfig.includes('asarUnpack')) {
      result.addPass('ASAR unpacking configured')
    } else {
      result.addFail('ASAR unpacking not configured')
    }

    // Check package.json scripts
    const packageJsonPath = path.join(projectRoot, 'package.json')
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))

    if (packageJson.scripts['prepare:pglite']) {
      result.addPass('PGlite preparation script configured')
    } else {
      result.addFail('PGlite preparation script not configured')
    }

    if (packageJson.scripts['package:migration']) {
      result.addPass('Migration packaging script configured')
    } else {
      result.addFail('Migration packaging script not configured')
    }

    if (packageJson.scripts.build.includes('preparePGliteAssets')) {
      result.addPass('Build script includes PGlite asset preparation')
    } else {
      result.addFail('Build script does not include PGlite asset preparation')
    }

  } catch (error) {
    result.addFail(`Error validating build configuration: ${error.message}`)
  }
}

/**
 * Validate documentation and release materials
 */
async function validateDocumentation(result) {
  console.log('[Validation] Checking documentation and release materials...')

  try {
    // Check release notes
    const releaseNotesPath = path.join(projectRoot, 'MIGRATION_RELEASE_NOTES.md')
    try {
      await fs.access(releaseNotesPath)
      result.addPass('Migration release notes found')
    } catch {
      result.addFail('Migration release notes not found')
    }

    // Check upgrade instructions
    const upgradeInstructionsPath = path.join(projectRoot, 'UPGRADE_INSTRUCTIONS.md')
    try {
      await fs.access(upgradeInstructionsPath)
      result.addPass('Upgrade instructions found')
    } catch {
      result.addFail('Upgrade instructions not found')
    }

    // Check deployment checklist
    const checklistPath = path.join(projectRoot, 'DEPLOYMENT_CHECKLIST.md')
    try {
      await fs.access(checklistPath)
      result.addPass('Deployment checklist found')
    } catch {
      result.addFail('Deployment checklist not found')
    }

  } catch (error) {
    result.addFail(`Error validating documentation: ${error.message}`)
  }
}

/**
 * Print validation results
 */
function printResults(result) {
  console.log('\n' + '='.repeat(60))
  console.log('DEPLOYMENT VALIDATION RESULTS')
  console.log('='.repeat(60))

  console.log(`\n✅ PASSED (${result.passed.length}):`)
  result.passed.forEach(msg => console.log(`   ${msg}`))

  if (result.failed.length > 0) {
    console.log(`\n❌ FAILED (${result.failed.length}):`)
    result.failed.forEach(msg => console.log(`   ${msg}`))
  }

  if (result.warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${result.warnings.length}):`)
    result.warnings.forEach(msg => console.log(`   ${msg}`))
  }

  if (result.info.length > 0) {
    console.log(`\nℹ️  INFO (${result.info.length}):`)
    result.info.forEach(msg => console.log(`   ${msg}`))
  }

  console.log('\n' + '='.repeat(60))
  console.log(`SUMMARY: ${result.passed.length} passed, ${result.failed.length} failed, ${result.warnings.length} warnings`)
  
  if (result.isValid) {
    console.log('🎉 DEPLOYMENT VALIDATION PASSED - Ready for Version N release!')
  } else {
    console.log('❌ DEPLOYMENT VALIDATION FAILED - Please fix the issues above')
  }
  console.log('='.repeat(60))
}

/**
 * Main validation function
 */
async function validateDeployment() {
  console.log('[Validation] Starting deployment validation for Version N...')
  
  const result = new ValidationResult()

  try {
    // Run all validation checks
    await validatePGliteAssets(result)
    await validateMigrationSystem(result)
    await validateBuildConfiguration(result)
    await validateDocumentation(result)

    // Print results
    printResults(result)

    return result.isValid
  } catch (error) {
    console.error('[Validation] Validation failed with error:', error)
    result.addFail(`Validation process error: ${error.message}`)
    printResults(result)
    return false
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const isValid = await validateDeployment()
    process.exit(isValid ? 0 : 1)
  } catch (error) {
    console.error('[Validation] Fatal error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('validateDeployment.js')) {
  main()
}

export { validateDeployment, ValidationResult }