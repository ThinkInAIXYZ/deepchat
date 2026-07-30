import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const REPORT_DIR = path.join(ROOT, 'docs/architecture/baselines')
const execFileAsync = promisify(execFile)
const AGENT_SYSTEM_SOURCE_ROOTS = [
  'src/main/agent/shared',
  'src/main/agent/manager',
  'src/main/agent/deepchat',
  'src/main/agent/acp'
]
const AGENT_SYSTEM_RUNTIME_BOUNDARY_FILES = [
  'src/main/session/query.ts',
  'src/main/session/assignment.ts',
  'src/main/session/turn.ts',
  'src/main/session/lifecycle.ts',
  'src/main/agent/deepchat/harness/deepChatAgentHarness.ts',
  'src/main/agent/deepchat/harness/createDeepChatAgentHarness.ts',
  'src/main/agent/deepchat/runtime/runLifecycleCoordinator.ts',
  'src/main/agent/deepchat/runtime/sessionStatusPublisher.ts',
  'src/main/agent/deepchat/runtime/pendingInputAdmissionCoordinator.ts',
  'src/main/agent/deepchat/runtime/pendingInputPump.ts',
  'src/main/agent/deepchat/runtime/turnCoordinator.ts',
  'src/main/agent/deepchat/runtime/compactionRuntimeCoordinator.ts',
  'src/main/agent/deepchat/runtime/sessionSettingsCoordinator.ts',
  'src/main/agent/deepchat/runtime/runtimeHookSink.ts',
  'src/main/agent/deepchat/runtime/process.ts',
  'src/main/agent/deepchat/runtime/dispatch.ts',
  'src/main/session/data/transcript.ts',
  'src/main/tape/application/sessionTape.ts',
  'src/main/tape/ports/capabilities.ts',
  'src/main/provider/providers/acpProvider.ts'
]
const AGENT_SYSTEM_EXPECTED_FILES = [
  'src/main/agent/shared/agentDescriptors.ts',
  'src/main/agent/shared/agentCatalogCodec.ts',
  'src/main/agent/shared/appSessionService.ts',
  'src/main/agent/manager/agentManager.ts',
  'src/main/agent/manager/sessionHandles.ts',
  'src/main/agent/manager/deepChatAgentBackend.ts',
  'src/main/agent/manager/directAcpAgentBackend.ts',
  'src/main/agent/deepchat/instance/deepChatAgentRuntime.ts',
  'src/main/agent/deepchat/instance/deepChatAgentInstance.ts',
  'src/main/agent/deepchat/loop/deepChatLoopEngine.ts',
  'src/main/agent/deepchat/loop/ports.ts',
  'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts',
  'src/main/agent/deepchat/memory/memoryPromptContributor.ts',
  'src/main/agent/deepchat/memory/memoryIngestionObserver.ts',
  'src/main/agent/acp/instance/acpAgentRuntime.ts',
  'src/main/agent/acp/instance/acpAgentInstance.ts',
  ...AGENT_SYSTEM_RUNTIME_BOUNDARY_FILES
]
const AGENT_SYSTEM_OWNER_EVIDENCE = [
  ['agentManager', 'src/main/agent/manager/agentManager.ts', /\bclass AgentManager\b/g],
  [
    'typedDeepChatBackend',
    'src/main/agent/manager/deepChatAgentBackend.ts',
    /\bfunction createDeepChatAgentBackend\b/g
  ],
  [
    'directAcpBackend',
    'src/main/agent/manager/directAcpAgentBackend.ts',
    /\b(?:function|const) createDirectAcpAgentBackend\b/g
  ],
  [
    'deepChatRuntime',
    'src/main/agent/deepchat/instance/deepChatAgentRuntime.ts',
    /\bclass DeepChatAgentRuntime\b/g
  ],
  [
    'deepChatInstance',
    'src/main/agent/deepchat/instance/deepChatAgentInstance.ts',
    /\bclass DeepChatAgentInstance\b/g
  ],
  [
    'deepChatLoopEngine',
    'src/main/agent/deepchat/loop/deepChatLoopEngine.ts',
    /\bclass DeepChatLoopEngine\b/g
  ],
  [
    'tapeToolFactWriter',
    'src/main/tape/ports/capabilities.ts',
    /\binterface TapeToolFactWriter\b/g
  ],
  [
    'memoryRuntimeCoordinator',
    'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts',
    /\bclass MemoryRuntimeCoordinator\b/g
  ],
  [
    'memoryPromptContributor',
    'src/main/agent/deepchat/memory/memoryPromptContributor.ts',
    /\binterface MemoryPromptContributor\b/g
  ],
  [
    'memoryIngestionObserver',
    'src/main/agent/deepchat/memory/memoryIngestionObserver.ts',
    /\binterface MemoryIngestionObserver\b/g
  ],
  [
    'acpRuntime',
    'src/main/agent/acp/instance/acpAgentRuntime.ts',
    /\bclass AcpAgentRuntime\b/g
  ],
  [
    'acpInstance',
    'src/main/agent/acp/instance/acpAgentInstance.ts',
    /\bclass AcpAgentInstance\b/g
  ],
  [
    'sessionQuery',
    'src/main/session/query.ts',
    /\bclass SessionQuery\b/g
  ],
  [
    'sessionAssignment',
    'src/main/session/assignment.ts',
    /\bclass SessionAssignment\b/g
  ],
  [
    'sessionTurn',
    'src/main/session/turn.ts',
    /\bclass SessionTurn\b/g
  ],
  [
    'sessionLifecycle',
    'src/main/session/lifecycle.ts',
    /\bclass SessionLifecycle\b/g
  ],
  [
    'deepChatAgentHarness',
    'src/main/agent/deepchat/harness/deepChatAgentHarness.ts',
    /\bclass DeepChatAgentHarness\b/g
  ],
  [
    'runLifecycleCoordinator',
    'src/main/agent/deepchat/runtime/runLifecycleCoordinator.ts',
    /\bclass RunLifecycleCoordinator\b/g
  ],
  [
    'sessionStatusPublisher',
    'src/main/agent/deepchat/runtime/sessionStatusPublisher.ts',
    /\bclass SessionStatusPublisher\b/g
  ],
  [
    'pendingInputAdmissionCoordinator',
    'src/main/agent/deepchat/runtime/pendingInputAdmissionCoordinator.ts',
    /\bclass PendingInputAdmissionCoordinator\b/g
  ],
  [
    'pendingInputPump',
    'src/main/agent/deepchat/runtime/pendingInputPump.ts',
    /\bclass PendingInputPump\b/g
  ],
  [
    'turnCoordinator',
    'src/main/agent/deepchat/runtime/turnCoordinator.ts',
    /\bclass TurnCoordinator\b/g
  ],
  [
    'compactionRuntimeCoordinator',
    'src/main/agent/deepchat/runtime/compactionRuntimeCoordinator.ts',
    /\bclass CompactionRuntimeCoordinator\b/g
  ],
  [
    'sessionSettingsCoordinator',
    'src/main/agent/deepchat/runtime/sessionSettingsCoordinator.ts',
    /\bclass SessionSettingsCoordinator\b/g
  ],
  [
    'runtimeHookSink',
    'src/main/agent/deepchat/runtime/runtimeHookSink.ts',
    /\bclass RuntimeHookSink\b/g
  ]
]
const AGENT_SYSTEM_RETIRED_PATHS = [
  'src/main/agent/manager/legacyAgentBackends.ts',
  'src/main/lib/agentRuntime',
  'src/main/presenter/index.ts',
  'src/main/presenter/agentSessionPresenter',
  'src/main/presenter/lifecyclePresenter',
  'src/main/presenter/sessionPresenter',
  'src/shared/lifecycle.ts',
  'src/shared/types/presenters/agent-session.presenter.d.ts',
  'src/shared/types/presenters/session.presenter.d.ts'
]
const AGENT_SYSTEM_RETIRED_SYMBOL_PATTERNS = [
  ['AgentRegistry', /\bAgentRegistry\b/g],
  ['AgentSessionPresenter', /\bAgentSessionPresenter\b/g],
  ['IAgentSessionPresenter', /\bIAgentSessionPresenter\b/g],
  ['IAgentImplementation', /\bIAgentImplementation\b/g],
  ['createLegacyAgentBackend', /\bcreateLegacyAgentBackend\b/g],
  ['LegacyDeepChatSessionBackend', /\bLegacyDeepChatSessionBackend\b/g],
  ['LegacyAcpSessionBackend', /\bLegacyAcpSessionBackend\b/g],
  ['LegacyAcpSessionHandle', /\bLegacyAcpSessionHandle\b/g],
  ['LegacyToolFactsSnapshotPort', /\bLegacyToolFactsSnapshotPort\b/g],
  ['appendAssistantToolFactsSnapshot', /\bappendAssistantToolFactsSnapshot\b/g]
]
const AGENT_HANDLE_BACKEND_RUNTIME_KIND_PATTERN =
  /\bruntimeKind\b\s*(?::|={1,3}|!==?)\s*['"](?:legacy|direct)['"]/g
const AGENT_SYSTEM_CONTRACT_ROOTS = [
  'src/shared/contracts/routes',
  'src/shared/contracts/events'
]
const SQLITE_SCHEMA_ROOTS = [
  'src/main/data/schemaCatalog.ts',
  'src/main/data/schemaCatalogMetadata.ts',
  'src/main/data/schemaTypes.ts'
]
const MEMORY_SIDECAR_SCHEMA_FILES = [
  'src/main/memory/infra/memoryVectorStore.ts'
]
const COMPOSITION_LIFECYCLE_FILES = [
  'src/main/app/mainProcess.ts',
  'src/main/app/composition.ts',
  'src/main/appMain.ts'
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.d.ts'])
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build'])
const PHASE_ORDER = new Map([
  ['P0', 0],
  ['P1', 1],
  ['P2', 2],
  ['P3', 3],
  ['P4', 4],
  ['P5', 5]
])

const MAIN_SOURCE_ROOT = path.join(ROOT, 'src/main')
const RENDERER_SOURCE_ROOT = path.join(ROOT, 'src/renderer/src')
const RENDERER_SETTINGS_ROOT = path.join(ROOT, 'src/renderer/settings')
const RENDERER_SHARED_ROOT = path.join(ROOT, 'src/renderer/services')

const ANALYSIS_TARGETS = [
  {
    label: 'main',
    root: MAIN_SOURCE_ROOT
  },
  {
    label: 'renderer-main',
    root: RENDERER_SOURCE_ROOT
  },
  {
    label: 'renderer-settings',
    root: RENDERER_SETTINGS_ROOT
  },
  {
    label: 'renderer-shared',
    root: RENDERER_SHARED_ROOT
  }
]

const RENDERER_BUSINESS_ROOTS = [
  RENDERER_SOURCE_ROOT,
  RENDERER_SETTINGS_ROOT,
  RENDERER_SHARED_ROOT
]
const RENDERER_QUARANTINE_ROOT = path.join(ROOT, 'src/renderer/api/legacy')
const RENDERER_QUARANTINE_ROOTS = []
const RENDERER_QUARANTINE_EXIT_MAX_FILES = 0
const BRIDGE_REGISTER_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/main-kernel-bridge-register.json'
)

const HOT_PATH_FILES = [
  path.join(ROOT, 'src/main/app/composition.ts'),
  path.join(ROOT, 'src/main/routes/index.ts'),
  path.join(ROOT, 'src/main/agent/deepchat/harness/createDeepChatAgentHarness.ts'),
  path.join(ROOT, 'src/main/provider/index.ts')
]

const MIGRATED_RAW_CHANNEL_GUARD_PATHS = [
  path.join(ROOT, 'src/renderer/src/App.vue'),
  path.join(ROOT, 'src/renderer/src/stores/uiSettingsStore.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/session.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/message.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/agent.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/pendingInput.ts'),
  path.join(ROOT, 'src/renderer/src/stores/ui/pageRouter.ts'),
  path.join(ROOT, 'src/renderer/src/features/chat-page/ChatPage.vue'),
  path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
  path.join(ROOT, 'src/main/desktop/window'),
  path.join(ROOT, 'src/main/config'),
  path.join(ROOT, 'src/main/agent/deepchat/runtime'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter'),
  path.join(ROOT, 'src/main/provider'),
  path.join(ROOT, 'src/shared/contracts'),
  path.join(ROOT, 'src/renderer/api'),
  path.join(ROOT, 'src/preload/createBridge.ts'),
  path.join(ROOT, 'src/preload/bridges'),
  path.join(ROOT, 'src/main/ipc'),
  path.join(ROOT, 'src/main/routes')
]

const GENERIC_LEGACY_PRESENTER_CALL_PATTERN =
  /(?<!function\s)\b(?:usePresenter|useLegacyPresenter)\s*\(/g
const LEGACY_PRESENTER_HELPER_CALL_PATTERN =
  /(?<!function\s)\b(?:usePresenter|useLegacyPresenter|useLegacy[A-Z][A-Za-z]*Presenter)\s*\(/g
const WINDOW_ELECTRON_PATTERN = /window\.electron\b/g
const WINDOW_API_PATTERN = /window\.api\b/g
const RAW_TIMER_PATTERN = /\b(?:setTimeout|setInterval)\s*\(/g
const INLINE_IPC_CHANNEL_PATTERN =
  /(?:window\.electron(?:\?\.|\.)ipcRenderer|ipcRenderer|ipcMain)(?:\?\.|\.)(?:invoke|send|on|once|handle|handleOnce|removeListener|removeAllListeners|addListener)\s*\(\s*['"`][^'"`]+['"`]/g
const INLINE_EVENTBUS_CHANNEL_PATTERN =
  /(?:sendToRenderer|publish|publishToWindow|publishToWebContents)\s*\(\s*['"`][^'"`]+['"`]/g
const PRESENTER_PHASE_GATES = {
  P2: ['configPresenter', 'providerRuntime'],
  P3: [
    'windowPresenter',
    'devicePresenter',
    'workspacePresenter',
    'projectPresenter',
    'filePresenter',
    'yoBrowserPresenter',
    'tabPresenter'
  ],
  P4: [
    'agentSessionPresenter',
    'skillPresenter',
    'mcpPresenter',
    'syncPresenter',
    'upgradePresenter',
    'dialogPresenter',
    'toolPresenter'
  ]
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function relativePath(filePath) {
  return toPosix(path.relative(ROOT, filePath))
}

function isUnder(targetPath, parentPath) {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedParent = path.resolve(parentPath)
  return (
    normalizedTarget === normalizedParent ||
    normalizedTarget.startsWith(`${normalizedParent}${path.sep}`)
  )
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function hashFiles(relativeFiles) {
  const hash = createHash('sha256')
  for (const file of [...relativeFiles].sort()) {
    const source = await fs.readFile(path.join(ROOT, file), 'utf8')
    hash.update(`${file}\0${source.replaceAll('\r\n', '\n')}\0`)
  }
  return hash.digest('hex')
}

async function collectRelativeSourceFiles(relativeRoots) {
  const files = []
  for (const root of relativeRoots) {
    const absoluteRoot = path.join(ROOT, root)
    for (const file of await walk(absoluteRoot)) files.push(relativePath(file))
  }
  return [...new Set(files)].sort()
}

async function getHeadCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })
  return stdout.trim()
}

async function getRelevantDirtyFiles(relativeRoots) {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: ROOT
  })
  const candidates = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1))
    .filter((file) => typeof file === 'string')
  return candidates
    .filter((file) =>
      relativeRoots.some((root) => file === root || file.startsWith(`${root.replace(/\/$/, '')}/`))
    )
    .sort()
}

function collectSqlTableIdentifiers(sources) {
  const identifiers = new Set()
  for (const source of sources) {
    for (const match of source.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS ([a-z][a-z0-9_]*)/g)) {
      identifiers.add(match[1])
    }
  }
  return [...identifiers].sort()
}

async function buildAgentSystemBaseline() {
  const expectedFiles = Object.fromEntries(
    await Promise.all(
      [...new Set(AGENT_SYSTEM_EXPECTED_FILES)]
        .sort()
        .map(async (file) => [file, await pathExists(path.join(ROOT, file))])
    )
  )
  const ownerEvidence = Object.fromEntries(
    await Promise.all(
      AGENT_SYSTEM_OWNER_EVIDENCE.map(async ([owner, file, pattern]) => {
        const exists = await pathExists(path.join(ROOT, file))
        const source = exists ? await fs.readFile(path.join(ROOT, file), 'utf8') : ''
        return [owner, { file, exists, declarationCount: countMatches(source, pattern) }]
      })
    )
  )
  const agentSourceFiles = [
    ...(await collectRelativeSourceFiles(AGENT_SYSTEM_SOURCE_ROOTS)),
    ...AGENT_SYSTEM_RUNTIME_BOUNDARY_FILES
  ]
  const productionFiles = await collectRelativeSourceFiles(['src/main', 'src/shared'])
  const productionSource = (
    await Promise.all(productionFiles.map((file) => fs.readFile(path.join(ROOT, file), 'utf8')))
  ).join('\n')
  const agentManagerFiles = await collectRelativeSourceFiles(['src/main/agent/manager'])
  const agentManagerSource = (
    await Promise.all(agentManagerFiles.map((file) => fs.readFile(path.join(ROOT, file), 'utf8')))
  ).join('\n')
  const retiredPaths = Object.fromEntries(
    await Promise.all(
      AGENT_SYSTEM_RETIRED_PATHS.sort().map(async (retiredPath) => [
        retiredPath,
        (await collectRelativeSourceFiles([retiredPath])).length
      ])
    )
  )
  const retiredSymbols = Object.fromEntries(
    AGENT_SYSTEM_RETIRED_SYMBOL_PATTERNS.map(([symbol, pattern]) => [
      symbol,
      countMatches(productionSource, pattern)
    ])
  )
  retiredSymbols.agentHandleLegacyDirectRuntimeKind = countMatches(
    agentManagerSource,
    AGENT_HANDLE_BACKEND_RUNTIME_KIND_PATTERN
  )
  const loopFiles = await collectRelativeSourceFiles(['src/main/agent/deepchat/loop'])
  const loopImports = []
  for (const file of loopFiles) {
    const source = await fs.readFile(path.join(ROOT, file), 'utf8')
    for (const specifier of extractSpecifiers(source)) {
      const resolved = await resolveImport(specifier, path.join(ROOT, file), MAIN_SOURCE_ROOT)
      loopImports.push({
        file,
        specifier,
        resolved: resolved ? relativePath(resolved) : null
      })
    }
  }
  const contractFiles = await collectRelativeSourceFiles(AGENT_SYSTEM_CONTRACT_ROOTS)
  const sqliteSchemaFiles = await collectRelativeSourceFiles(SQLITE_SCHEMA_ROOTS)
  const sqliteSchemaSources = await Promise.all(
    sqliteSchemaFiles.map((file) => fs.readFile(path.join(ROOT, file), 'utf8'))
  )
  const memorySidecarSchemaFiles = [...MEMORY_SIDECAR_SCHEMA_FILES].sort()
  const memorySidecarSchemaSources = await Promise.all(
    memorySidecarSchemaFiles.map((file) => fs.readFile(path.join(ROOT, file), 'utf8'))
  )
  const compositionLifecycleFiles = [...COMPOSITION_LIFECYCLE_FILES].sort()
  const relevantRoots = [
    ...AGENT_SYSTEM_SOURCE_ROOTS,
    ...AGENT_SYSTEM_RUNTIME_BOUNDARY_FILES,
    ...AGENT_SYSTEM_CONTRACT_ROOTS,
    ...SQLITE_SCHEMA_ROOTS,
    ...MEMORY_SIDECAR_SCHEMA_FILES,
    ...COMPOSITION_LIFECYCLE_FILES,
    ...AGENT_SYSTEM_RETIRED_PATHS,
    'scripts/generate-architecture-baseline.mjs',
    'scripts/agent-cleanup-guard.mjs'
  ]
  const relevantDirtyFiles = await getRelevantDirtyFiles(relevantRoots)
  const presenterRoot = path.join(ROOT, 'src/main/presenter')
  const routesRoot = path.join(ROOT, 'src/main/routes')
  const sqliteRoot = path.join(ROOT, 'src/main/presenter/sqlitePresenter')
  const acpRoot = path.join(ROOT, 'src/main/agent/acp')
  const resolvedLoopImports = loopImports.map((entry) => ({
    ...entry,
    absolute: entry.resolved ? path.join(ROOT, entry.resolved) : null
  }))

  return {
    schemaVersion: 2,
    goal: 'agent-system-layered-runtime',
    headCommit: await getHeadCommit(),
    relevantWorkingTree: {
      dirty: relevantDirtyFiles.length > 0,
      files: relevantDirtyFiles
    },
    sourceRoots: [...AGENT_SYSTEM_SOURCE_ROOTS, 'src/shared/contracts'],
    sourceFiles: [...new Set(agentSourceFiles)].sort(),
    expectedFiles,
    ownerEvidence,
    retiredSurfaces: {
      paths: retiredPaths,
      symbols: retiredSymbols
    },
    runtimeOwnership: {
      deepchat: {
        runtime: ownerEvidence.deepChatRuntime.file,
        instance: ownerEvidence.deepChatInstance.file,
        loopEngine: ownerEvidence.deepChatLoopEngine.file,
        backend: ownerEvidence.typedDeepChatBackend.file
      },
      acp: {
        runtime: ownerEvidence.acpRuntime.file,
        instance: ownerEvidence.acpInstance.file,
        backend: ownerEvidence.directAcpBackend.file
      },
      memory: {
        coordinator: ownerEvidence.memoryRuntimeCoordinator.file,
        promptContributor: ownerEvidence.memoryPromptContributor.file,
        ingestionObserver: ownerEvidence.memoryIngestionObserver.file
      },
      runtimeBoundaries: [...AGENT_SYSTEM_RUNTIME_BOUNDARY_FILES].sort()
    },
    contracts: {
      files: contractFiles,
      sha256: await hashFiles(contractFiles)
    },
    storage: {
      sqlite: {
        files: sqliteSchemaFiles,
        tableIdentifiers: collectSqlTableIdentifiers(sqliteSchemaSources),
        sha256: await hashFiles(sqliteSchemaFiles)
      },
      memoryDuckDbSidecar: {
        files: memorySidecarSchemaFiles,
        tableIdentifiers: ['embedding_meta', 'memory_vector'],
        versionContract: 'embedding identity stored in embedding_meta; no numeric schema version',
        sha256: await hashFiles(memorySidecarSchemaFiles)
      }
    },
    compositionAndShutdown: {
      files: compositionLifecycleFiles,
      sha256: await hashFiles(compositionLifecycleFiles)
    },
    dependencyMetrics: {
      loopFiles,
      loopToPresenter: resolvedLoopImports.filter(
        ({ absolute }) => absolute && isUnder(absolute, presenterRoot)
      ).length,
      loopToSqlite: resolvedLoopImports.filter(
        ({ absolute }) => absolute && isUnder(absolute, sqliteRoot)
      ).length,
      loopToElectron: loopImports.filter(({ specifier }) =>
        /^electron(?:\/|$)/.test(specifier)
      ).length,
      loopToRoutes: resolvedLoopImports.filter(
        ({ absolute }) => absolute && isUnder(absolute, routesRoot)
      ).length,
      loopToAcp: resolvedLoopImports.filter(
        ({ absolute }) => absolute && isUnder(absolute, acpRoot)
      ).length
    }
  }
}

async function walk(dirPath, output = []) {
  let stats = null

  try {
    stats = await fs.stat(dirPath)
  } catch {
    return output
  }

  if (stats.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(dirPath))) {
      output.push(dirPath)
    }

    return output
  }

  let entries = []

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return output
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue
    }

    const nextPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await walk(nextPath, output)
      continue
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(nextPath)
    }
  }

  return output
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createUsePresenterNamePattern(presenterName) {
  return new RegExp(
    `(?<!function\\s)\\b(?:usePresenter|useLegacyPresenter)\\s*\\(\\s*['"\`]${escapeRegExp(presenterName)}['"\`]`,
    'g'
  )
}

function extractSpecifiers(source) {
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

async function resolveImport(specifier, importer, scopeRoot) {
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
    return await tryFile(path.join(scopeRoot, specifier.slice(2)))
  }

  if (specifier.startsWith('@shared/')) {
    return await tryFile(path.join(ROOT, 'src/shared', specifier.slice('@shared/'.length)))
  }

  if (specifier.startsWith('.')) {
    return await tryFile(path.resolve(path.dirname(importer), specifier))
  }

  return null
}

async function analyzeScope(label, scopeRoot) {
  const files = await walk(scopeRoot)
  const fileSet = new Set(files)
  const edges = new Map(files.map((file) => [file, new Set()]))
  const reverseEdges = new Map(files.map((file) => [file, new Set()]))

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    for (const specifier of extractSpecifiers(source)) {
      const resolved = await resolveImport(specifier, file, scopeRoot)
      if (!resolved || !fileSet.has(resolved)) {
        continue
      }

      edges.get(file).add(resolved)
      reverseEdges.get(resolved).add(file)
    }
  }

  const cycles = []
  const cycleKeys = new Set()
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  function traverse(node) {
    visiting.add(node)
    stack.push(node)

    for (const next of edges.get(node)) {
      if (!visiting.has(next) && !visited.has(next)) {
        traverse(next)
        continue
      }

      if (visiting.has(next)) {
        const startIndex = stack.indexOf(next)
        const cycle = stack.slice(startIndex).concat(next)
        const key = cycle
          .slice(0, -1)
          .map((file) => path.relative(scopeRoot, file))
          .sort()
          .join('|')

        if (!cycleKeys.has(key)) {
          cycleKeys.add(key)
          cycles.push(cycle)
        }
      }
    }

    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }

  for (const file of files) {
    if (!visited.has(file)) {
      traverse(file)
    }
  }

  const topOutgoing = [...edges.entries()]
    .map(([file, refs]) => ({
      file: path.relative(scopeRoot, file),
      count: refs.size
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 15)

  const topIncoming = [...reverseEdges.entries()]
    .map(([file, refs]) => ({
      file: path.relative(scopeRoot, file),
      count: refs.size
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 15)

  const zeroInbound = [...reverseEdges.entries()]
    .filter(([, refs]) => refs.size === 0)
    .map(([file]) => path.relative(scopeRoot, file))
    .filter((file) => !/index\.(ts|tsx|js|jsx|vue|d\.ts)$/.test(file))
    .sort()

  return {
    label,
    totalFiles: files.length,
    totalEdges: [...edges.values()].reduce((sum, refs) => sum + refs.size, 0),
    cycles: cycles.map((cycle) => cycle.map((file) => path.relative(scopeRoot, file))),
    topOutgoing,
    topIncoming,
    zeroInbound
  }
}

async function collectFilesFromTargets(targets) {
  const files = []

  for (const target of targets) {
    const targetFiles = await walk(target)
    for (const file of targetFiles) {
      files.push(file)
    }
  }

  return [...new Set(files)].sort()
}

async function collectPatternCounts(files, pattern) {
  const counts = new Map()

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    const count = countMatches(source, pattern)
    if (count > 0) {
      counts.set(relativePath(file), count)
    }
  }

  return counts
}

async function collectPresenterFamilyCounts(files, presenterNames) {
  const patterns = presenterNames.map((presenterName) => [
    presenterName,
    createUsePresenterNamePattern(presenterName)
  ])
  const counts = Object.fromEntries(presenterNames.map((presenterName) => [presenterName, 0]))

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    for (const [presenterName, pattern] of patterns) {
      counts[presenterName] += countMatches(source, pattern)
    }
  }

  return counts
}

function combineCountMaps(...maps) {
  const combined = new Map()

  for (const currentMap of maps) {
    for (const [file, count] of currentMap) {
      combined.set(file, (combined.get(file) ?? 0) + count)
    }
  }

  return combined
}

async function collectRendererPatternCountsByLayer(pattern) {
  const businessFiles = await collectFilesFromTargets(RENDERER_BUSINESS_ROOTS)
  const quarantineFiles = await collectFilesFromTargets(RENDERER_QUARANTINE_ROOTS)

  const business = await collectPatternCounts(businessFiles, pattern)
  const quarantine = await collectPatternCounts(quarantineFiles, pattern)

  return {
    business,
    quarantine,
    total: combineCountMaps(business, quarantine)
  }
}

async function collectMigratedRawChannelCounts() {
  const files = await collectFilesFromTargets(MIGRATED_RAW_CHANNEL_GUARD_PATHS)
  const counts = new Map()

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    const count =
      countMatches(source, INLINE_IPC_CHANNEL_PATTERN) +
      countMatches(source, INLINE_EVENTBUS_CHANNEL_PATTERN)

    if (count > 0) {
      counts.set(relativePath(file), count)
    }
  }

  return counts
}

async function collectHotPathDirectEdges() {
  const hotPathFileSet = new Set(HOT_PATH_FILES)
  const edges = []

  for (const file of HOT_PATH_FILES) {
    const source = await fs.readFile(file, 'utf8')
    for (const specifier of extractSpecifiers(source)) {
      const resolved = await resolveImport(specifier, file, MAIN_SOURCE_ROOT)
      if (!resolved || !hotPathFileSet.has(resolved)) {
        continue
      }

      edges.push({
        source: relativePath(file),
        target: relativePath(resolved)
      })
    }
  }

  return edges.sort((left, right) =>
    `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`)
  )
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

    if (!PHASE_ORDER.has(bridge.deleteByPhase)) {
      throw new Error(`bridge ${bridge.id} has unsupported deleteByPhase ${bridge.deleteByPhase}`)
    }

    if (bridge.status !== 'active' && bridge.status !== 'removed') {
      throw new Error(`bridge ${bridge.id} has unsupported status ${bridge.status}`)
    }

    if (seenIds.has(bridge.id)) {
      throw new Error(`duplicate bridge id ${bridge.id}`)
    }

    seenIds.add(bridge.id)
  }

  return parsed
}

function summarizeCounts(counts) {
  const items = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1]
    }

    return left[0].localeCompare(right[0])
  })

  return {
    total: items.reduce((sum, [, count]) => sum + count, 0),
    top: items.slice(0, 12)
  }
}

function summarizeBridges(register) {
  const currentPhaseOrder = PHASE_ORDER.get(register.currentPhase)
  let activeCount = 0
  let expiredCount = 0

  for (const bridge of register.bridges) {
    if (bridge.status !== 'active') {
      continue
    }

    activeCount += 1
    if (PHASE_ORDER.get(bridge.deleteByPhase) < currentPhaseOrder) {
      expiredCount += 1
    }
  }

  return { activeCount, expiredCount }
}

function renderDependencyReport(scopes) {
  const lines = [
    '# Dependency Baseline',
    '',
    `Generated on ${new Date().toISOString().slice(0, 10)}.`,
    ''
  ]

  for (const scope of scopes) {
    lines.push(`## ${scope.label}`)
    lines.push('')
    lines.push(`- Total files: ${scope.totalFiles}`)
    lines.push(`- Internal dependency edges: ${scope.totalEdges}`)
    lines.push(`- Cycles detected: ${scope.cycles.length}`)
    lines.push('')
    lines.push('### Top outgoing dependencies')
    lines.push('')

    for (const item of scope.topOutgoing) {
      lines.push(`- \`${item.file}\`: ${item.count}`)
    }

    lines.push('')
    lines.push('### Top incoming dependencies')
    lines.push('')

    for (const item of scope.topIncoming) {
      lines.push(`- \`${item.file}\`: ${item.count}`)
    }

    lines.push('')
    lines.push('### Cycle samples')
    lines.push('')

    if (scope.cycles.length === 0) {
      lines.push('- None')
    } else {
      for (const cycle of scope.cycles.slice(0, 20)) {
        lines.push(`- \`${cycle.join(' -> ')}\``)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}

function renderZeroInboundReport(scopes) {
  const lines = [
    '# Zero Inbound Candidates',
    '',
    `Generated on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'These files have no in-repo importers inside their scope and need manual classification before deletion.',
    ''
  ]

  for (const scope of scopes) {
    lines.push(`## ${scope.label}`)
    lines.push('')
    lines.push(`- Candidate count: ${scope.zeroInbound.length}`)
    lines.push('')
    for (const file of scope.zeroInbound) {
      lines.push(`- \`${file}\``)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function renderTopCountSection(lines, title, summary) {
  lines.push(`## ${title}`)
  lines.push('')
  lines.push(`- Total count: ${summary.total}`)
  lines.push('')

  if (summary.top.length === 0) {
    lines.push('- None')
  } else {
    for (const [file, count] of summary.top) {
      lines.push(`- \`${file}\`: ${count}`)
    }
  }

  lines.push('')
}

function renderBoundaryBaselineReport({
  currentPhase,
  metrics,
  rendererLegacySplit,
  quarantineSourceFiles,
  phaseGates,
  usePresenterSummary,
  windowElectronSummary,
  windowApiSummary,
  rawTimerSummary,
  migratedRawChannelSummary,
  hotPathEdges
}) {
  const lines = [
    '# Main Kernel Boundary Baseline',
    '',
    `Generated on ${new Date().toISOString().slice(0, 10)}.`,
    `Current phase: ${currentPhase}.`,
    '',
    '## Metric Snapshot',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| \`renderer.usePresenter.count\` | ${metrics['renderer.usePresenter.count']} |`,
    `| \`renderer.business.usePresenter.count\` | ${metrics['renderer.business.usePresenter.count']} |`,
    `| \`renderer.quarantine.usePresenter.count\` | ${metrics['renderer.quarantine.usePresenter.count']} |`,
    `| \`renderer.windowElectron.count\` | ${metrics['renderer.windowElectron.count']} |`,
    `| \`renderer.business.windowElectron.count\` | ${metrics['renderer.business.windowElectron.count']} |`,
    `| \`renderer.quarantine.windowElectron.count\` | ${metrics['renderer.quarantine.windowElectron.count']} |`,
    `| \`renderer.windowApi.count\` | ${metrics['renderer.windowApi.count']} |`,
    `| \`renderer.business.windowApi.count\` | ${metrics['renderer.business.windowApi.count']} |`,
    `| \`renderer.quarantine.windowApi.count\` | ${metrics['renderer.quarantine.windowApi.count']} |`,
    `| \`renderer.quarantine.sourceFile.count\` | ${metrics['renderer.quarantine.sourceFile.count']} |`,
    `| \`hotpath.directEdge.count\` | ${metrics['hotpath.directEdge.count']} |`,
    `| \`runtime.rawTimer.count\` | ${metrics['runtime.rawTimer.count']} |`,
    `| \`migrated.rawChannel.count\` | ${metrics['migrated.rawChannel.count']} |`,
    `| \`bridge.active.count\` | ${metrics['bridge.active.count']} |`,
    `| \`bridge.expired.count\` | ${metrics['bridge.expired.count']} |`,
    ''
  ]

  lines.push('## Renderer Single-Track Split')
  lines.push('')
  lines.push('- Business layer: `src/renderer/src/**`, `src/renderer/settings/**`')
  lines.push('- Retired quarantine layer: `src/renderer/api/legacy/**` must remain deleted')
  lines.push('')
  lines.push('| Legacy surface | Business layer | Quarantine layer | Total |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(
    `| legacy presenter helper | ${rendererLegacySplit.usePresenter.business.total} | ${rendererLegacySplit.usePresenter.quarantine.total} | ${rendererLegacySplit.usePresenter.total.total} |`
  )
  lines.push(
    `| \`window.electron\` | ${rendererLegacySplit.windowElectron.business.total} | ${rendererLegacySplit.windowElectron.quarantine.total} | ${rendererLegacySplit.windowElectron.total.total} |`
  )
  lines.push(
    `| \`window.api\` | ${rendererLegacySplit.windowApi.business.total} | ${rendererLegacySplit.windowApi.quarantine.total} | ${rendererLegacySplit.windowApi.total.total} |`
  )
  lines.push('')

  lines.push('## Quarantine Exit Snapshot')
  lines.push('')
  lines.push('- Retained capability family: none; `renderer legacy transport` is retired')
  lines.push(
    `- Source files: ${quarantineSourceFiles.length} / ${RENDERER_QUARANTINE_EXIT_MAX_FILES}`
  )
  lines.push(
    '- Delete condition: already satisfied; a recreated quarantine directory is a regression.'
  )
  lines.push('')

  if (quarantineSourceFiles.length === 0) {
    lines.push('- None')
  } else {
    for (const file of quarantineSourceFiles) {
      lines.push(`- \`${file}\``)
    }
  }

  lines.push('')

  lines.push('## Phase Gates')
  lines.push('')
  lines.push('| Phase | Gate indicator | Current signal | Status |')
  lines.push('| --- | --- | --- | --- |')
  for (const gate of phaseGates) {
    lines.push(`| \`${gate.phase}\` | ${gate.indicator} | ${gate.current} | ${gate.status} |`)
  }
  lines.push('')

  lines.push('## Hot Path Direct Dependencies')
  lines.push('')
  lines.push(`- Direct edge count: ${hotPathEdges.length}`)
  lines.push('')

  if (hotPathEdges.length === 0) {
    lines.push('- None')
  } else {
    for (const edge of hotPathEdges) {
      lines.push(`- \`${edge.source} -> ${edge.target}\``)
    }
  }

  lines.push('')

  renderTopCountSection(lines, 'Renderer legacy presenter helpers', usePresenterSummary)
  renderTopCountSection(lines, 'Renderer window.electron', windowElectronSummary)
  renderTopCountSection(lines, 'Renderer window.api', windowApiSummary)
  renderTopCountSection(lines, 'Raw Timers', rawTimerSummary)
  renderTopCountSection(lines, 'Migrated Path Raw Channel Literals', migratedRawChannelSummary)

  return lines.join('\n')
}

function renderMigrationScoreboardReport({ currentPhase, metrics, phaseGates }) {
  const lines = [
    '# Main Kernel Migration Scoreboard',
    '',
    `Generated on ${new Date().toISOString().slice(0, 10)}.`,
    `Current phase: ${currentPhase}.`,
    '',
    'Phase 0 establishes the comparison baseline. Later phases should update this report and compare against this checkpoint.',
    '',
    '| Metric | Value | Status |',
    '| --- | --- | --- |'
  ]

  for (const [metric, value] of Object.entries(metrics)) {
    lines.push(`| \`${metric}\` | ${value} | baseline |`)
  }

  lines.push('')
  lines.push('## Phase Gate Status')
  lines.push('')
  lines.push('| Phase | Status | Current signal |')
  lines.push('| --- | --- | --- |')
  for (const gate of phaseGates) {
    lines.push(`| \`${gate.phase}\` | ${gate.status} | ${gate.current} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function renderBridgeRegisterReport(register, bridgeSummary) {
  const lines = [
    '# Main Kernel Bridge Register',
    '',
    `Updated on ${register.updatedOn}.`,
    `Current phase: ${register.currentPhase}.`,
    '',
    `- Active bridges: ${bridgeSummary.activeCount}`,
    `- Expired bridges: ${bridgeSummary.expiredCount}`,
    ''
  ]

  if (register.bridges.length === 0) {
    lines.push('## Entries')
    lines.push('')
    lines.push('- None')
    lines.push('')
    return lines.join('\n')
  }

  lines.push('## Entries')
  lines.push('')
  lines.push('| id | owner | legacyEntry | newTarget | introducedIn | deleteByPhase | status | notes |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')

  for (const bridge of register.bridges) {
    lines.push(
      `| ${bridge.id} | ${bridge.owner} | ${bridge.legacyEntry} | ${bridge.newTarget} | ${bridge.introducedIn} | ${bridge.deleteByPhase} | ${bridge.status} | ${bridge.notes} |`
    )
  }

  lines.push('')
  return lines.join('\n')
}

function withFinalNewline(content) {
  return `${content.trimEnd()}\n`
}

export function assertBaselineOutputSafety(outputDir, relevantDirtyFiles) {
  if (
    path.resolve(outputDir) === path.resolve(REPORT_DIR) &&
    relevantDirtyFiles.length > 0
  ) {
    throw new Error(
      `Refusing to update canonical architecture baselines from a dirty relevant tree: ${relevantDirtyFiles.join(', ')}`
    )
  }
}

function parseOutputDir(argv) {
  let outputDir = REPORT_DIR
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument !== '--output-dir') {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value) throw new Error('--output-dir requires a path')
    outputDir = path.resolve(ROOT, value)
    index += 1
  }
  return outputDir
}

export async function generateArchitectureBaseline({ outputDir = REPORT_DIR } = {}) {
  await ensureDir(outputDir)
  const scopes = []

  for (const target of ANALYSIS_TARGETS) {
    scopes.push(await analyzeScope(target.label, target.root))
  }

  const mainAndRendererFiles = await collectFilesFromTargets([
    MAIN_SOURCE_ROOT,
    ...RENDERER_BUSINESS_ROOTS
  ])
  const rendererBusinessFiles = await collectFilesFromTargets(RENDERER_BUSINESS_ROOTS)
  const quarantineExists = await pathExists(RENDERER_QUARANTINE_ROOT)
  const quarantineSourceFiles = await collectFilesFromTargets(RENDERER_QUARANTINE_ROOTS)
  const usePresenterCountsByLayer = await collectRendererPatternCountsByLayer(
    LEGACY_PRESENTER_HELPER_CALL_PATTERN
  )
  const windowElectronCountsByLayer = await collectRendererPatternCountsByLayer(WINDOW_ELECTRON_PATTERN)
  const windowApiCountsByLayer = await collectRendererPatternCountsByLayer(WINDOW_API_PATTERN)
  const rawTimerCounts = await collectPatternCounts(mainAndRendererFiles, RAW_TIMER_PATTERN)
  const migratedRawChannelCounts = await collectMigratedRawChannelCounts()
  const hotPathEdges = await collectHotPathDirectEdges()
  const bridgeRegister = await loadBridgeRegister()
  const bridgeSummary = summarizeBridges(bridgeRegister)
  const agentSystemBaseline = await buildAgentSystemBaseline()
  assertBaselineOutputSafety(outputDir, agentSystemBaseline.relevantWorkingTree.files)
  const p2PresenterCounts = await collectPresenterFamilyCounts(
    rendererBusinessFiles,
    PRESENTER_PHASE_GATES.P2
  )
  const p3PresenterCounts = await collectPresenterFamilyCounts(
    rendererBusinessFiles,
    PRESENTER_PHASE_GATES.P3
  )
  const p4PresenterCounts = await collectPresenterFamilyCounts(
    rendererBusinessFiles,
    PRESENTER_PHASE_GATES.P4
  )

  const rendererLegacySplit = {
    usePresenter: {
      business: summarizeCounts(usePresenterCountsByLayer.business),
      quarantine: summarizeCounts(usePresenterCountsByLayer.quarantine),
      total: summarizeCounts(usePresenterCountsByLayer.total)
    },
    windowElectron: {
      business: summarizeCounts(windowElectronCountsByLayer.business),
      quarantine: summarizeCounts(windowElectronCountsByLayer.quarantine),
      total: summarizeCounts(windowElectronCountsByLayer.total)
    },
    windowApi: {
      business: summarizeCounts(windowApiCountsByLayer.business),
      quarantine: summarizeCounts(windowApiCountsByLayer.quarantine),
      total: summarizeCounts(windowApiCountsByLayer.total)
    }
  }

  const metrics = {
    'renderer.usePresenter.count': rendererLegacySplit.usePresenter.total.total,
    'renderer.business.usePresenter.count': rendererLegacySplit.usePresenter.business.total,
    'renderer.quarantine.usePresenter.count': rendererLegacySplit.usePresenter.quarantine.total,
    'renderer.windowElectron.count': rendererLegacySplit.windowElectron.total.total,
    'renderer.business.windowElectron.count': rendererLegacySplit.windowElectron.business.total,
    'renderer.quarantine.windowElectron.count': rendererLegacySplit.windowElectron.quarantine.total,
    'renderer.windowApi.count': rendererLegacySplit.windowApi.total.total,
    'renderer.business.windowApi.count': rendererLegacySplit.windowApi.business.total,
    'renderer.quarantine.windowApi.count': rendererLegacySplit.windowApi.quarantine.total,
    'renderer.quarantine.sourceFile.count': quarantineSourceFiles.length,
    'hotpath.directEdge.count': hotPathEdges.length,
    'runtime.rawTimer.count': summarizeCounts(rawTimerCounts).total,
    'migrated.rawChannel.count': summarizeCounts(migratedRawChannelCounts).total,
    'bridge.active.count': bridgeSummary.activeCount,
    'bridge.expired.count': bridgeSummary.expiredCount
  }

  const usePresenterSummary = rendererLegacySplit.usePresenter.total
  const windowElectronSummary = rendererLegacySplit.windowElectron.total
  const windowApiSummary = rendererLegacySplit.windowApi.total
  const rawTimerSummary = summarizeCounts(rawTimerCounts)
  const migratedRawChannelSummary = summarizeCounts(migratedRawChannelCounts)
  const p1Ready =
    metrics['renderer.business.usePresenter.count'] === 0 &&
    metrics['renderer.business.windowElectron.count'] === 0 &&
    metrics['renderer.business.windowApi.count'] === 0
  const p2Ready = Object.values(p2PresenterCounts).every((count) => count === 0)
  const p3Ready = Object.values(p3PresenterCounts).every((count) => count === 0)
  const p4Ready = Object.values(p4PresenterCounts).every((count) => count === 0)
  const p5Ready =
    p1Ready &&
    !quarantineExists &&
    quarantineSourceFiles.length <= RENDERER_QUARANTINE_EXIT_MAX_FILES
  const phaseGates = [
    {
      phase: 'P0',
      indicator:
        'Retired quarantine path `src/renderer/api/legacy/**` must remain deleted and baseline emits business/retired split metrics',
      current: quarantineExists
        ? '`src/renderer/api/legacy/**` exists'
        : '`src/renderer/api/legacy/**` deleted; split metrics emitted',
      status: quarantineExists ? 'blocked' : 'ready'
    },
    {
      phase: 'P1',
      indicator:
        'Business layer direct legacy presenter helper / `window.electron` / `window.api` counts must reach `0`',
      current:
        `legacyPresenter=${metrics['renderer.business.usePresenter.count']}, ` +
        `window.electron=${metrics['renderer.business.windowElectron.count']}, ` +
        `window.api=${metrics['renderer.business.windowApi.count']}`,
      status: p1Ready ? 'ready' : 'pending'
    },
    {
      phase: 'P2',
      indicator: 'Business layer `configPresenter` and `providerRuntime` hits must reach `0`',
      current:
        `configPresenter=${p2PresenterCounts.configPresenter}, ` +
        `providerRuntime=${p2PresenterCounts.providerRuntime}`,
      status: p2Ready ? 'ready' : 'pending'
    },
    {
      phase: 'P3',
      indicator:
        'Business layer window/device/workspace/project/file/browser/tab presenter hits must reach `0`',
      current:
        `window=${p3PresenterCounts.windowPresenter}, ` +
        `device=${p3PresenterCounts.devicePresenter}, ` +
        `workspace=${p3PresenterCounts.workspacePresenter}, ` +
        `project=${p3PresenterCounts.projectPresenter}, ` +
        `file=${p3PresenterCounts.filePresenter}, ` +
        `browser=${p3PresenterCounts.yoBrowserPresenter}, ` +
        `tab=${p3PresenterCounts.tabPresenter}`,
      status: p3Ready ? 'ready' : 'pending'
    },
    {
      phase: 'P4',
      indicator:
        'Business layer session residual / skill / mcp / sync / upgrade / dialog / tool presenter hits must reach `0`',
      current:
        `agentSession=${p4PresenterCounts.agentSessionPresenter}, ` +
        `skill=${p4PresenterCounts.skillPresenter}, ` +
        `mcp=${p4PresenterCounts.mcpPresenter}, ` +
        `sync=${p4PresenterCounts.syncPresenter}, ` +
        `upgrade=${p4PresenterCounts.upgradePresenter}, ` +
        `dialog=${p4PresenterCounts.dialogPresenter}, ` +
        `tool=${p4PresenterCounts.toolPresenter}`,
      status: p4Ready ? 'ready' : 'pending'
    },
    {
      phase: 'P5',
      indicator:
        'Business layer direct legacy access must be `0`, and retired quarantine source files must stay at `0`',
      current:
        `businessLegacy=${metrics['renderer.business.usePresenter.count']}/` +
        `${metrics['renderer.business.windowElectron.count']}/` +
        `${metrics['renderer.business.windowApi.count']}, ` +
        `quarantineSourceFiles=${quarantineSourceFiles.length}/${RENDERER_QUARANTINE_EXIT_MAX_FILES}`,
      status: p5Ready ? 'ready' : 'pending'
    }
  ]

  const scoreboardPayload = {
    program: 'main-kernel-refactor',
    generatedOn: new Date().toISOString().slice(0, 10),
    currentPhase: bridgeRegister.currentPhase,
    metrics,
    phaseGates,
    hotPathEdges: hotPathEdges.map((edge) => `${edge.source} -> ${edge.target}`),
    migratedRawChannels: Object.fromEntries(migratedRawChannelCounts)
  }

  await Promise.all([
    fs.writeFile(
      path.join(outputDir, 'agent-system-layered-runtime-baseline.json'),
      `${JSON.stringify(agentSystemBaseline, null, 2)}\n`
    ),
    fs.writeFile(
      path.join(outputDir, 'dependency-report.md'),
      withFinalNewline(renderDependencyReport(scopes))
    ),
    fs.writeFile(
      path.join(outputDir, 'zero-inbound-candidates.md'),
      withFinalNewline(renderZeroInboundReport(scopes))
    ),
    fs.writeFile(
      path.join(outputDir, 'main-kernel-boundary-baseline.md'),
      withFinalNewline(renderBoundaryBaselineReport({
        currentPhase: bridgeRegister.currentPhase,
        metrics,
        rendererLegacySplit,
        quarantineSourceFiles: quarantineSourceFiles.map((file) => relativePath(file)),
        phaseGates,
        usePresenterSummary,
        windowElectronSummary,
        windowApiSummary,
        rawTimerSummary,
        migratedRawChannelSummary,
        hotPathEdges
      }))
    ),
    fs.writeFile(
      path.join(outputDir, 'main-kernel-migration-scoreboard.md'),
      withFinalNewline(renderMigrationScoreboardReport({
        currentPhase: bridgeRegister.currentPhase,
        metrics,
        phaseGates
      }))
    ),
    fs.writeFile(
      path.join(outputDir, 'main-kernel-migration-scoreboard.json'),
      `${JSON.stringify(scoreboardPayload, null, 2)}\n`
    ),
    fs.writeFile(
      path.join(outputDir, 'main-kernel-bridge-register.md'),
      withFinalNewline(renderBridgeRegisterReport(bridgeRegister, bridgeSummary))
    )
  ])

  console.log(`Architecture baseline reports updated in ${relativePath(outputDir) || '.'}.`)
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  generateArchitectureBaseline({ outputDir: parseOutputDir(process.argv.slice(2)) }).catch(
    (error) => {
      console.error('Failed to generate architecture baseline reports:', error)
      process.exit(1)
    }
  )
}
