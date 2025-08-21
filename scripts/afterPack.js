import fs from 'fs/promises'
import path from 'path'

function isLinux(targets) {
  const re = /AppImage|snap|deb|rpm|freebsd|pacman/i
  return !!targets.find((target) => re.test(target.name))
}

async function ensurePGliteAssets(appOutDir) {
  try {
    const pgliteDir = path.join(appOutDir, 'app.asar.unpacked', 'pglite')
    const wasmPath = path.join(pgliteDir, 'pglite.wasm')
    const dataPath = path.join(pgliteDir, 'pglite.data')
    
    // Verify PGlite WASM assets exist
    const wasmExists = await fs.access(wasmPath).then(() => true).catch(() => false)
    const dataExists = await fs.access(dataPath).then(() => true).catch(() => false)
    
    if (!wasmExists || !dataExists) {
      console.warn('[AfterPack] PGlite WASM assets not found, attempting to copy...')
      
      // Ensure directory exists
      await fs.mkdir(pgliteDir, { recursive: true })
      
      // Copy WASM assets from node_modules
      const nodeModulesPath = path.join(process.cwd(), 'node_modules', '@electric-sql', 'pglite', 'dist')
      
      if (!wasmExists) {
        const sourceWasm = path.join(nodeModulesPath, 'pglite.wasm')
        await fs.copyFile(sourceWasm, wasmPath)
        console.log('[AfterPack] Copied pglite.wasm')
      }
      
      if (!dataExists) {
        const sourceData = path.join(nodeModulesPath, 'pglite.data')
        await fs.copyFile(sourceData, dataPath)
        console.log('[AfterPack] Copied pglite.data')
      }
    }
    
    // Set proper permissions for WASM files
    await fs.chmod(wasmPath, 0o644)
    await fs.chmod(dataPath, 0o644)
    
    console.log('[AfterPack] PGlite WASM assets verified and configured')
  } catch (error) {
    console.error('[AfterPack] Error handling PGlite assets:', error)
    throw error
  }
}

async function afterPack({ targets, appOutDir }) {
  // Ensure PGlite WASM assets are properly packaged
  await ensurePGliteAssets(appOutDir)
  
  // Handle Linux-specific packaging
  if (!isLinux(targets)) return
  const appName = 'deepchat'
  const scriptPath = path.join(appOutDir, appName)
  const script = `#!/bin/bash\n"\${BASH_SOURCE%/*}"/${appName}.bin --no-sandbox "$@"`
  await fs.rename(scriptPath, `${scriptPath}.bin`)
  await fs.writeFile(scriptPath, script)
  await fs.chmod(scriptPath, 0o755)
}

export default afterPack
