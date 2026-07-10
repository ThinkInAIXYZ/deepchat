import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue'])
const CHILD_PROCESS_METHODS = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync'
])
const CATEGORIES = new Set([
  'deepchat-runtime',
  'external-opener',
  'helper',
  'synchronous-exclusion',
  'termination-helper',
  'user-owned-external',
  'utility-host'
])
const DEFAULT_INVENTORY_PATH = 'scripts/process-launcher-inventory.json'

function getConfiguredPaths() {
  const testRoot = process.env.DEEPCHAT_TEST_PROCESS_LAUNCHER_ROOT
  const testInventory = process.env.DEEPCHAT_TEST_PROCESS_LAUNCHER_INVENTORY
  const allowTestOverride = process.env.NODE_ENV === 'test'
  const root = allowTestOverride && testRoot ? path.resolve(testRoot) : process.cwd()
  const inventoryPath =
    allowTestOverride && testInventory
      ? path.resolve(testInventory)
      : path.join(root, DEFAULT_INVENTORY_PATH)

  return { inventoryPath, root }
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

async function collectSourceFiles(entryPath) {
  const entries = await fs.readdir(entryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const nextPath = path.join(entryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(nextPath)))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(nextPath)
    }
  }

  return files
}

function parseNamedImports(clause) {
  const start = clause.indexOf('{')
  const end = clause.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return []

  return clause
    .slice(start + 1, end)
    .split(',')
    .map((entry) => entry.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((entry) => {
      const [imported, local = imported] = entry.split(/\s+as\s+/)
      return { imported: imported.trim(), local: local.trim() }
    })
}

function parseDefaultImport(clause) {
  const candidate = clause.split(',')[0].trim()
  return /^[A-Za-z_$][\w$]*$/.test(candidate) ? candidate : null
}

function parseNamespaceImport(clause) {
  return /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1] ?? null
}

function extractImports(sourceWithoutComments) {
  const imports = []
  const pattern = /\bimport\s+(?!type\b)(?!['"])([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g
  let match

  while ((match = pattern.exec(sourceWithoutComments)) !== null) {
    imports.push({ clause: match[1].trim(), module: match[3] })
  }

  return imports
}

function addFunctionBinding(bindings, local, launcher) {
  if (/^[A-Za-z_$][\w$]*$/.test(local)) bindings.set(local, launcher)
}

function extractBindings(sourceWithoutComments) {
  const functionBindings = new Map()
  const namespaceBindings = []
  const electronShellBindings = new Set()
  const electronUtilityBindings = new Set()
  const stdioTransportBindings = new Set()

  for (const importEntry of extractImports(sourceWithoutComments)) {
    const { clause, module } = importEntry
    const named = parseNamedImports(clause)
    const namespace = parseNamespaceImport(clause)

    if (module === 'child_process' || module === 'node:child_process') {
      for (const { imported, local } of named) {
        if (CHILD_PROCESS_METHODS.has(imported)) {
          addFunctionBinding(functionBindings, local, `child_process.${imported}`)
        }
      }
      if (namespace) namespaceBindings.push({ local: namespace, module: 'child_process' })
      const defaultImport = parseDefaultImport(clause)
      if (defaultImport) namespaceBindings.push({ local: defaultImport, module: 'child_process' })
    } else if (module === 'cross-spawn') {
      const defaultImport = parseDefaultImport(clause)
      if (defaultImport) {
        addFunctionBinding(functionBindings, defaultImport, 'cross-spawn.spawn')
        namespaceBindings.push({ local: defaultImport, module: 'cross-spawn-default' })
      }
      for (const { imported, local } of named) {
        if (imported === 'sync') addFunctionBinding(functionBindings, local, 'cross-spawn.sync')
      }
      if (namespace) namespaceBindings.push({ local: namespace, module: 'cross-spawn' })
    } else if (module === 'node-pty') {
      for (const { imported, local } of named) {
        if (imported === 'spawn') addFunctionBinding(functionBindings, local, 'node-pty.spawn')
      }
      if (namespace) namespaceBindings.push({ local: namespace, module: 'node-pty' })
      const defaultImport = parseDefaultImport(clause)
      if (defaultImport) namespaceBindings.push({ local: defaultImport, module: 'node-pty' })
    } else if (module === 'electron') {
      for (const { imported, local } of named) {
        if (imported === 'shell') electronShellBindings.add(local)
        if (imported === 'utilityProcess') electronUtilityBindings.add(local)
      }
    } else if (module === '@modelcontextprotocol/sdk/client/stdio.js') {
      for (const { imported, local } of named) {
        if (imported === 'StdioClientTransport') stdioTransportBindings.add(local)
      }
    }
  }

  const dynamicElectronPattern =
    /\bconst\s*{([^}]+)}\s*=\s*(?:await\s+)?import\s*\(\s*['"]electron['"]\s*\)/g
  let dynamicMatch
  while ((dynamicMatch = dynamicElectronPattern.exec(sourceWithoutComments)) !== null) {
    for (const entry of dynamicMatch[1].split(',')) {
      const [imported, local = imported] = entry.trim().split(/\s*:\s*/)
      if (imported === 'shell') electronShellBindings.add(local)
      if (imported === 'utilityProcess') electronUtilityBindings.add(local)
    }
  }

  const promisifyPattern =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*promisify\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g
  let promisifyMatch
  while ((promisifyMatch = promisifyPattern.exec(sourceWithoutComments)) !== null) {
    const launcher = functionBindings.get(promisifyMatch[2])
    if (launcher) addFunctionBinding(functionBindings, promisifyMatch[1], launcher)
  }

  return {
    electronShellBindings,
    electronUtilityBindings,
    functionBindings,
    namespaceBindings,
    stdioTransportBindings
  }
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectPatternMatches(source, pattern, launcher, matches) {
  let match
  while ((match = pattern.exec(source)) !== null) {
    matches.push({ index: match.index, launcher })
  }
}

function detectLaunches(source) {
  const bindings = extractBindings(source)
  const matches = []

  for (const [local, launcher] of bindings.functionBindings) {
    collectPatternMatches(
      source,
      new RegExp(`(?<![\\w$.])${escapePattern(local)}\\s*\\(`, 'g'),
      launcher,
      matches
    )
  }

  for (const { local, module } of bindings.namespaceBindings) {
    const methods =
      module === 'node-pty' ? ['spawn'] : module === 'cross-spawn-default' ? ['sync'] : [...CHILD_PROCESS_METHODS]
    for (const method of methods) {
      const launcher = module.startsWith('cross-spawn')
        ? `cross-spawn.${method}`
        : `${module}.${method}`
      collectPatternMatches(
        source,
        new RegExp(`\\b${escapePattern(local)}\\s*\\.\\s*${method}\\s*\\(`, 'g'),
        launcher,
        matches
      )
    }
  }

  for (const local of bindings.electronShellBindings) {
    for (const method of ['openExternal', 'openPath']) {
      collectPatternMatches(
        source,
        new RegExp(`\\b${escapePattern(local)}\\s*\\.\\s*${method}\\s*\\(`, 'g'),
        `electron.shell.${method}`,
        matches
      )
    }
  }

  for (const local of bindings.electronUtilityBindings) {
    collectPatternMatches(
      source,
      new RegExp(`\\b${escapePattern(local)}\\s*\\.\\s*fork\\s*\\(`, 'g'),
      'electron.utilityProcess.fork',
      matches
    )
  }

  for (const local of bindings.stdioTransportBindings) {
    collectPatternMatches(
      source,
      new RegExp(`\\bnew\\s+${escapePattern(local)}\\s*\\(`, 'g'),
      'mcp.StdioClientTransport',
      matches
    )
  }

  const uniqueMatches = new Map()
  for (const match of matches) uniqueMatches.set(`${match.index}:${match.launcher}`, match)
  return [...uniqueMatches.values()].sort((left, right) => left.index - right.index)
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length
}

async function scanLaunchers(root) {
  const sourceRoot = path.join(root, 'src')
  const files = await collectSourceFiles(sourceRoot)
  const sites = []

  for (const filePath of files.sort()) {
    const source = await fs.readFile(filePath, 'utf8')
    const occurrences = new Map()

    for (const match of detectLaunches(source)) {
      const occurrence = (occurrences.get(match.launcher) ?? 0) + 1
      occurrences.set(match.launcher, occurrence)
      sites.push({
        launcher: match.launcher,
        line: lineForIndex(source, match.index),
        occurrence,
        path: toPosix(path.relative(root, filePath))
      })
    }
  }

  return sites
}

function siteId(site) {
  return `${site.path}|${site.launcher}|${site.occurrence}`
}

function validateInventory(inventory) {
  const errors = []
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return ['inventory must be an object']
  }
  if (inventory.version !== 1) errors.push('version must be 1')
  if (!Array.isArray(inventory.entries)) return [...errors, 'entries must be an array']

  const seen = new Set()
  for (const [index, entry] of inventory.entries.entries()) {
    const prefix = `entries[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (typeof entry.path !== 'string' || !entry.path.startsWith('src/')) {
      errors.push(`${prefix}.path must be a repository-relative src/ path`)
    }
    if (typeof entry.launcher !== 'string' || entry.launcher.length === 0) {
      errors.push(`${prefix}.launcher must be a non-empty string`)
    }
    if (!Number.isInteger(entry.occurrence) || entry.occurrence < 1) {
      errors.push(`${prefix}.occurrence must be a positive integer`)
    }
    if (typeof entry.owner !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.owner)) {
      errors.push(`${prefix}.owner must be a kebab-case identifier`)
    }
    if (!CATEGORIES.has(entry.category)) {
      errors.push(`${prefix}.category must be one of: ${[...CATEGORIES].join(', ')}`)
    }

    if (
      typeof entry.path === 'string' &&
      typeof entry.launcher === 'string' &&
      Number.isInteger(entry.occurrence)
    ) {
      const id = siteId(entry)
      if (seen.has(id)) errors.push(`${prefix} duplicates ${id}`)
      seen.add(id)
    }
  }

  return errors
}

async function main() {
  const { inventoryPath, root } = getConfiguredPaths()
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'))
  const inventoryErrors = validateInventory(inventory)
  if (inventoryErrors.length > 0) {
    for (const error of inventoryErrors) {
      console.error(`[process-launcher-inventory-invalid] ${error}`)
    }
    process.exitCode = 1
    return
  }

  const detectedSites = await scanLaunchers(root)
  const detectedById = new Map(detectedSites.map((site) => [siteId(site), site]))
  const expectedById = new Map(inventory.entries.map((entry) => [siteId(entry), entry]))
  const violations = []

  for (const site of detectedSites) {
    if (!expectedById.has(siteId(site))) {
      violations.push(
        `[process-launcher-unclassified] ${site.path}:${site.line} ${site.launcher}#${site.occurrence} has no owner/category`
      )
    }
  }

  for (const entry of inventory.entries) {
    if (!detectedById.has(siteId(entry))) {
      violations.push(
        `[process-launcher-inventory-drift] missing ${entry.path} ${entry.launcher}#${entry.occurrence} owner=${entry.owner} category=${entry.category}`
      )
    }
  }

  if (violations.length > 0) {
    for (const violation of violations.sort()) console.error(violation)
    process.exitCode = 1
    return
  }

  console.log(`Process launcher inventory guard passed (${detectedSites.length} classified sites).`)
}

main().catch((error) => {
  console.error(
    `[process-launcher-inventory-error] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
