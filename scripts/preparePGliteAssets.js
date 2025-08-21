/**
 * PGlite Asset Preparation Script
 * Ensures PGlite WASM assets are properly prepared for distribution
 * Supports requirement 6.1 and 7.1 for Version N deployment
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Prepare PGlite WASM assets for distribution
 */
async function preparePGliteAssets() {
  console.log('[PGlite Assets] Preparing WASM assets for distribution...')
  
  try {
    // Define paths
    const nodeModulesPath = path.join(projectRoot, 'node_modules', '@electric-sql', 'pglite', 'dist')
    const buildResourcesPath = path.join(projectRoot, 'build', 'pglite')
    
    // Ensure build resources directory exists
    await fs.mkdir(buildResourcesPath, { recursive: true })
    
    // List of required PGlite assets
    const requiredAssets = [
      'pglite.wasm',
      'pglite.data'
    ]
    
    // Copy each required asset
    for (const asset of requiredAssets) {
      const sourcePath = path.join(nodeModulesPath, asset)
      const destPath = path.join(buildResourcesPath, asset)
      
      try {
        // Check if source exists
        await fs.access(sourcePath)
        
        // Copy to build resources
        await fs.copyFile(sourcePath, destPath)
        
        // Verify copy
        const sourceStats = await fs.stat(sourcePath)
        const destStats = await fs.stat(destPath)
        
        if (sourceStats.size !== destStats.size) {
          throw new Error(`Size mismatch for ${asset}: source=${sourceStats.size}, dest=${destStats.size}`)
        }
        
        console.log(`[PGlite Assets] ✅ Copied ${asset} (${sourceStats.size} bytes)`)
      } catch (error) {
        console.error(`[PGlite Assets] ❌ Failed to copy ${asset}:`, error.message)
        throw error
      }
    }
    
    // Create asset manifest
    const manifest = {
      version: await getPGliteVersion(),
      assets: requiredAssets,
      timestamp: new Date().toISOString(),
      buildPlatform: process.platform,
      buildArch: process.arch
    }
    
    const manifestPath = path.join(buildResourcesPath, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    
    console.log('[PGlite Assets] ✅ Created asset manifest')
    console.log('[PGlite Assets] ✅ PGlite assets prepared successfully')
    
    return {
      success: true,
      assetsPath: buildResourcesPath,
      assets: requiredAssets,
      manifest
    }
  } catch (error) {
    console.error('[PGlite Assets] ❌ Failed to prepare PGlite assets:', error)
    throw error
  }
}

/**
 * Get PGlite version from package.json
 */
async function getPGliteVersion() {
  try {
    const packageJsonPath = path.join(projectRoot, 'package.json')
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
    return packageJson.dependencies['@electric-sql/pglite'] || 'unknown'
  } catch (error) {
    console.warn('[PGlite Assets] Could not determine PGlite version:', error.message)
    return 'unknown'
  }
}

/**
 * Validate PGlite installation
 */
async function validatePGliteInstallation() {
  console.log('[PGlite Assets] Validating PGlite installation...')
  
  try {
    const nodeModulesPath = path.join(projectRoot, 'node_modules', '@electric-sql', 'pglite')
    
    // Check if PGlite is installed
    await fs.access(nodeModulesPath)
    
    // Check if dist directory exists
    const distPath = path.join(nodeModulesPath, 'dist')
    await fs.access(distPath)
    
    // Check for required WASM files
    const requiredFiles = ['pglite.wasm', 'pglite.data']
    const missingFiles = []
    
    for (const file of requiredFiles) {
      const filePath = path.join(distPath, file)
      try {
        await fs.access(filePath)
        const stats = await fs.stat(filePath)
        console.log(`[PGlite Assets] ✅ Found ${file} (${stats.size} bytes)`)
      } catch {
        missingFiles.push(file)
      }
    }
    
    if (missingFiles.length > 0) {
      throw new Error(`Missing required PGlite files: ${missingFiles.join(', ')}`)
    }
    
    console.log('[PGlite Assets] ✅ PGlite installation validated')
    return true
  } catch (error) {
    console.error('[PGlite Assets] ❌ PGlite installation validation failed:', error.message)
    throw error
  }
}

/**
 * Clean up old PGlite assets
 */
async function cleanupOldAssets() {
  try {
    const buildResourcesPath = path.join(projectRoot, 'build', 'pglite')
    
    // Check if directory exists
    try {
      await fs.access(buildResourcesPath)
      
      // Remove old assets
      await fs.rm(buildResourcesPath, { recursive: true, force: true })
      console.log('[PGlite Assets] ✅ Cleaned up old assets')
    } catch {
      // Directory doesn't exist, nothing to clean
      console.log('[PGlite Assets] No old assets to clean up')
    }
  } catch (error) {
    console.warn('[PGlite Assets] Warning: Could not clean up old assets:', error.message)
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('[PGlite Assets] Starting PGlite asset preparation...')
    
    // Validate PGlite installation
    await validatePGliteInstallation()
    
    // Clean up old assets
    await cleanupOldAssets()
    
    // Prepare new assets
    const result = await preparePGliteAssets()
    
    console.log('[PGlite Assets] ✅ Asset preparation completed successfully')
    console.log('[PGlite Assets] Assets location:', result.assetsPath)
    console.log('[PGlite Assets] Assets prepared:', result.assets.join(', '))
    
    return result
  } catch (error) {
    console.error('[PGlite Assets] ❌ Asset preparation failed:', error)
    process.exit(1)
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('preparePGliteAssets.js')) {
  main()
}

export { preparePGliteAssets, validatePGliteInstallation, cleanupOldAssets }