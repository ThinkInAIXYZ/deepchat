import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.vue'
])

const MAIN_GUARD_PATHS = [
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter'),
  path.join(ROOT, 'src/main/lib/agentRuntime')
]

const RENDERER_SOURCE_ROOT = path.join(ROOT, 'src/renderer/src')
const RENDERER_SETTINGS_ROOT = path.join(ROOT, 'src/renderer/settings')
const RENDERER_BUSINESS_ROOTS = [RENDERER_SOURCE_ROOT, RENDERER_SETTINGS_ROOT]
const RENDERER_TYPED_BOUNDARY_ROOT = path.join(ROOT, 'src/renderer/api')
const RENDERER_QUARANTINE_ROOT = path.join(ROOT, 'src/renderer/api/legacy')
const RENDERER_QUARANTINE_ROOTS = []
const RETIRED_RENDERER_LEGACY_ENTRY_PATHS = [
  path.join(ROOT, 'src/renderer/src/composables/usePresenter.ts'),
  RENDERER_QUARANTINE_ROOT
]
const RENDERER_TYPED_BOUNDARY_WINDOW_API_ALLOWLIST = [
  path.join(ROOT, 'src/renderer/api/runtime.ts')
]
const MAIN_SOURCE_ROOT = path.join(ROOT, 'src/main')
const SHARED_SOURCE_ROOT = path.join(ROOT, 'src/shared')
const ROUTE_ROOT_PATH = path.join(ROOT, 'src/main/routes/index.ts')
const PRESENTER_COMPATIBILITY_CORE_PATH = path.join(
  ROOT,
  'src/shared/types/presenters/core.presenter.d.ts'
)
const MAIN_PRESENTER_ROOT = path.join(ROOT, 'src/main/presenter')
const SQLITE_TABLE_ROOT = path.join(MAIN_PRESENTER_ROOT, 'sqlitePresenter/tables')
const TRACKED_ARCHITECTURE_GROWTH_BASELINE_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/architecture-growth.json'
)
const ARCHITECTURE_GROWTH_BASELINE_PATH =
  process.env.NODE_ENV === 'test' &&
  process.env.DEEPCHAT_TEST_ARCHITECTURE_GROWTH_BASELINE_PATH
    ? path.resolve(ROOT, process.env.DEEPCHAT_TEST_ARCHITECTURE_GROWTH_BASELINE_PATH)
    : TRACKED_ARCHITECTURE_GROWTH_BASELINE_PATH
const MEMORY_PRESENTER_ROOT = path.join(ROOT, 'src/main/presenter/memoryPresenter')
const MEMORY_PRESENTER_FACADE_PATH = path.join(MEMORY_PRESENTER_ROOT, 'index.ts')
const MEMORY_PRESENTER_CORE_ROOT = path.join(MEMORY_PRESENTER_ROOT, 'core')
const MEMORY_PRESENTER_INFRA_ROOT = path.join(MEMORY_PRESENTER_ROOT, 'infra')
const MEMORY_PRESENTER_SERVICES_ROOT = path.join(MEMORY_PRESENTER_ROOT, 'services')
const MEMORY_PRESENTER_CORE_ALLOWED_ROOT_MODULES = new Set([
  path.join(MEMORY_PRESENTER_ROOT, 'types.ts')
])
const MEMORY_PRESENTER_RUNTIME_ALLOWED_ROOT_MODULES = new Set([
  path.join(MEMORY_PRESENTER_ROOT, 'context.ts'),
  path.join(MEMORY_PRESENTER_ROOT, 'ports.ts'),
  path.join(MEMORY_PRESENTER_ROOT, 'runtimeConstants.ts'),
  path.join(MEMORY_PRESENTER_ROOT, 'types.ts')
])
const MEMORY_PRESENTER_SERVICE_LEAF_MODULES = new Set([
  path.join(MEMORY_PRESENTER_SERVICES_ROOT, 'rowMutations.ts')
])
const PHASE_ORDER = new Map([
  ['P0', 0],
  ['P1', 1],
  ['P2', 2],
  ['P3', 3],
  ['P4', 4],
  ['P5', 5]
])
const BRIDGE_REGISTER_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/main-kernel-bridge-register.json'
)

const RENDERER_IPC_GUARD_PATHS = [
  path.join(ROOT, 'src/renderer/src/App.vue'),
  path.join(ROOT, 'src/renderer/src/stores/ui/session.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/message.ts'),
  path.join(ROOT, 'src/renderer/src/lib/storeInitializer.ts')
]

const MIGRATED_RAW_CHANNEL_GUARD_PATHS = [
  path.join(ROOT, 'src/renderer/src/App.vue'),
  path.join(ROOT, 'src/renderer/src/stores/uiSettingsStore.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/session.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/message.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/agent.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/pendingInput.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/pageRouter.ts'),
  path.join(ROOT, 'src/renderer/src/pages/ChatPage.vue'),
  path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
  path.join(ROOT, 'src/renderer/settings'),
  path.join(ROOT, 'src/main/presenter/windowPresenter'),
  path.join(ROOT, 'src/main/presenter/configPresenter'),
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter'),
  path.join(ROOT, 'src/main/presenter/llmProviderPresenter'),
  path.join(ROOT, 'src/shared/contracts'),
  path.join(ROOT, 'src/renderer/api'),
  path.join(ROOT, 'src/preload/createBridge.ts'),
  path.join(ROOT, 'src/preload/bridges'),
  path.join(ROOT, 'src/main/ipc'),
  path.join(ROOT, 'src/main/routes')
]

const MIGRATED_RAW_CHANNEL_BASELINE = new Map()

const HOT_PATH_FILES = [
  path.join(ROOT, 'src/main/presenter/index.ts'),
  path.join(ROOT, 'src/main/eventbus.ts'),
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/llmProviderPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter/index.ts')
]

const HOT_PATH_EDGE_BASELINE = 11

const GENERIC_LEGACY_PRESENTER_CALL_PATTERN =
  /(?<!function\s)\b(?:usePresenter|useLegacyPresenter)\s*\(/g
const LEGACY_PRESENTER_HELPER_CALL_PATTERN =
  /(?<!function\s)\b(?:usePresenter|useLegacyPresenter|useLegacy[A-Z][A-Za-z]*Presenter)\s*\(/g
const LEGACY_PRESENTER_IMPORT_PATTERN =
  /\b(?:import|export)\b[\s\S]*?from\s*['"][^'"]*(?:composables\/usePresenter|legacy\/presenters)['"]|\bimport\s*['"][^'"]*(?:composables\/usePresenter|legacy\/presenters)['"]/g
const LEGACY_RUNTIME_IMPORT_PATTERN =
  /\b(?:import|export)\b[\s\S]*?from\s*['"][^'"]*legacy\/runtime['"]|\bimport\s*['"][^'"]*legacy\/runtime['"]/g
const WINDOW_ELECTRON_PATTERN = /window\.electron\b/g
const WINDOW_API_PATTERN = /window\.api\b/g
const IPC_RENDERER_LISTENER_PATTERN =
  /window\.electron(?:\?\.|\.)ipcRenderer(?:\?\.|\.)(?:on|once|addListener)\s*\(/g
const INLINE_IPC_CHANNEL_PATTERN =
  /(?:window\.electron(?:\?\.|\.)ipcRenderer|ipcRenderer|ipcMain)(?:\?\.|\.)(?:invoke|send|on|once|handle|handleOnce|removeListener|removeAllListeners|addListener)\s*\(\s*['"`][^'"`]+['"`]/g
const INLINE_EVENTBUS_CHANNEL_PATTERN =
  /(?:sendToRenderer|publish|publishToWindow|publishToWebContents)\s*\(\s*['"`][^'"`]+['"`]/g
const TYPED_ROUTE_CASE_PATTERN = /\bcase\s+[A-Za-z_$][\w$]*Route\.name\s*:/g
const OPERATION_RUNNER_PATH = path.join(ROOT, 'src/main/routes/operationRunner.ts')
const RETIRED_ROUTE_SCHEDULER_PATH = path.join(ROOT, 'src/main/routes/scheduler.ts')
const OPERATION_RUNNER_ALLOWED_METHODS = new Set([
  'sleep',
  'observeIdempotent',
  'retryIdempotent',
  'timeout',
  'retry'
])
const LEGACY_OPERATION_RUNNER_ALLOWLIST = new Map([
  ['src/main/routes/sessions/sessionService.ts#createSession#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#restoreSession#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#listMessagesPage#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#listSessions#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#activateSession#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#deactivateSession#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#getActiveSession#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#getActiveSession#retry', 1],
  ['src/main/routes/sessions/sessionService.ts#resolveSessionWithRetry#timeout', 1],
  ['src/main/routes/sessions/sessionService.ts#resolveSessionWithRetry#retry', 1],
  ['src/main/routes/chat/chatService.ts#sendMessage#timeout', 3],
  ['src/main/routes/chat/chatService.ts#steerActiveTurn#timeout', 2],
  ['src/main/routes/chat/chatService.ts#stopStream#timeout', 2],
  ['src/main/routes/chat/chatService.ts#respondToolInteraction#timeout', 1],
  ['src/main/routes/providers/providerService.ts#listModels#timeout', 2],
  ['src/main/routes/providers/providerService.ts#testConnection#timeout', 1]
])

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function relativePath(filePath) {
  return toPosix(path.relative(ROOT, filePath))
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function isUnder(targetPath, parentPath) {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedParent = path.resolve(parentPath)
  return (
    normalizedTarget === normalizedParent ||
    normalizedTarget.startsWith(`${normalizedParent}${path.sep}`)
  )
}

function isRendererQuarantineFile(filePath) {
  return RENDERER_QUARANTINE_ROOTS.some((quarantineRoot) => isUnder(filePath, quarantineRoot))
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function collectFiles(entryPath) {
  const stats = await fs.stat(entryPath)
  if (stats.isFile()) {
    return isSourceFile(entryPath) ? [entryPath] : []
  }

  const entries = await fs.readdir(entryPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const nextPath = path.join(entryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(nextPath)))
      continue
    }
    if (entry.isFile() && isSourceFile(nextPath)) {
      files.push(nextPath)
    }
  }
  return files
}

function countMatches(source, pattern) {
  let count = 0
  pattern.lastIndex = 0

  while (pattern.exec(source) !== null) {
    count += 1
  }

  pattern.lastIndex = 0
  return count
}

function countPhysicalLines(source) {
  if (source.length === 0) return 0

  const lineCount = source.split(/\r\n|\r|\n/).length
  return /(?:\r\n|\r|\n)$/.test(source) ? lineCount - 1 : lineCount
}

function findOwningClassMethod(source, callIndex) {
  const methodPattern = /^  (?:private\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*\(/gm
  let owner
  let match
  while ((match = methodPattern.exec(source)) !== null && match.index < callIndex) {
    owner = match[1]
  }
  return owner
}

async function checkOperationRunnerContract(fileSet, violations) {
  if (await pathExists(RETIRED_ROUTE_SCHEDULER_PATH)) {
    violations.push('[operation-runner-retired-scheduler] src/main/routes/scheduler.ts must remain deleted')
  }

  const runnerSource = await fs.readFile(OPERATION_RUNNER_PATH, 'utf8')
  const interfaceBody = runnerSource.match(
    /export interface OperationRunner \{([\s\S]*?)^\}/m
  )?.[1]
  const actualMethods = new Set()
  const methodPattern = /^  ([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*\(/gm
  let methodMatch
  while (interfaceBody && (methodMatch = methodPattern.exec(interfaceBody)) !== null) {
    actualMethods.add(methodMatch[1])
  }
  const unexpectedMethods = [...actualMethods].filter(
    (method) => !OPERATION_RUNNER_ALLOWED_METHODS.has(method)
  )
  const missingMethods = [...OPERATION_RUNNER_ALLOWED_METHODS].filter(
    (method) => !actualMethods.has(method)
  )
  if (unexpectedMethods.length > 0 || missingMethods.length > 0) {
    violations.push(
      `[operation-runner-surface] expected ${[...OPERATION_RUNNER_ALLOWED_METHODS].join(', ')}, found ${[...actualMethods].join(', ')}`
    )
  }

  const actualLegacyCalls = new Map()
  for (const filePath of fileSet) {
    if (!isUnder(filePath, path.join(ROOT, 'src/main/routes'))) continue
    const source = await fs.readFile(filePath, 'utf8')
    if (/\brunCancellable\b/.test(source)) {
      violations.push(`[operation-runner-unused-cancellable] ${relativePath(filePath)}`)
    }

    const callPattern = /\b(?:this\.deps\.)?scheduler\.(timeout|retry)\s*(?:<[\s\S]*?>)?\s*\(/g
    let callMatch
    while ((callMatch = callPattern.exec(source)) !== null) {
      const owner = findOwningClassMethod(source, callMatch.index) ?? '<module>'
      const key = `${relativePath(filePath)}#${owner}#${callMatch[1]}`
      actualLegacyCalls.set(key, (actualLegacyCalls.get(key) ?? 0) + 1)
    }
  }

  const allLegacyKeys = new Set([
    ...LEGACY_OPERATION_RUNNER_ALLOWLIST.keys(),
    ...actualLegacyCalls.keys()
  ])
  for (const key of allLegacyKeys) {
    const expected = LEGACY_OPERATION_RUNNER_ALLOWLIST.get(key) ?? 0
    const actual = actualLegacyCalls.get(key) ?? 0
    if (actual !== expected) {
      violations.push(`[operation-runner-legacy-call] ${key} expected ${expected}, found ${actual}`)
    }
  }
}

function extractModuleSpecifierOccurrences(source) {
  const specifiers = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1])
    }
  }

  return specifiers
}

async function resolveImport(specifier, importer, aliasRoot = MAIN_SOURCE_ROOT) {
  const tryFile = async (basePath) => {
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
      `${basePath}.vue`,
      `${basePath}.d.ts`,
      path.join(basePath, 'index.ts'),
      path.join(basePath, 'index.tsx'),
      path.join(basePath, 'index.js'),
      path.join(basePath, 'index.jsx'),
      path.join(basePath, 'index.vue'),
      path.join(basePath, 'index.d.ts')
    ]

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate)
        if (stat.isFile()) {
          return candidate
        }
      } catch {}
    }

    return null
  }

  if (specifier.startsWith('@/')) {
    return await tryFile(path.join(aliasRoot, specifier.slice(2)))
  }

  if (specifier.startsWith('.')) {
    return await tryFile(path.resolve(path.dirname(importer), specifier))
  }

  return null
}

async function collectHotPathDirectEdges() {
  const hotPathFileSet = new Set(HOT_PATH_FILES)
  const edges = []

  for (const filePath of HOT_PATH_FILES) {
    const source = await fs.readFile(filePath, 'utf8')
    const specifiers = extractModuleSpecifiers(source)

    for (const specifier of specifiers) {
      const resolved = await resolveImport(specifier, filePath)
      if (!resolved || !hotPathFileSet.has(resolved)) {
        continue
      }

      edges.push(`${relativePath(filePath)} -> ${relativePath(resolved)}`)
    }
  }

  return edges.sort()
}

async function loadArchitectureGrowthBaseline() {
  const raw = await fs.readFile(ARCHITECTURE_GROWTH_BASELINE_PATH, 'utf8')
  const parsed = JSON.parse(raw)

  if (parsed?.version !== 1) {
    throw new Error(`version must be 1, found ${String(parsed?.version)}`)
  }
  const updatedOnTimestamp = Date.parse(`${parsed?.updatedOn}T00:00:00Z`)
  if (
    typeof parsed.updatedOn !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed.updatedOn) ||
    Number.isNaN(updatedOnTimestamp) ||
    new Date(updatedOnTimestamp).toISOString().slice(0, 10) !== parsed.updatedOn
  ) {
    throw new Error('updatedOn must be a valid YYYY-MM-DD date')
  }

  const limits = {
    mainComposition: {
      routeRootLoc: parsed?.mainComposition?.routeRootLoc,
      routeTypedCaseCount: parsed?.mainComposition?.routeTypedCaseCount,
      routeConcretePresenterImportCount:
        parsed?.mainComposition?.routeConcretePresenterImportCount,
      routeConcreteSqliteTableImportCount:
        parsed?.mainComposition?.routeConcreteSqliteTableImportCount,
      presenterCompatibilityCoreLoc: parsed?.mainComposition?.presenterCompatibilityCoreLoc
    },
    agentEdge: {
      sharedToMainImplementationImportCount:
        parsed?.agentEdge?.sharedToMainImplementationImportCount
    }
  }

  for (const [category, metrics] of Object.entries(limits)) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${category}.${metric} must be a non-negative integer`)
      }
    }
  }

  return limits
}

function isSharedToMainImplementationSpecifier(specifier, importer) {
  if (specifier === '@/presenter' || specifier.startsWith('@/presenter/')) {
    return true
  }

  if (specifier === 'src/main' || specifier.startsWith('src/main/')) {
    return true
  }

  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) {
    return false
  }

  const target = path.isAbsolute(specifier)
    ? path.resolve(specifier)
    : path.resolve(path.dirname(importer), specifier)
  return isUnder(target, MAIN_SOURCE_ROOT)
}

async function collectArchitectureGrowthMetrics(fileSet) {
  const [routeSource, presenterCompatibilityCoreSource] = await Promise.all([
    fs.readFile(ROUTE_ROOT_PATH, 'utf8'),
    fs.readFile(PRESENTER_COMPATIBILITY_CORE_PATH, 'utf8')
  ])
  const routeSpecifiers = extractModuleSpecifierOccurrences(routeSource)
  let routeConcretePresenterImportCount = 0
  let routeConcreteSqliteTableImportCount = 0

  for (const specifier of routeSpecifiers) {
    const resolved = await resolveImport(specifier, ROUTE_ROOT_PATH)
    if (!resolved) continue

    if (isUnder(resolved, MAIN_PRESENTER_ROOT)) {
      routeConcretePresenterImportCount += 1
    }
    if (isUnder(resolved, SQLITE_TABLE_ROOT)) {
      routeConcreteSqliteTableImportCount += 1
    }
  }

  let sharedToMainImplementationImportCount = 0
  for (const filePath of fileSet) {
    if (!isUnder(filePath, SHARED_SOURCE_ROOT)) continue

    const source = await fs.readFile(filePath, 'utf8')
    for (const specifier of extractModuleSpecifierOccurrences(source)) {
      if (isSharedToMainImplementationSpecifier(specifier, filePath)) {
        sharedToMainImplementationImportCount += 1
      }
    }
  }

  return {
    mainComposition: {
      routeRootLoc: countPhysicalLines(routeSource),
      routeTypedCaseCount: countMatches(routeSource, TYPED_ROUTE_CASE_PATTERN),
      routeConcretePresenterImportCount,
      routeConcreteSqliteTableImportCount,
      presenterCompatibilityCoreLoc: countPhysicalLines(presenterCompatibilityCoreSource)
    },
    agentEdge: {
      sharedToMainImplementationImportCount
    }
  }
}

async function checkArchitectureGrowth(fileSet, violations) {
  let limits

  try {
    limits = await loadArchitectureGrowthBaseline()
  } catch (error) {
    violations.push(
      `[architecture-growth-baseline-invalid] ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }

  const actual = await collectArchitectureGrowthMetrics(fileSet)
  for (const [category, metrics] of Object.entries(actual)) {
    for (const [metric, value] of Object.entries(metrics)) {
      const limit = limits[category][metric]
      if (value > limit) {
        violations.push(
          `[${category === 'mainComposition' ? 'main-composition' : 'agent-edge'}-growth] ${metric} expected <= ${limit}, found ${value}`
        )
      }
    }
  }
}

function memoryPresenterLayer(filePath) {
  if (!isUnder(filePath, MEMORY_PRESENTER_ROOT)) return null
  if (isUnder(filePath, MEMORY_PRESENTER_CORE_ROOT)) return 'core'
  if (isUnder(filePath, MEMORY_PRESENTER_INFRA_ROOT)) return 'infra'
  if (isUnder(filePath, MEMORY_PRESENTER_SERVICES_ROOT)) return 'services'
  return 'root'
}

function isAllowedMemoryPresenterCoreRootModule(filePath) {
  return MEMORY_PRESENTER_CORE_ALLOWED_ROOT_MODULES.has(path.resolve(filePath))
}

function isAllowedMemoryPresenterRuntimeRootModule(filePath) {
  return MEMORY_PRESENTER_RUNTIME_ALLOWED_ROOT_MODULES.has(path.resolve(filePath))
}

function isMemoryPresenterFacade(filePath) {
  return path.resolve(filePath) === path.resolve(MEMORY_PRESENTER_FACADE_PATH)
}

async function checkMemoryPresenterLayerImports(filePath, specifiers, violations) {
  const importerLayer = memoryPresenterLayer(filePath)
  if (!importerLayer) return

  for (const specifier of specifiers) {
    const resolved = await resolveImport(specifier, filePath)
    if (!resolved || !isUnder(resolved, MEMORY_PRESENTER_ROOT)) continue

    const importedLayer = memoryPresenterLayer(resolved)
    if (!importedLayer) continue

    if (importerLayer === 'root') {
      if (isMemoryPresenterFacade(filePath)) continue

      const allowed =
        importedLayer === 'core' || (importedLayer === 'root' && !isMemoryPresenterFacade(resolved))
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; only memoryPresenter/index.ts may import services, infra, or the facade entrypoint`
        )
      }
      continue
    }

    if (importerLayer === 'core') {
      const allowed = importedLayer === 'core' || isAllowedMemoryPresenterCoreRootModule(resolved)
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; core may only import core files and root contracts`
        )
      }
      continue
    }

    if (importerLayer === 'infra') {
      const allowed =
        importedLayer === 'infra' ||
        importedLayer === 'core' ||
        isAllowedMemoryPresenterRuntimeRootModule(resolved)
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; infra must not import services or facade entrypoints`
        )
      }
      continue
    }

    if (importerLayer === 'services') {
      const sameFile = path.resolve(filePath) === path.resolve(resolved)
      const allowedServiceLeaf = MEMORY_PRESENTER_SERVICE_LEAF_MODULES.has(path.resolve(resolved))
      const allowedRootModule =
        importedLayer !== 'root' || isAllowedMemoryPresenterRuntimeRootModule(resolved)

      if (importedLayer === 'services' && !sameFile && !allowedServiceLeaf) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; service-to-service imports must use facade ports, except rowMutations`
        )
      }

      if (importedLayer === 'infra') {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; services must depend on root port contracts, not infra concrete modules`
        )
      }

      if (!allowedRootModule) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(filePath)} -> ${relativePath(resolved)}; services may only import root runtime contracts`
        )
      }
    }
  }
}

async function loadBridgeRegister() {
  const raw = await fs.readFile(BRIDGE_REGISTER_PATH, 'utf8')
  const parsed = JSON.parse(raw)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('bridge register must be a JSON object')
  }

  if (!PHASE_ORDER.has(parsed.currentPhase)) {
    throw new Error(`unsupported currentPhase: ${String(parsed.currentPhase)}`)
  }

  if (!Array.isArray(parsed.bridges)) {
    throw new Error('bridge register must include a bridges array')
  }

  const currentPhaseOrder = PHASE_ORDER.get(parsed.currentPhase)
  const seenIds = new Set()
  for (const bridge of parsed.bridges) {
    if (!bridge || typeof bridge !== 'object') {
      throw new Error('bridge entries must be JSON objects')
    }

    const requiredFields = [
      'id',
      'owner',
      'legacyEntry',
      'newTarget',
      'introducedIn',
      'deleteByPhase',
      'status',
      'notes'
    ]

    for (const field of requiredFields) {
      if (typeof bridge[field] !== 'string' || bridge[field].trim().length === 0) {
        throw new Error(`bridge entry field ${field} must be a non-empty string`)
      }
    }

    if (!PHASE_ORDER.has(bridge.introducedIn)) {
      throw new Error(`bridge ${bridge.id} has unsupported introducedIn ${bridge.introducedIn}`)
    }

    if (!PHASE_ORDER.has(bridge.deleteByPhase)) {
      throw new Error(`bridge ${bridge.id} has unsupported deleteByPhase ${bridge.deleteByPhase}`)
    }

    if (bridge.status !== 'active' && bridge.status !== 'removed') {
      throw new Error(`bridge ${bridge.id} has unsupported status ${bridge.status}`)
    }

    const deleteByPhaseOrder = PHASE_ORDER.get(bridge.deleteByPhase)
    if (
      bridge.status === 'active' &&
      currentPhaseOrder !== undefined &&
      deleteByPhaseOrder !== undefined &&
      deleteByPhaseOrder <= currentPhaseOrder
    ) {
      throw new Error(
        `bridge ${bridge.id} is active but deleteByPhase ${bridge.deleteByPhase} is at or before currentPhase ${parsed.currentPhase}`
      )
    }

    if (seenIds.has(bridge.id)) {
      throw new Error(`duplicate bridge id ${bridge.id}`)
    }

    seenIds.add(bridge.id)
  }
}

function extractModuleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1])
    }
  }

  return [...specifiers]
}

async function main() {
  const scanRoots = [path.join(ROOT, 'src'), path.join(ROOT, 'docs')]
  const fileSet = new Set()

  for (const root of scanRoots) {
    for (const file of await collectFiles(root)) {
      fileSet.add(file)
    }
  }

  const violations = []

  try {
    await loadBridgeRegister()
  } catch (error) {
    violations.push(`[bridge-register-invalid] ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const retiredEntryPath of RETIRED_RENDERER_LEGACY_ENTRY_PATHS) {
    if (await pathExists(retiredEntryPath)) {
      violations.push(
        `[renderer-retired-legacy-entry] ${relativePath(retiredEntryPath)} must remain deleted`
      )
    }
  }

  for (const filePath of [...fileSet].sort()) {
    const source = await fs.readFile(filePath, 'utf8')
    const specifiers = extractModuleSpecifiers(source)

    await checkMemoryPresenterLayerImports(filePath, specifiers, violations)

    if (RENDERER_BUSINESS_ROOTS.some((root) => isUnder(filePath, root))) {
      const file = relativePath(filePath)
      const legacyPresenterHelperCount = countMatches(
        source,
        LEGACY_PRESENTER_HELPER_CALL_PATTERN
      )
      const legacyPresenterImportCount = countMatches(source, LEGACY_PRESENTER_IMPORT_PATTERN)
      const legacyRuntimeImportCount = countMatches(source, LEGACY_RUNTIME_IMPORT_PATTERN)
      const windowElectronCount = countMatches(source, WINDOW_ELECTRON_PATTERN)
      const windowApiCount = countMatches(source, WINDOW_API_PATTERN)
      const actualListenerCount = countMatches(source, IPC_RENDERER_LISTENER_PATTERN)

      if (legacyPresenterImportCount > 0) {
        violations.push(
          `[renderer-business-direct-use-presenter-import] ${file} must not import renderer legacy presenter helpers`
        )
      }

      if (legacyRuntimeImportCount > 0) {
        violations.push(
          `[renderer-business-direct-legacy-runtime-import] ${file} must not import renderer legacy runtime helpers`
        )
      }

      if (legacyPresenterHelperCount > 0) {
        violations.push(
          `[renderer-business-direct-use-presenter] ${file} expected 0, found ${legacyPresenterHelperCount}`
        )
      }

      if (windowElectronCount > 0) {
        violations.push(
          `[renderer-business-direct-window-electron] ${file} expected 0, found ${windowElectronCount}`
        )
      }

      if (windowApiCount > 0) {
        violations.push(
          `[renderer-business-direct-window-api] ${file} expected 0, found ${windowApiCount}`
        )
      }

      if (actualListenerCount > 0) {
        violations.push(
          `[renderer-business-direct-ipc-listener] ${file} expected 0, found ${actualListenerCount}`
        )
      }
    }

    if (isUnder(filePath, RENDERER_TYPED_BOUNDARY_ROOT) && !isRendererQuarantineFile(filePath)) {
      const file = relativePath(filePath)
      const usePresenterCount = countMatches(source, GENERIC_LEGACY_PRESENTER_CALL_PATTERN)
      const windowElectronCount = countMatches(source, WINDOW_ELECTRON_PATTERN)
      const windowApiCount = countMatches(source, WINDOW_API_PATTERN)
      const allowsWindowApi = RENDERER_TYPED_BOUNDARY_WINDOW_API_ALLOWLIST.some(
        (allowlistedPath) => path.resolve(filePath) === path.resolve(allowlistedPath)
      )

      if (usePresenterCount > 0) {
        violations.push(`[renderer-typed-boundary-direct-use-presenter] ${file}`)
      }

      if (windowElectronCount > 0) {
        violations.push(`[renderer-typed-boundary-direct-window-electron] ${file}`)
      }

      if (windowApiCount > 0 && !allowsWindowApi) {
        violations.push(`[renderer-typed-boundary-direct-window-api] ${file}`)
      }
    }

    if (MIGRATED_RAW_CHANNEL_GUARD_PATHS.some((guardPath) => isUnder(filePath, guardPath))) {
      const file = relativePath(filePath)
      const actualRawChannelCount =
        countMatches(source, INLINE_IPC_CHANNEL_PATTERN) +
        countMatches(source, INLINE_EVENTBUS_CHANNEL_PATTERN)
      const baselineRawChannelCount = MIGRATED_RAW_CHANNEL_BASELINE.get(file) ?? 0

      if (actualRawChannelCount > baselineRawChannelCount) {
        violations.push(
          `[migrated-raw-channel-growth] ${file} expected <= ${baselineRawChannelCount}, found ${actualRawChannelCount}`
        )
      }
    }

    if (isUnder(filePath, path.join(ROOT, 'src'))) {
      for (const specifier of specifiers) {
        if (specifier.includes('archives/code/')) {
          violations.push(`[archive-import] ${relativePath(filePath)} -> ${specifier}`)
        }
      }
    }

    if (MAIN_GUARD_PATHS.some((guardPath) => isUnder(filePath, guardPath))) {
      for (const specifier of specifiers) {
        if (
          specifier === '@/presenter' ||
          specifier === '@/presenter/index' ||
          specifier === '../index' ||
          specifier === '../../index'
        ) {
          violations.push(`[main-global-presenter] ${relativePath(filePath)} -> ${specifier}`)
        }
      }
    }

    if (RENDERER_IPC_GUARD_PATHS.some((guardPath) => isUnder(filePath, guardPath))) {
      if (source.includes('window.electron.ipcRenderer.on(')) {
        violations.push(`[renderer-direct-ipc] ${relativePath(filePath)}`)
      }
      if (source.includes('window.electron.ipcRenderer.removeAllListeners(')) {
        violations.push(`[renderer-remove-all-listeners] ${relativePath(filePath)}`)
      }
    }
  }

  await checkArchitectureGrowth(fileSet, violations)
  await checkOperationRunnerContract(fileSet, violations)

  const hotPathEdges = await collectHotPathDirectEdges()
  if (hotPathEdges.length > HOT_PATH_EDGE_BASELINE) {
    violations.push(
      `[hotpath-presenter-edge-growth] expected <= ${HOT_PATH_EDGE_BASELINE}, found ${hotPathEdges.length}`
    )
  }

  if (violations.length > 0) {
    console.error('Architecture guard failed.')
    for (const violation of violations) {
      console.error(`- ${violation}`)
    }
    process.exit(1)
  }

  console.log('Architecture guard passed.')
}

main().catch((error) => {
  console.error('Architecture guard failed to run:', error)
  process.exit(1)
})
