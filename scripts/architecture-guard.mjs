import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { analyzeMemoryArchitecture } from './lib/memory-architecture-guard.mjs'

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
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter'),
  path.join(ROOT, 'src/main/agent')
]
const REGULAR_MAIN_TEST_ROOT = path.join(ROOT, 'test/main')
const INTERNAL_AGENT_KIND_ROOTS = [
  path.join(ROOT, 'src/main/agent'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter'),
  path.join(ROOT, 'test/main/agent'),
  path.join(ROOT, 'test/main/presenter/agentRuntimePresenter')
]
const AGENT_HANDLE_BACKEND_RUNTIME_KIND_ROOTS = [
  path.join(ROOT, 'src/main/agent/manager'),
  path.join(ROOT, 'test/main/agent/manager')
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
const RETIRED_MAIN_PATHS = [
  path.join(ROOT, 'src/main/lib/agentRuntime'),
  path.join(ROOT, 'src/main/agent/manager/legacyAgentBackends.ts'),
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter'),
  path.join(ROOT, 'src/shared/types/presenters/agent-session.presenter.d.ts'),
  path.join(ROOT, 'test/main/presenter/agentSessionPresenter')
]
const RETIRED_SESSION_FACADE_NAMES = new Set([
  'AgentSessionPresenter',
  'IAgentSessionPresenter',
  'agentSessionPresenter'
])
const RENDERER_TYPED_BOUNDARY_WINDOW_API_ALLOWLIST = [
  path.join(ROOT, 'src/renderer/api/runtime.ts')
]
const MAIN_SOURCE_ROOT = path.join(ROOT, 'src/main')
const SHARED_SOURCE_ROOT = path.join(ROOT, 'src/shared')
const ACP_DIRECT_INSTANCE_ROOT = path.join(ROOT, 'src/main/agent/acp/instance')
const DEEPCHAT_LOOP_ROOT = path.join(ROOT, 'src/main/agent/deepchat/loop')
const ACP_ROOT = path.join(ROOT, 'src/main/agent/acp')
const MAIN_PRESENTER_ROOT = path.join(ROOT, 'src/main/presenter')
const MAIN_ROUTES_ROOT = path.join(ROOT, 'src/main/routes')
const MEMORY_RUNTIME_COORDINATOR_PATH = path.join(
  ROOT,
  'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts'
)
const AGENT_RUNTIME_PRESENTER_ROOT = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter'
)
const MEMORY_PRESENTER_ROOT = path.join(ROOT, 'src/main/presenter/memoryPresenter')
const SQLITE_PRESENTER_ROOT = path.join(ROOT, 'src/main/presenter/sqlitePresenter')
const PRESENTER_ROOT_ENTRY = path.join(ROOT, 'src/main/presenter/index.ts')
const SESSION_APPLICATION_ROOT = path.join(ROOT, 'src/main/presenter/sessionApplication')
const SESSION_APPLICATION_OWNER_PATHS = new Set(
  [
    'projectionCoordinator.ts',
    'agentAssignmentPolicy.ts',
    'agentAssignmentCoordinator.ts',
    'turnCoordinator.ts',
    'lifecycleCoordinator.ts',
    'lifecycleDeletionTransaction.ts'
  ].map((fileName) => path.resolve(SESSION_APPLICATION_ROOT, fileName))
)
const SESSION_APPLICATION_OWNER_NAMES = new Set([
  'SessionProjectionCoordinator',
  'SessionAgentAssignmentPolicy',
  'SessionAgentAssignmentCoordinator',
  'SessionTurnCoordinator',
  'SessionLifecycleCoordinator',
  'SessionDeletionTransaction'
])
const SESSION_MIGRATED_CONSUMER_PATHS = new Set(
  [
    'src/main/routes/sessions/sessionService.ts',
    'src/main/routes/chat/chatService.ts',
    'src/main/routes/hotPathPorts.ts',
    'src/main/presenter/remoteControlPresenter/index.ts',
    'src/main/presenter/remoteControlPresenter/interface.ts',
    'src/main/presenter/remoteControlPresenter/services/remoteConversationRunner.ts',
    'src/main/presenter/cronJobs/runSessionStarter.ts',
    'src/main/presenter/lifecyclePresenter/hooks/after-start/cronJobsStartHook.ts'
  ].map((fileName) => path.resolve(ROOT, fileName))
)
const SESSION_COORDINATOR_WHOLE_DEPENDENCY_NAMES = new Set([
  'Presenter',
  'IAgentSessionPresenter',
  'AgentSharedDataPorts',
  'SQLitePresenter'
])
const SESSION_COMBINED_FACADE_NAMES = new Set([
  'SessionApplicationServices',
  'SessionApplicationCoordinator'
])
const SESSION_FACADE_CAPABILITY_CATEGORIES = new Map([
  ['SessionLifecyclePort', 'lifecycle'],
  ['SessionLifecycleCoordinator', 'lifecycle'],
  ['SessionTurnPort', 'turn'],
  ['SessionTurnCoordinator', 'turn'],
  ['SessionAgentAssignmentPort', 'assignment'],
  ['SessionAgentAssignmentCoordinator', 'assignment'],
  ['SessionProjectionCoordinator', 'projection'],
  ['SessionProjectionReadPort', 'projection'],
  ['SessionProjectionMutationPort', 'projection'],
  ['SessionWindowProjectionPort', 'projection']
])
const SESSION_PHASE_ONE_FOREIGN_IMPORT_PATTERN =
  /(?:^|[/_.-])(?:history|export(?:er)?|usage(?:[-_.]?stats?)?|rtk|legacy[-_.]?import(?:er|s)?|import(?:er|s)?|migrations?|translation|catalog)(?:$|[/_.-])/
const SESSION_BOUNDARY_STARTUP_HOOK_PATHS = new Set(
  [
    'disabledSearchToolCleanupHook.ts',
    'legacyImportHook.ts',
    'rtkHealthCheckHook.ts',
    'sqliteMainlineNormalizationHook.ts',
    'usageStatsBackfillHook.ts'
  ].map((fileName) =>
    path.join(ROOT, 'src/main/presenter/lifecyclePresenter/hooks/after-start', fileName)
  )
)
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
const RETIRED_AGENT_RUNTIME_SYMBOLS = [
  'IAgentImplementation',
  'createLegacyAgentBackend',
  'LegacyDeepChatSessionBackend',
  'LegacyAcpSessionBackend',
  'LegacyAcpSessionHandle',
  'LegacyToolFactsSnapshotPort',
  'appendAssistantToolFactsSnapshot'
]
const RETIRED_AGENT_RUNTIME_PATTERNS = RETIRED_AGENT_RUNTIME_SYMBOLS.map((symbol) => [
  symbol,
  new RegExp(`\\b${symbol}\\b`, 'g')
])
const RETIRED_AGENT_HANDLE_RUNTIME_KINDS = new Set(['legacy', 'direct'])
const RETIRED_MEMORY_ORCHESTRATION_OWNER_NAMES = new Set([
  'memoryExtractionChains',
  'memoryExtractionQueue',
  'nextMemoryExtractionQueueId',
  'memoryExtractionEpochs',
  'memoryIngestionProjectionRetryAfter',
  'memoryInjectionAccessByTurn'
])
const RETIRED_MEMORY_PRESENTER_INJECTION_NAMES = new Set([
  'appendMemoryInjection',
  'recordMemoryInjectionAccess'
])
const RETIRED_MEMORY_PRESENTER_INGESTION_TRIGGER_NAMES = new Set([
  'triggerExtractionFallback',
  'triggerExtractionFromCompaction'
])
const WINDOW_ELECTRON_PATTERN = /window\.electron\b/g
const WINDOW_API_PATTERN = /window\.api\b/g
const IPC_RENDERER_LISTENER_PATTERN =
  /window\.electron(?:\?\.|\.)ipcRenderer(?:\?\.|\.)(?:on|once|addListener)\s*\(/g
const LEGACY_MEMORY_PRESENTER_LIST_PATTERN = /\.listMemories\s*\(/g
const LEGACY_MEMORY_PRESENTER_LIST_ALLOWLIST = new Map([
  [path.join(ROOT, 'src/main/routes/index.ts'), 1],
  [path.join(ROOT, 'src/main/presenter/memoryPresenter/index.ts'), 1]
])
const LEGACY_MEMORY_BRIDGE_ALLOWLIST = new Map([
  [path.join(ROOT, 'src/renderer/api/MemoryClient.ts'), 1]
])
const INLINE_IPC_CHANNEL_PATTERN =
  /(?:window\.electron(?:\?\.|\.)ipcRenderer|ipcRenderer|ipcMain)(?:\?\.|\.)(?:invoke|send|on|once|handle|handleOnce|removeListener|removeAllListeners|addListener)\s*\(\s*['"`][^'"`]+['"`]/g
const INLINE_EVENTBUS_CHANNEL_PATTERN =
  /(?:sendToRenderer|publish|publishToWindow|publishToWebContents)\s*\(\s*['"`][^'"`]+['"`]/g

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

function isSessionMigratedConsumerPath(filePath) {
  return SESSION_MIGRATED_CONSUMER_PATHS.has(path.resolve(filePath))
}

function isSessionApplicationOwnerPath(filePath) {
  return (
    SESSION_APPLICATION_OWNER_PATHS.has(path.resolve(filePath)) ||
    path.basename(filePath).startsWith('__architecture_guard_session_coordinator_')
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

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return null
}

function sourceFileForAst(source, filePath, scriptKind = ts.ScriptKind.TS) {
  return ts.createSourceFile(
    filePath,
    scriptSourceForAst(source, filePath),
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  )
}

function importRecordsFromSourceFile(sourceFile) {
  const records = []

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue
    }

    const specifier = statement.moduleSpecifier.text
    if (statement.importClause.name) {
      records.push({
        specifier,
        importedName: 'default',
        localName: statement.importClause.name.text
      })
    }

    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      records.push({ specifier, importedName: '*', localName: bindings.name.text })
      continue
    }

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        records.push({
          specifier,
          importedName: element.propertyName?.text ?? element.name.text,
          localName: element.name.text
        })
      }
    }
  }

  return records
}

function findIdentifierNames(sourceFile, names) {
  const found = new Set()
  const visit = (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) found.add(node.text)
    const member = accessMemberName(node)
    if (member && names.has(member)) found.add(member)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function findSessionApplicationOwnerConstructions(sourceFile, importRecords) {
  const constructions = new Map()

  const lookup = (scope, name) => {
    for (let current = scope; current; current = current.parent) {
      if (current.bindings.has(name)) return current.bindings.get(name)
    }
    return SESSION_APPLICATION_OWNER_NAMES.has(name) ? name : null
  }

  const resolveOwner = (expression, scope) => {
    const unwrapped = unwrapExpression(expression)
    if (ts.isIdentifier(unwrapped)) return lookup(scope, unwrapped.text)

    const owner = accessMemberName(unwrapped)
    return owner && SESSION_APPLICATION_OWNER_NAMES.has(owner) ? owner : null
  }

  const addDeclaration = (scope, declarations, declaration) => {
    if (!ts.isIdentifier(declaration.name)) return
    scope.bindings.set(declaration.name.text, null)
    if (declaration.initializer) declarations.push(declaration)
  }

  const directStatements = (node) =>
    ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements : []

  const visitScope = (node, parent) => {
    const scope = { parent, bindings: new Map() }
    const declarations = []

    if (ts.isSourceFile(node)) {
      for (const record of importRecords) {
        scope.bindings.set(
          record.localName,
          SESSION_APPLICATION_OWNER_NAMES.has(record.importedName) ? record.importedName : null
        )
      }
    }

    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name)) scope.bindings.set(parameter.name.text, null)
      }
    }

    for (const statement of directStatements(node)) {
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name
      ) {
        scope.bindings.set(statement.name.text, null)
      }
      if (
        ts.isVariableStatement(statement) &&
        (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
      ) {
        for (const declaration of statement.declarationList.declarations) {
          addDeclaration(scope, declarations, declaration)
        }
      }
    }

    if (ts.isSourceFile(node) || ts.isFunctionLike(node)) {
      const collectVarDeclarations = (child) => {
        if (child !== node && ts.isFunctionLike(child)) return
        if (
          ts.isVariableDeclarationList(child) &&
          (child.flags & ts.NodeFlags.BlockScoped) === 0
        ) {
          for (const declaration of child.declarations) {
            addDeclaration(scope, declarations, declaration)
          }
        }
        ts.forEachChild(child, collectVarDeclarations)
      }
      collectVarDeclarations(node)
    }

    let changed = true
    while (changed) {
      changed = false
      for (const declaration of declarations) {
        const owner = resolveOwner(declaration.initializer, scope)
        if (owner && scope.bindings.get(declaration.name.text) !== owner) {
          scope.bindings.set(declaration.name.text, owner)
          changed = true
        }
      }
    }

    const visit = (child) => {
      if (child !== node && (ts.isBlock(child) || ts.isFunctionLike(child))) {
        visitScope(child, scope)
        return
      }
      if (ts.isNewExpression(child)) {
        const owner = resolveOwner(child.expression, scope)
        if (owner) constructions.set(owner, (constructions.get(owner) ?? 0) + 1)
      }
      ts.forEachChild(child, visit)
    }
    ts.forEachChild(node, visit)
  }

  visitScope(sourceFile, null)
  return constructions
}

function findCombinedSessionFacadeDeclarations(sourceFile, importRecords, includeExportedObjects) {
  const namespaceImports = new Set(
    importRecords
      .filter((record) => record.importedName === '*')
      .map((record) => record.localName)
  )
  const capabilities = new Map()
  for (const record of importRecords) {
    const category = SESSION_FACADE_CAPABILITY_CATEGORIES.get(record.importedName)
    if (category) capabilities.set(record.localName, new Set([category]))
  }

  const typeAliases = []
  const facades = []

  const mergeCategories = (sets) => new Set(sets.flatMap((set) => [...set]))
  const sameCategories = (left, right) =>
    left.size === right.size && [...left].every((category) => right.has(category))

  const qualifiedCategory = (node) => {
    let namespace = null
    let member = null
    if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
      namespace = node.left.text
      member = node.right.text
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      namespace = node.expression.text
      member = node.name.text
    }
    if (!namespace || !namespaceImports.has(namespace)) return new Set()
    const category = SESSION_FACADE_CAPABILITY_CATEGORIES.get(member)
    return category ? new Set([category]) : new Set()
  }

  const referenceCategories = (node, bindings) => {
    if (ts.isIdentifier(node)) {
      const category = SESSION_FACADE_CAPABILITY_CATEGORIES.get(node.text)
      return new Set(bindings.get(node.text) ?? (category ? [category] : []))
    }
    return qualifiedCategory(node)
  }

  const categoriesFor = (node) => {
    if (ts.isUnionTypeNode(node)) {
      const [first = new Set(), ...rest] = node.types.map(categoriesFor)
      return new Set([...first].filter((category) => rest.every((set) => set.has(category))))
    }
    if (ts.isIntersectionTypeNode(node)) {
      return mergeCategories(node.types.map(categoriesFor))
    }
    if (ts.isTypeReferenceNode(node)) {
      return referenceCategories(node.typeName, capabilities)
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      return referenceCategories(node.expression, capabilities)
    }

    const categories = new Set()
    ts.forEachChild(node, (child) => {
      for (const category of categoriesFor(child)) categories.add(category)
    })
    return categories
  }

  const collectTypeAliases = (node) => {
    if (ts.isTypeAliasDeclaration(node)) typeAliases.push(node)
    ts.forEachChild(node, collectTypeAliases)
  }
  collectTypeAliases(sourceFile)
  for (const alias of typeAliases) capabilities.set(alias.name.text, new Set())

  let changed = true
  while (changed) {
    changed = false
    for (const alias of typeAliases) {
      const next = categoriesFor(alias.type)
      const current = capabilities.get(alias.name.text)
      if (!sameCategories(next, current)) {
        capabilities.set(alias.name.text, next)
        changed = true
      }
    }
  }

  const propertyCategory = (name) => {
    const normalized = name.replace(/^session/i, '').toLowerCase()
    if (normalized === 'agentassignment') return 'assignment'
    return ['lifecycle', 'turn', 'assignment', 'projection'].includes(normalized)
      ? normalized
      : null
  }

  const hasAllPropertyCategories = (object) =>
    new Set(
      object.properties
        .map((property) => property.name && propertyNameText(property.name))
        .map((name) => name && propertyCategory(name))
        .filter(Boolean)
    ).size === 4

  const exportedObjects = []
  if (includeExportedObjects) {
    const localObjects = new Map()
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const exported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer && unwrapExpression(declaration.initializer)
        if (
          !ts.isIdentifier(declaration.name) ||
          !initializer ||
          !ts.isObjectLiteralExpression(initializer)
        ) {
          continue
        }
        localObjects.set(declaration.name.text, { object: initializer, type: declaration.type })
        if (exported && hasAllPropertyCategories(initializer)) {
          exportedObjects.push({
            name: declaration.name.text,
            object: initializer,
            type: declaration.type
          })
        }
      }
    }

    for (const statement of sourceFile.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        !statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text
          const local = localObjects.get(localName)
          if (local && hasAllPropertyCategories(local.object)) {
            exportedObjects.push({ name: element.name.text, ...local })
          }
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const object = unwrapExpression(statement.expression)
        if (ts.isObjectLiteralExpression(object) && hasAllPropertyCategories(object)) {
          exportedObjects.push({ name: 'default', object, type: null })
        }
      }
    }
  }

  if (exportedObjects.length > 0) {
    const values = new Map()
    for (const record of importRecords) {
      const category = SESSION_FACADE_CAPABILITY_CATEGORIES.get(record.importedName)
      if (category) values.set(record.localName, new Set([category]))
    }

    const expressionCategories = (node) => {
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        return referenceCategories(node, values)
      }
      if (ts.isNewExpression(node)) return expressionCategories(node.expression)
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        return mergeCategories([categoriesFor(node.type), expressionCategories(node.expression)])
      }
      if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
        return expressionCategories(node.expression)
      }
      return new Set()
    }

    const valueDeclarations = []
    const collectValueDeclarations = (node) => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name)
      ) {
        valueDeclarations.push(node)
        values.set(node.name.text, new Set())
      }
      ts.forEachChild(node, collectValueDeclarations)
    }
    collectValueDeclarations(sourceFile)

    changed = true
    while (changed) {
      changed = false
      for (const declaration of valueDeclarations) {
        const next = mergeCategories([
          values.get(declaration.name.text),
          declaration.type ? categoriesFor(declaration.type) : new Set(),
          declaration.initializer ? expressionCategories(declaration.initializer) : new Set()
        ])
        const current = values.get(declaration.name.text)
        if (!sameCategories(next, current)) {
          values.set(declaration.name.text, next)
          changed = true
        }
      }
    }

    const objectCategories = (object, declaredType) => {
      const declaredProperties = new Map()
      if (declaredType && ts.isTypeLiteralNode(declaredType)) {
        for (const member of declaredType.members) {
          const name = member.name && propertyNameText(member.name)
          if (name && member.type) declaredProperties.set(name, categoriesFor(member.type))
        }
      }

      const categories = new Set()
      for (const property of object.properties) {
        const name = property.name && propertyNameText(property.name)
        const category = name && propertyCategory(name)
        if (!category) continue

        let evidence = new Set()
        if (ts.isShorthandPropertyAssignment(property)) {
          evidence = expressionCategories(property.name)
        } else if (ts.isPropertyAssignment(property)) {
          evidence = expressionCategories(property.initializer)
        }
        if (evidence.has(category) || declaredProperties.get(name)?.has(category)) {
          categories.add(category)
        }
      }
      return categories
    }

    for (const exported of exportedObjects) {
      if (objectCategories(exported.object, exported.type).size === 4) {
        facades.push(exported.name)
      }
    }
  }

  const visit = (node) => {
    let name = null
    let categories = new Set()
    if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text
      for (const child of [...(node.heritageClauses ?? []), ...node.members]) {
        for (const category of categoriesFor(child)) categories.add(category)
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text
      categories = capabilities.get(name)
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text
      for (const child of node.heritageClauses ?? []) {
        for (const category of categoriesFor(child)) categories.add(category)
      }
    }

    if (name && categories.size === 4) facades.push(name)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return facades
}

function isSessionPhaseOneForeignImport(value) {
  const normalized = value.replaceAll(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()
  return SESSION_PHASE_ONE_FOREIGN_IMPORT_PATTERN.test(normalized)
}

function findNamedClassDeclarations(sourceFile, className) {
  const declarations = []
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      declarations.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return declarations
}

function analyzeSessionBoundaryStartupHook(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  let agentSessionPresenterDependencies = 0
  let typeAssertions = 0
  let optionalStartTaskProbes = 0
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'AgentSessionPresenter') {
      agentSessionPresenterDependencies += 1
    }
    if (accessMemberName(node) === 'agentSessionPresenter') {
      agentSessionPresenterDependencies += 1
    }
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      propertyNameText(node.propertyName ?? node.name) === 'agentSessionPresenter'
    ) {
      agentSessionPresenterDependencies += 1
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      typeAssertions += 1
    }

    const optionalCallName =
      ts.isCallExpression(node) && node.questionDotToken
        ? ts.isIdentifier(unwrapExpression(node.expression))
          ? unwrapExpression(node.expression).text
          : accessMemberName(unwrapExpression(node.expression))
        : null
    const memberName =
      optionalCallName ?? (node.name ? propertyNameText(node.name) : accessMemberName(node))
    if (
      memberName &&
      /^start[A-Z][A-Za-z0-9]*Task$/.test(memberName) &&
      (node.questionToken || node.questionDotToken || node.parent?.questionDotToken)
    ) {
      optionalStartTaskProbes += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return {
    agentSessionPresenterDependencies,
    typeAssertions,
    optionalStartTaskProbes,
    unknownDoubleCasts: countMatches(source, /\bas\s+unknown\s+as\b/g)
  }
}

function classPropertiesByName(classDeclaration) {
  const properties = new Map()
  for (const member of classDeclaration.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue
    const name = propertyNameText(member.name)
    if (name) properties.set(name, member)
  }
  return properties
}

function newMapSignature(property, sourceFile) {
  const initializer = property?.initializer
  if (
    !initializer ||
    !ts.isNewExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'Map' ||
    initializer.typeArguments?.length !== 2
  ) {
    return null
  }
  return initializer.typeArguments.map((node) => node.getText(sourceFile).replaceAll(/\s/g, ''))
}

export function analyzeMemoryRuntimeCoordinatorStructure(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  const classes = findNamedClassDeclarations(sourceFile, 'MemoryRuntimeCoordinator')
  if (classes.length === 0) {
    return {
      classCount: 0,
      violations: [
        `[memory-coordinator-missing-class] ${relativePath(filePath)} expected class MemoryRuntimeCoordinator`
      ]
    }
  }

  const properties = classPropertiesByName(classes[0])
  const violations = []
  const requiredMaps = [
    [
      'extractionChains',
      ['string', 'Promise<void>'],
      'memory-coordinator-missing-extraction-chain',
      'expected per-session extraction chain Map<string, Promise<void>>'
    ],
    [
      'extractionQueue',
      ['number', '{sessionId:string;queuedAt:number}'],
      'memory-coordinator-missing-queue-diagnostics',
      'expected queue diagnostics Map<number, { sessionId: string; queuedAt: number }>'
    ],
    [
      'extractionEpochs',
      ['string', 'number'],
      'memory-coordinator-missing-owned-state',
      'expected extractionEpochs to remain a coordinator-owned Map'
    ],
    [
      'ingestionProjectionRetryAfter',
      ['string', 'number'],
      'memory-coordinator-missing-owned-state',
      'expected ingestionProjectionRetryAfter to remain a coordinator-owned Map'
    ],
    [
      'injectionAccessByTurn',
      ['string', 'MemoryInjectionAccessTurnEntry'],
      'memory-coordinator-missing-owned-state',
      'expected injectionAccessByTurn to remain a coordinator-owned Map'
    ]
  ]
  for (const [name, signature, rule, message] of requiredMaps) {
    if (JSON.stringify(newMapSignature(properties.get(name), sourceFile)) !== JSON.stringify(signature)) {
      violations.push(`[${rule}] ${relativePath(filePath)} ${message}`)
    }
  }

  const queueCounter = properties.get('nextExtractionQueueId')
  if (!queueCounter?.initializer || !ts.isNumericLiteral(queueCounter.initializer) || queueCounter.initializer.text !== '0') {
    violations.push(
      `[memory-coordinator-missing-monotonic-counter] ${relativePath(filePath)} expected nextExtractionQueueId initialized to 0`
    )
  }

  return { classCount: classes.length, violations }
}

function findRetiredMemoryPresenterMembers(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  const owners = []
  const injection = []
  const ingestionTriggers = []
  const visit = (node) => {
    if (ts.isPropertyDeclaration(node) && node.name) {
      const name = propertyNameText(node.name)
      if (name && RETIRED_MEMORY_ORCHESTRATION_OWNER_NAMES.has(name)) owners.push(name)
    }
    if ((ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      const name = propertyNameText(node.name)
      if (name && RETIRED_MEMORY_PRESENTER_INJECTION_NAMES.has(name)) injection.push(name)
    }
    const accessName = accessMemberName(node)
    if (accessName && RETIRED_MEMORY_PRESENTER_INGESTION_TRIGGER_NAMES.has(accessName)) {
      ingestionTriggers.push(accessName)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { owners, injection, ingestionTriggers }
}

function accessMemberName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  return null
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function expressionMemberName(node) {
  const expression = unwrapExpression(node)
  if (ts.isIdentifier(expression)) return expression.text
  return accessMemberName(expression)
}

function isRetiredAgentRuntimeKindLiteral(node) {
  const expression = unwrapExpression(node)
  return (
    ts.isStringLiteralLike(expression) &&
    RETIRED_AGENT_HANDLE_RUNTIME_KINDS.has(expression.text)
  )
}

function typeContainsRetiredAgentRuntimeKind(node) {
  if (ts.isLiteralTypeNode(node)) {
    return (
      ts.isStringLiteralLike(node.literal) &&
      RETIRED_AGENT_HANDLE_RUNTIME_KINDS.has(node.literal.text)
    )
  }
  if (ts.isUnionTypeNode(node)) {
    return node.types.some(typeContainsRetiredAgentRuntimeKind)
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeContainsRetiredAgentRuntimeKind(node.type)
  }
  return false
}

function findRetiredAgentRuntimeKindUsages(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  const findings = []
  const equalityOperators = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken
  ])

  const visit = (node) => {
    if (
      (ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isPropertyAssignment(node)) &&
      node.name &&
      propertyNameText(node.name) === 'runtimeKind'
    ) {
      const initializer = 'initializer' in node ? node.initializer : undefined
      const declaredType = 'type' in node ? node.type : undefined
      if (
        (initializer && isRetiredAgentRuntimeKindLiteral(initializer)) ||
        (declaredType && typeContainsRetiredAgentRuntimeKind(declaredType))
      ) {
        findings.push(node)
      }
    }

    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind
      const leftIsRuntimeKind = expressionMemberName(node.left) === 'runtimeKind'
      const rightIsRuntimeKind = expressionMemberName(node.right) === 'runtimeKind'
      if (
        (operator === ts.SyntaxKind.EqualsToken &&
          leftIsRuntimeKind &&
          isRetiredAgentRuntimeKindLiteral(node.right)) ||
        (equalityOperators.has(operator) &&
          ((leftIsRuntimeKind && isRetiredAgentRuntimeKindLiteral(node.right)) ||
            (rightIsRuntimeKind && isRetiredAgentRuntimeKindLiteral(node.left))))
      ) {
        findings.push(node)
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return findings
}

function findInternalAgentKindAliasFallbacks(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  const findings = []
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const names = new Set([expressionMemberName(node.left), expressionMemberName(node.right)])
      if (names.size === 2 && names.has('agentType') && names.has('type')) {
        findings.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return findings
}

function forbiddenObservationMember(name) {
  if (/^(?:ensure|bootstrap|backfill)(?:$|[A-Z])/.test(name)) {
    return `bootstrap/lifecycle member "${name}"`
  }
  if (/^(?:applyAppendedEntry|applyProjection|replaceProjection|replaceSession)$/.test(name)) {
    return `projection mutation member "${name}"`
  }
  if (/^(?:append|insert|update|delete|rebuild)(?:$|[A-Z])/.test(name)) {
    return `mutation member "${name}"`
  }
  if (/^(?:publish|emit|dispatchEvent)(?:$|[A-Z])/.test(name)) {
    return `event publication member "${name}"`
  }
  if (
    /^(?:subscribe|unsubscribe|addListener|removeListener|addEventListener|removeEventListener|on|once)(?:$|[A-Z])/.test(
      name
    )
  ) {
    return `event subscription member "${name}"`
  }
  if (/^(?:exec|execute|run|prepare|transaction|createTable)$/.test(name)) {
    return `SQL execution member "${name}"`
  }
  return null
}

function expressionSegments(node) {
  if (ts.isIdentifier(node)) return [node.text]
  if (ts.isPropertyAccessExpression(node)) {
    return [...expressionSegments(node.expression), node.name.text]
  }
  if (ts.isElementAccessExpression(node)) {
    const member = accessMemberName(node)
    return [...expressionSegments(node.expression), ...(member ? [member] : [])]
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return expressionSegments(node.expression)
  }
  return []
}

function findCausalObservationViolations(source, filePath) {
  const sourceFile = sourceFileForAst(source, filePath)
  const memoryRuntimeBindings = new Set()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !/memoryPresenter(?:\/|$)/.test(statement.moduleSpecifier.text)
    ) {
      continue
    }
    if (statement.importClause.name) {
      memoryRuntimeBindings.add(statement.importClause.name.text)
    }
    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      memoryRuntimeBindings.add(bindings.name.text)
    } else if (bindings) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) memoryRuntimeBindings.add(element.name.text)
      }
    }
  }
  const bodies = []
  const findImplementations = (node) => {
    const name = 'name' in node && node.name ? propertyNameText(node.name) : null
    if (
      ts.isMethodDeclaration(node) &&
      node.body &&
      name === 'readCausalObservationSlice'
    ) {
      bodies.push(node.body)
    } else if (
      (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) &&
      name === 'readCausalObservationSlice' &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      bodies.push(node.initializer.body)
    }
    ts.forEachChild(node, findImplementations)
  }
  findImplementations(sourceFile)

  const findings = []
  const seen = new Set()
  const addFinding = (node, reason) => {
    const key = `${node.pos}:${node.end}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(reason)
  }

  for (const body of bodies) {
    const inspect = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression
        const member = accessMemberName(callee)
        const forbiddenMember = member ? forbiddenObservationMember(member) : null
        if (forbiddenMember) {
          addFinding(callee, forbiddenMember)
        } else if (ts.isIdentifier(callee)) {
          const forbiddenCall = forbiddenObservationMember(callee.text)
          if (forbiddenCall) addFinding(callee, forbiddenCall)
        }

        const segments = expressionSegments(callee)
        if (
          segments.some((segment) => /memory/i.test(segment)) ||
          memoryRuntimeBindings.has(segments[0])
        ) {
          addFinding(callee, `Memory API call "${segments.join('.')}"`)
        } else if (
          ts.isNewExpression(node) &&
          segments.some((segment) => /(?:database|sqlite|sql)/i.test(segment))
        ) {
          addFinding(callee, `SQL runtime construction "${segments.join('.')}"`)
        }
      } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const member = accessMemberName(node)
        const forbiddenMember = member ? forbiddenObservationMember(member) : null
        if (forbiddenMember) {
          addFinding(node, forbiddenMember)
        } else {
          const parentOwnsAccess =
            (ts.isPropertyAccessExpression(node.parent) ||
              ts.isElementAccessExpression(node.parent)) &&
            node.parent.expression === node
          const segments = expressionSegments(node)
          if (
            !parentOwnsAccess &&
            (segments.some((segment) => /memory/i.test(segment)) ||
              memoryRuntimeBindings.has(segments[0]))
          ) {
            addFinding(node, `Memory API member "${segments.join('.')}"`)
          }
        }
      } else if (ts.isIdentifier(node) && memoryRuntimeBindings.has(node.text)) {
        const parentConsumesIdentifier =
          ((ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) &&
            node.parent.expression === node) ||
          ((ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
            node.parent.expression === node)
        if (!parentConsumesIdentifier) {
          addFinding(node, `Memory runtime import "${node.text}"`)
        }
      } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        const member = node.propertyName
          ? propertyNameText(node.propertyName)
          : propertyNameText(node.name)
        const forbiddenMember = member ? forbiddenObservationMember(member) : null
        if (forbiddenMember) addFinding(node, forbiddenMember)
      }
      ts.forEachChild(node, inspect)
    }
    inspect(body)
  }

  return findings
}

function scriptSourceForAst(source, filePath) {
  if (path.extname(filePath) !== '.vue') return source
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join('\n')
}

function countDeprecatedMemoryClientCalls(source, filePath) {
  const astSource = scriptSourceForAst(source, filePath)
  if (!astSource.trim()) return 0
  const sourceFile = sourceFileForAst(source, filePath, ts.ScriptKind.TSX)
  const factoryNames = new Set(['createMemoryClient'])
  const routeNames = new Set(['memoryListRoute'])
  const clientNames = new Set()
  const destructuredListNames = new Set()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const bindings = statement.importClause.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (importedName === 'createMemoryClient') factoryNames.add(element.name.text)
      if (importedName === 'memoryListRoute') routeNames.add(element.name.text)
    }
  }

  const isFactoryCall = (node) =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factoryNames.has(node.expression.text)
  const isClientExpression = (node) =>
    (ts.isIdentifier(node) && clientNames.has(node.text)) || isFactoryCall(node)

  let changed = true
  while (changed) {
    changed = false
    const discover = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name) && isClientExpression(node.initializer)) {
          if (!clientNames.has(node.name.text)) {
            clientNames.add(node.name.text)
            changed = true
          }
        } else if (ts.isObjectBindingPattern(node.name) && isClientExpression(node.initializer)) {
          for (const element of node.name.elements) {
            const propertyName = element.propertyName
            const boundName = element.name
            if (
              ts.isIdentifier(boundName) &&
              ((propertyName && ts.isIdentifier(propertyName) && propertyName.text === 'list') ||
                (!propertyName && boundName.text === 'list'))
            ) {
              destructuredListNames.add(boundName.text)
            }
          }
        }
      }
      ts.forEachChild(node, discover)
    }
    discover(sourceFile)
  }

  let count = 0
  const inspect = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'list' &&
        isClientExpression(callee.expression)
      ) {
        count += 1
      } else if (ts.isIdentifier(callee) && destructuredListNames.has(callee.text)) {
        count += 1
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'invoke' &&
        node.arguments.some(
          (argument) =>
            ts.isPropertyAccessExpression(argument) &&
            argument.name.text === 'name' &&
            ts.isIdentifier(argument.expression) &&
            routeNames.has(argument.expression.text)
        )
      ) {
        count += 1
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(sourceFile)
  return count
}

async function resolveImport(specifier, importer, aliasRoot = MAIN_SOURCE_ROOT, virtualFiles = new Map()) {
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
      if (virtualFiles.has(path.resolve(candidate))) return candidate
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

  if (specifier === '@shared') {
    return await tryFile(SHARED_SOURCE_ROOT)
  }

  if (specifier.startsWith('@shared/')) {
    return await tryFile(path.join(SHARED_SOURCE_ROOT, specifier.slice('@shared/'.length)))
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

export async function runArchitectureGuard({ virtualFiles = new Map(), memoryCompiler = {} } = {}) {
  const normalizedVirtualFiles = new Map(
    [...virtualFiles].map(([filePath, source]) => [path.resolve(filePath), source])
  )
  const scanRoots = [path.join(ROOT, 'src'), REGULAR_MAIN_TEST_ROOT]
  const fileSet = new Set()

  for (const root of scanRoots) {
    for (const file of await collectFiles(root)) {
      fileSet.add(file)
    }
  }

  for (const filePath of normalizedVirtualFiles.keys()) fileSet.add(filePath)

  const readSource = async (filePath) =>
    normalizedVirtualFiles.get(path.resolve(filePath)) ?? fs.readFile(filePath, 'utf8')
  const violations = []
  const memoryCoordinatorOwners = []
  const memoryArchitectureFileSet = new Set(
    [...fileSet].filter((filePath) => isUnder(filePath, path.join(ROOT, 'src')))
  )
  violations.push(
    ...(await analyzeMemoryArchitecture({
      root: ROOT,
      fileSet: memoryArchitectureFileSet,
      readSource,
      resolveImport: (specifier, importer) =>
        resolveImport(specifier, importer, MAIN_SOURCE_ROOT, normalizedVirtualFiles),
      virtualFiles: normalizedVirtualFiles,
      compiler: memoryCompiler
    }))
  )

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

  for (const retiredPath of RETIRED_MAIN_PATHS) {
    const virtualPathExists = [...normalizedVirtualFiles.keys()].some((filePath) =>
      isUnder(filePath, retiredPath)
    )
    if ((await pathExists(retiredPath)) || virtualPathExists) {
      violations.push(`[main-retired-path] ${relativePath(retiredPath)} must remain deleted`)
    }
  }

  for (const filePath of [...fileSet].sort()) {
    const source = await readSource(filePath)
    const specifiers = extractModuleSpecifiers(source)
    const isMainSource = isUnder(filePath, MAIN_SOURCE_ROOT)
    const scansRetiredSessionFacade =
      isMainSource ||
      isUnder(filePath, SHARED_SOURCE_ROOT) ||
      isUnder(filePath, REGULAR_MAIN_TEST_ROOT)
    const sourceFile = scansRetiredSessionFacade ? sourceFileForAst(source, filePath) : null

    if (scansRetiredSessionFacade) {
      const retiredFacadeNames = findIdentifierNames(
        sourceFile,
        RETIRED_SESSION_FACADE_NAMES
      )
      for (const name of retiredFacadeNames) {
        violations.push(
          `[session-retired-facade-symbol] ${relativePath(filePath)} must not reference ${name}`
        )
      }
    }

    if (isMainSource) {
      const importRecords = importRecordsFromSourceFile(sourceFile)

      if (isSessionMigratedConsumerPath(filePath)) {
        const presenterDependencies = findIdentifierNames(
          sourceFile,
          new Set(['IAgentSessionPresenter', 'agentSessionPresenter'])
        )
        if (presenterDependencies.has('IAgentSessionPresenter')) {
          violations.push(
            `[session-consumer-presenter-type] ${relativePath(filePath)} must not use IAgentSessionPresenter`
          )
        }
        if (presenterDependencies.has('agentSessionPresenter')) {
          violations.push(
            `[session-consumer-presenter-facade] ${relativePath(filePath)} must not use agentSessionPresenter`
          )
        }
      }

      const allowedOwnerConstructions =
        path.resolve(filePath) === path.resolve(PRESENTER_ROOT_ENTRY) ? 1 : 0
      for (const [owner, count] of findSessionApplicationOwnerConstructions(
        sourceFile,
        importRecords
      )) {
        if (count > allowedOwnerConstructions) {
          violations.push(
            `[session-application-duplicate-construction] ${relativePath(filePath)} constructs ${owner} ${count} times; expected <= ${allowedOwnerConstructions}`
          )
        }
      }

      const combinedFacades = findIdentifierNames(sourceFile, SESSION_COMBINED_FACADE_NAMES)
      for (const facade of findCombinedSessionFacadeDeclarations(
        sourceFile,
        importRecords,
        path.resolve(filePath) !== path.resolve(PRESENTER_ROOT_ENTRY)
      )) {
        combinedFacades.add(facade)
      }
      for (const facade of combinedFacades) {
        violations.push(
          `[session-application-combined-facade] ${relativePath(filePath)} contains ${facade}`
        )
      }

      if (isSessionApplicationOwnerPath(filePath)) {
        for (const specifier of specifiers) {
          if (isSessionPhaseOneForeignImport(specifier)) {
            violations.push(
              `[session-coordinator-phase1-import] ${relativePath(filePath)} -> ${specifier}`
            )
          }
        }
      }

      if (isUnder(filePath, SESSION_APPLICATION_ROOT)) {
        const wholeDependencies = findIdentifierNames(
          sourceFile,
          SESSION_COORDINATOR_WHOLE_DEPENDENCY_NAMES
        )

        for (const specifier of new Set(importRecords.map((record) => record.specifier))) {
          const aggregateRecords = importRecords.filter(
            (record) =>
              record.specifier === specifier &&
              (record.importedName === 'default' ||
                record.importedName === '*' ||
                record.importedName === 'presenter')
          )
          if (aggregateRecords.length === 0) continue

          const resolved = await resolveImport(
            specifier,
            filePath,
            MAIN_SOURCE_ROOT,
            normalizedVirtualFiles
          )
          if (!resolved) continue
          if (path.resolve(resolved) === path.resolve(PRESENTER_ROOT_ENTRY)) {
            wholeDependencies.add('Presenter')
          }
          if (isUnder(resolved, SQLITE_PRESENTER_ROOT)) {
            wholeDependencies.add('SQLitePresenter')
          }
        }

        for (const dependency of wholeDependencies) {
          violations.push(
            `[session-coordinator-whole-dependency] ${relativePath(filePath)} imports ${dependency}`
          )
        }
      }
    }

    if (SESSION_BOUNDARY_STARTUP_HOOK_PATHS.has(path.resolve(filePath))) {
      const hook = analyzeSessionBoundaryStartupHook(source, filePath)
      if (hook.agentSessionPresenterDependencies > 0) {
        violations.push(
          `[session-boundary-hook-presenter] ${relativePath(filePath)} must not reference AgentSessionPresenter`
        )
      }
      if (hook.unknownDoubleCasts > 0) {
        violations.push(
          `[session-boundary-hook-unknown-cast] ${relativePath(filePath)} must not use as unknown as`
        )
      }
      if (hook.typeAssertions > 0) {
        violations.push(
          `[session-boundary-hook-type-cast] ${relativePath(filePath)} must use typed owners without concrete casts`
        )
      }
      if (hook.optionalStartTaskProbes > 0) {
        violations.push(
          `[session-boundary-hook-optional-task] ${relativePath(filePath)} must not use optional start*Task probes`
        )
      }
    }

    if (isUnder(filePath, path.join(ROOT, 'src')) || isUnder(filePath, REGULAR_MAIN_TEST_ROOT)) {
      for (const [symbol, pattern] of RETIRED_AGENT_RUNTIME_PATTERNS) {
        const count = countMatches(source, pattern)
        if (count > 0) {
          violations.push(
            `[agent-retired-runtime-symbol] ${relativePath(filePath)} expected 0 ${symbol}, found ${count}`
          )
        }
      }
    }

    if (AGENT_HANDLE_BACKEND_RUNTIME_KIND_ROOTS.some((root) => isUnder(filePath, root))) {
      const retiredRuntimeKinds = findRetiredAgentRuntimeKindUsages(source, filePath).length
      if (retiredRuntimeKinds > 0) {
        violations.push(
          `[agent-retired-handle-runtime-kind] ${relativePath(filePath)} expected 0 legacy/direct agent runtimeKind literals, found ${retiredRuntimeKinds}`
        )
      }
    }

    if (INTERNAL_AGENT_KIND_ROOTS.some((root) => isUnder(filePath, root))) {
      const kindAliasFallbacks = findInternalAgentKindAliasFallbacks(source, filePath).length
      if (kindAliasFallbacks > 0) {
        violations.push(
          `[agent-kind-alias-fallback] ${relativePath(filePath)} expected 0 agentType/type fallback expressions, found ${kindAliasFallbacks}`
        )
      }
    }

    if (isUnder(filePath, MAIN_SOURCE_ROOT)) {
      if (source.includes('MemoryRuntimeCoordinator')) {
        const coordinatorClasses = findNamedClassDeclarations(
          sourceFile,
          'MemoryRuntimeCoordinator'
        )
        memoryCoordinatorOwners.push(
          ...coordinatorClasses.map(() => relativePath(filePath))
        )
      }

      if (path.resolve(filePath) === path.resolve(MEMORY_RUNTIME_COORDINATOR_PATH)) {
        const coordinatorStructure = analyzeMemoryRuntimeCoordinatorStructure(source, filePath)
        violations.push(...coordinatorStructure.violations)
      }

      const legacyListCalls = countMatches(source, LEGACY_MEMORY_PRESENTER_LIST_PATTERN)
      const allowedCalls = LEGACY_MEMORY_PRESENTER_LIST_ALLOWLIST.get(path.resolve(filePath)) ?? 0
      if (legacyListCalls > allowedCalls) {
        violations.push(
          `[memory-legacy-list-caller] ${relativePath(filePath)} expected <= ${allowedCalls}, found ${legacyListCalls}; use memory.page or an owner-scoped lookup`
        )
      }

      if (isUnder(filePath, AGENT_RUNTIME_PRESENTER_ROOT)) {
        const retiredMemory = findRetiredMemoryPresenterMembers(source, filePath)
        if (retiredMemory.owners.length > 0) {
          violations.push(
            `[memory-retired-presenter-owner] ${relativePath(filePath)} expected 0 retired orchestration owner fields, found ${retiredMemory.owners.join(', ')}`
          )
        }
        if (retiredMemory.injection.length > 0) {
          violations.push(
            `[memory-retired-presenter-injection] ${relativePath(filePath)} expected 0 private Memory injection callbacks, found ${retiredMemory.injection.join(', ')}`
          )
        }
        if (retiredMemory.ingestionTriggers.length > 0) {
          violations.push(
            `[memory-retired-presenter-ingestion-trigger] ${relativePath(filePath)} expected 0 legacy Memory ingestion trigger calls, found ${retiredMemory.ingestionTriggers.join(', ')}`
          )
        }
      }

      if (source.includes('readCausalObservationSlice')) {
        for (const finding of findCausalObservationViolations(source, filePath)) {
          violations.push(
            `[causal-observation-write-edge] ${relativePath(filePath)} readCausalObservationSlice forbids ${finding}`
          )
        }
      }
    }

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
      const legacyMemoryListCount = countDeprecatedMemoryClientCalls(source, filePath)
      const allowedMemoryListCount =
        LEGACY_MEMORY_BRIDGE_ALLOWLIST.get(path.resolve(filePath)) ?? 0

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

      if (legacyMemoryListCount > allowedMemoryListCount) {
        violations.push(
          `[memory-legacy-list-caller] ${file} expected <= ${allowedMemoryListCount}, found ${legacyMemoryListCount}; use memoryClient.page`
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

    if (isUnder(filePath, ACP_DIRECT_INSTANCE_ROOT)) {
      for (const specifier of specifiers) {
        const resolved = await resolveImport(
          specifier,
          filePath,
          MAIN_SOURCE_ROOT,
          normalizedVirtualFiles
        )
        if (!resolved) continue

        if (isUnder(resolved, DEEPCHAT_LOOP_ROOT)) {
          violations.push(
            `[acp-direct-instance-deepchat-loop] ${relativePath(filePath)} -> ${specifier}`
          )
        }
        if (isUnder(resolved, MEMORY_PRESENTER_ROOT)) {
          violations.push(`[acp-direct-instance-memory] ${relativePath(filePath)} -> ${specifier}`)
        }
        if (path.resolve(resolved) === path.resolve(PRESENTER_ROOT_ENTRY)) {
          violations.push(
            `[acp-direct-instance-presenter-root] ${relativePath(filePath)} -> ${specifier}`
          )
        }
        if (isUnder(resolved, SQLITE_PRESENTER_ROOT)) {
          violations.push(`[acp-direct-instance-sqlite] ${relativePath(filePath)} -> ${specifier}`)
        }
      }
    }

    if (isUnder(filePath, DEEPCHAT_LOOP_ROOT)) {
      for (const specifier of specifiers) {
        if (specifier === 'electron' || specifier.startsWith('electron/')) {
          violations.push(`[deepchat-loop-electron] ${relativePath(filePath)} -> ${specifier}`)
          continue
        }

        const resolved = await resolveImport(
          specifier,
          filePath,
          MAIN_SOURCE_ROOT,
          normalizedVirtualFiles
        )
        if (!resolved) continue

        if (isUnder(resolved, SQLITE_PRESENTER_ROOT)) {
          violations.push(`[deepchat-loop-sqlite] ${relativePath(filePath)} -> ${specifier}`)
        } else if (isUnder(resolved, MAIN_PRESENTER_ROOT)) {
          violations.push(`[deepchat-loop-presenter] ${relativePath(filePath)} -> ${specifier}`)
        }
        if (isUnder(resolved, MAIN_ROUTES_ROOT)) {
          violations.push(`[deepchat-loop-routes] ${relativePath(filePath)} -> ${specifier}`)
        }
        if (isUnder(resolved, ACP_ROOT)) {
          violations.push(`[deepchat-loop-acp] ${relativePath(filePath)} -> ${specifier}`)
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

  if (memoryCoordinatorOwners.length !== 1) {
    violations.push(
      `[memory-coordinator-owner-count] expected exactly 1 MemoryRuntimeCoordinator class, found ${memoryCoordinatorOwners.length}${memoryCoordinatorOwners.length ? `: ${memoryCoordinatorOwners.join(', ')}` : ''}`
    )
  }

  const hotPathEdges = await collectHotPathDirectEdges()
  if (hotPathEdges.length > HOT_PATH_EDGE_BASELINE) {
    violations.push(
      `[hotpath-presenter-edge-growth] expected <= ${HOT_PATH_EDGE_BASELINE}, found ${hotPathEdges.length}`
    )
  }

  return violations
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  runArchitectureGuard()
    .then((violations) => {
      if (violations.length > 0) {
        console.error('Architecture guard failed.')
        for (const violation of violations) console.error(`- ${violation}`)
        process.exitCode = 1
        return
      }
      console.log('Architecture guard passed.')
    })
    .catch((error) => {
      console.error('Architecture guard failed to run:', error)
      process.exitCode = 1
    })
}
