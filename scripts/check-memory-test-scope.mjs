import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CATEGORY_NAMES = ['behavior', 'native', 'eval', 'perf']
const MEMORY_IMPORT =
  /from ['"][^'"]*(?:\/memory(?:\/|['"])|agent-memory|memory\.routes|agentMemory|recallKeyword)[^'"]*['"]/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.perf\.[cm]?[jt]sx?$/

function walkTestFiles(rootDir) {
  const testRoot = join(rootDir, 'test', 'main')
  const result = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(absolutePath)
      } else if (TEST_FILE.test(entry.name)) {
        result.push(relative(rootDir, absolutePath).replaceAll('\\', '/'))
      }
    }
  }
  visit(testRoot)
  return result.sort()
}

function isMemoryOwned(path, readContent) {
  if (path.startsWith('test/main/performance/memory/')) return true
  if (/memory/i.test(path.split('/').at(-1) ?? '')) return true
  return MEMORY_IMPORT.test(readContent(path))
}

export function validateMemoryTestScope({
  rootDir,
  manifest,
  existingPaths,
  discoveredPaths,
  fileContents,
  readFile
}) {
  const errors = []
  const ownerByPath = new Map()
  const exemptions = new Map()

  const manifestExemptions = manifest.exemptions ?? []
  for (const exemption of manifestExemptions) {
    if (!exemption?.path || !exemption?.reason?.trim()) {
      errors.push('Every exemption must include a path and a non-empty reason.')
      continue
    }
    if (exemptions.has(exemption.path)) {
      errors.push(`Duplicate exemption: ${exemption.path}`)
    }
    exemptions.set(exemption.path, exemption.reason)
  }

  for (const category of CATEGORY_NAMES) {
    const paths = manifest[category]
    if (!Array.isArray(paths)) {
      errors.push(`Manifest category must be an array: ${category}`)
      continue
    }
    for (const path of paths) {
      const previous = ownerByPath.get(path)
      if (previous) {
        errors.push(`Test is classified more than once: ${path} (${previous}, ${category})`)
      } else {
        ownerByPath.set(path, category)
      }
    }
  }

  const pathExists = existingPaths
    ? (path) => existingPaths.has(path)
    : (path) => existsSync(join(rootDir, path))
  for (const path of [...ownerByPath.keys(), ...exemptions.keys()]) {
    if (!pathExists(path)) errors.push(`Manifest path does not exist: ${path}`)
  }

  const readContent = (path) => {
    if (fileContents) return fileContents.get(path) ?? ''
    if (readFile) return readFile(path)
    return readFileSync(join(rootDir, path), 'utf8')
  }
  const candidates =
    discoveredPaths ?? walkTestFiles(rootDir).filter((path) => isMemoryOwned(path, readContent))
  for (const path of candidates) {
    if (!ownerByPath.has(path) && !exemptions.has(path)) {
      errors.push(`Memory-owned test is not classified: ${path}`)
    }
  }

  for (const [path, category] of ownerByPath) {
    const content = pathExists(path) ? readContent(path) : ''
    if (
      category === 'behavior' &&
      (/nativeSqliteHarness|requireNativeSqlite/.test(path) ||
        /from ['"][^'"]*nativeSqliteHarness['"]/.test(content))
    ) {
      errors.push(`Native harness test cannot be portable behavior: ${path}`)
    }
  }

  return errors.sort()
}

function runCli() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const rootDir = resolve(scriptDirectory, '..')
  const manifest = JSON.parse(readFileSync(join(rootDir, 'test/memory-test-scope.json'), 'utf8'))
  const errors = validateMemoryTestScope({ rootDir, manifest })
  if (errors.length > 0) {
    console.error(['Memory test scope validation failed:', ...errors.map((error) => `- ${error}`)].join('\n'))
    process.exitCode = 1
    return
  }
  const classified = CATEGORY_NAMES.reduce(
    (total, category) => total + manifest[category].length,
    0
  )
  console.log(
    `Memory test scope is valid (${classified} classified, ${(manifest.exemptions ?? []).length} exempt).`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
