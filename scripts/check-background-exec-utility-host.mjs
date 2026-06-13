import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const ENTRY_PATH = path.join(ROOT, 'out/main/backgroundExecUtilityHost.js')

const STATIC_IMPORT_PATTERN =
  /\b(?:import|export)\b(?:\s+[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g
const MAIN_ONLY_ELECTRON_IMPORT_PATTERN =
  /\bimport\s+\{[^}]*\b(?:app|BrowserWindow|session|ipcMain)\b[^}]*\}\s+from\s+['"]electron['"]/g

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function relativePath(filePath) {
  return toPosix(path.relative(ROOT, filePath))
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

function extractStaticImportSpecifiers(source) {
  const specifiers = []
  STATIC_IMPORT_PATTERN.lastIndex = 0

  let match
  while ((match = STATIC_IMPORT_PATTERN.exec(source)) !== null) {
    specifiers.push(match[1])
  }

  return specifiers
}

async function collectReachableOutputFiles(entryPath) {
  const visited = new Set()
  const pending = [entryPath]

  while (pending.length > 0) {
    const filePath = path.resolve(pending.pop())
    if (visited.has(filePath)) {
      continue
    }
    visited.add(filePath)

    const source = await fs.readFile(filePath, 'utf8')
    for (const specifier of extractStaticImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) {
        continue
      }

      const resolved = path.resolve(path.dirname(filePath), specifier)
      const candidate = path.extname(resolved) ? resolved : `${resolved}.js`
      if (await pathExists(candidate)) {
        pending.push(candidate)
      }
    }
  }

  return [...visited].sort()
}

async function main() {
  if (!(await pathExists(ENTRY_PATH))) {
    throw new Error(`Missing background exec utility host build output: ${relativePath(ENTRY_PATH)}`)
  }

  const files = await collectReachableOutputFiles(ENTRY_PATH)
  const violations = []

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8')
    if (source.includes('@electron-toolkit/utils')) {
      violations.push(`${relativePath(filePath)} imports @electron-toolkit/utils`)
    }

    MAIN_ONLY_ELECTRON_IMPORT_PATTERN.lastIndex = 0
    if (MAIN_ONLY_ELECTRON_IMPORT_PATTERN.test(source)) {
      violations.push(`${relativePath(filePath)} statically imports Electron main-process exports`)
    }
  }

  if (violations.length > 0) {
    console.error('Background exec utility host build guard failed.')
    for (const violation of violations) {
      console.error(`- ${violation}`)
    }
    process.exit(1)
  }

  console.log(`Background exec utility host build guard passed (${files.length} files scanned).`)
}

main().catch((error) => {
  console.error('Background exec utility host build guard failed to run:', error)
  process.exit(1)
})
