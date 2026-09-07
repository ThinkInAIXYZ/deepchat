import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

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

const LEGACY_MAIN_DIRS = [
  path.join(ROOT, 'src/main/presenter/agentPresenter'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter')
]

const PRIMARY_MAIN_GUARD_PATHS = [
  path.join(ROOT, 'src/main/agent'),
  path.join(ROOT, 'src/main/skill'),
  path.join(ROOT, 'src/main/mcp/toolManager.ts'),
  path.join(ROOT, 'src/main/sync/index.ts')
]

const RENDERER_CHAT_GUARD_PATHS = [
  path.join(ROOT, 'src/renderer/src/features/chat-page/ChatPage.vue'),
  path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
  path.join(ROOT, 'src/renderer/src/stores/ui'),
  path.join(ROOT, 'src/renderer/src/components/chat'),
  path.join(ROOT, 'src/renderer/src/components/message'),
  path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'),
  path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')
]

const LEGACY_AGENT_RUNTIME_DIR = path.join(ROOT, 'src/main/presenter/agentPresenter')
const PROVIDER_LAYER_DIR = path.join(ROOT, 'src/main/provider/providers')
const SKILL_SERVICE_DIR = path.join(ROOT, 'src/main/skill')
const MCP_TOOL_MANAGER_FILE = path.join(ROOT, 'src/main/mcp/toolManager.ts')
const DEEPCHAT_HARNESS_DIR = path.join(ROOT, 'src/main/agent/deepchat/harness')
const DEEPCHAT_AGENT_HARNESS_FILE = path.join(DEEPCHAT_HARNESS_DIR, 'deepChatAgentHarness.ts')
const DEEPCHAT_HARNESS_COMPOSITION_FILE = path.join(
  DEEPCHAT_HARNESS_DIR,
  'createDeepChatAgentHarness.ts'
)
const DEEPCHAT_HARNESS_OWNERSHIP_FILES = [
  DEEPCHAT_AGENT_HARNESS_FILE,
  DEEPCHAT_HARNESS_COMPOSITION_FILE
]
// Owner layers below the harness boundary. None of them may reach back up into it.
const DEEPCHAT_RUNTIME_LAYER_DIRS = [
  'runtime',
  'loop',
  'instance',
  'memory',
  'resources'
].map((segment) => path.join(ROOT, 'src/main/agent/deepchat', segment))
const DEEPCHAT_HARNESS_BARREL_FILE = path.join(DEEPCHAT_HARNESS_DIR, 'index.ts')
// The harness barrel is the only supported entry point. Exporting the composed owner graph or its
// factory would let callers reach an owner around the facade, or build a second runtime with its
// own restart-recovery side effects.
const DEEPCHAT_HARNESS_PUBLIC_EXPORTS = new Set([
  'createDeepChatAgentHarness',
  'DeepChatAgentHarness',
  'DeepChatHarnessDependencies',
  'DeepChatHarnessSkillPort'
])
const DEEPCHAT_AGENT_HARNESS_MAX_LINES = 350
const DEEPCHAT_PENDING_INPUTS_FILE = path.join(ROOT, 'src/main/session/data/pendingInputs.ts')
const DEEPCHAT_AGENT_INSTANCE_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/instance/deepChatAgentInstance.ts'
)
const DEEPCHAT_RUN_LIFECYCLE_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/runtime/runLifecycleCoordinator.ts'
)
const DEEPCHAT_COMPACTION_SERVICE_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/runtime/compactionService.ts'
)
const DEEPCHAT_SYSTEM_PROMPT_BUILDER_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/resources/systemPromptBuilder.ts'
)
const DEEPCHAT_TOOL_ADAPTERS_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/runtime/toolAdapters.ts'
)
const DEEPCHAT_TOOL_PERMISSION_REVIEWER_FILE = path.join(
  ROOT,
  'src/main/agent/deepchat/runtime/toolPermissionReviewer.ts'
)
const DEEPCHAT_TRANSCRIPT_FILE = path.join(ROOT, 'src/main/session/data/transcript.ts')
const DEEPCHAT_ROOT_OWNERSHIP_RULES = [
  {
    kind: 'session-projection-implementation',
    calls: [
      { name: 'buildSystemPromptWithSkills', ownerFile: DEEPCHAT_SYSTEM_PROMPT_BUILDER_FILE },
      { name: 'normalizeToolResultContent', ownerFile: DEEPCHAT_TOOL_ADAPTERS_FILE },
      {
        name: 'reviewAutoApproveToolPermission',
        ownerFile: DEEPCHAT_TOOL_PERMISSION_REVIEWER_FILE
      },
      { name: 'updateAssistantContent', ownerFile: DEEPCHAT_TRANSCRIPT_FILE }
    ]
  },
  {
    kind: 'manual-compaction-lifecycle',
    calls: [
      { name: 'prepareForManualCompaction', ownerFile: DEEPCHAT_COMPACTION_SERVICE_FILE }
    ]
  },
  {
    kind: 'pending-input-claim-lifecycle',
    calls: [
      'claimQueuedInput',
      'claimSteerInput',
      'consumeQueuedInput',
      'consumeSteerInput',
      'releaseClaimedInput'
    ].map((name) => ({ name, ownerFile: DEEPCHAT_PENDING_INPUTS_FILE }))
  },
  {
    kind: 'pending-input-drain-selection',
    calls: [
      ...['getNextQueuedInput', 'getNextSteerInput'].map((name) => ({
        name,
        ownerFile: DEEPCHAT_PENDING_INPUTS_FILE
      })),
      ...['tryAcquirePendingQueueDrain', 'releasePendingQueueDrain'].map((name) => ({
        name,
        ownerFile: DEEPCHAT_AGENT_INSTANCE_FILE
      }))
    ]
  },
  {
    kind: 'operation-controller-lifecycle',
    calls: [
      { name: 'ensureOperationController', ownerFile: DEEPCHAT_RUN_LIFECYCLE_FILE },
      { name: 'setAbortController', ownerFile: DEEPCHAT_AGENT_INSTANCE_FILE },
      { name: 'clearAbortController', ownerFile: DEEPCHAT_AGENT_INSTANCE_FILE }
    ]
  }
]

const LEGACY_AGENT_RUNTIME_GLOBALS = [
  'sessionManager',
  'toolPresenter',
  'mcpPresenter',
  'configService',
  'skillPresenter',
  'filePermissionService',
  'settingsPermissionService',
  'agentSessionPresenter',
  'sessionPresenter',
  'yoBrowserPresenter',
  'filePresenter',
  'providerRuntime',
  'windowPresenter'
]

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

function isProtectedPath(filePath, protectedPaths) {
  return protectedPaths.some((entry) => isUnder(filePath, entry))
}

function extractModuleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1])
    }
  }

  return specifiers
}

function createTypeScriptSourceFile(filePath, source) {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function calledSymbolName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text
  }
  return null
}

function collectRootOwnershipUsage(filePath, source) {
  const sourceFile = createTypeScriptSourceFile(filePath, source)
  const calls = new Set()
  const identifiers = new Set()

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calledSymbolName(node.expression)
      if (name) {
        calls.add(name)
      }
    }
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { calls, identifiers }
}

function collectDeclaredSymbols(filePath, source) {
  const sourceFile = createTypeScriptSourceFile(filePath, source)
  const declarations = new Set()
  const visit = (node) => {
    if (
      (ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isPropertySignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      declarations.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return declarations
}

export function findDeepChatRootOwnershipViolations(source, filePath = DEEPCHAT_AGENT_HARNESS_FILE) {
  const usage = collectRootOwnershipUsage(filePath, source)
  const violations = []
  for (const rule of DEEPCHAT_ROOT_OWNERSHIP_RULES) {
    for (const symbol of rule.calls ?? []) {
      if (usage.calls.has(symbol.name)) {
        violations.push({ kind: rule.kind, detail: `${symbol.name}()` })
      }
    }
    for (const symbol of rule.identifiers ?? []) {
      if (usage.identifiers.has(symbol.name)) {
        violations.push({ kind: rule.kind, detail: symbol.name })
      }
    }
  }
  return violations
}

export async function findMissingDeepChatOwnershipSymbols() {
  const symbolsByOwner = new Map()
  for (const rule of DEEPCHAT_ROOT_OWNERSHIP_RULES) {
    for (const symbol of [...(rule.calls ?? []), ...(rule.identifiers ?? [])]) {
      const names = symbolsByOwner.get(symbol.ownerFile) ?? new Set()
      names.add(symbol.name)
      symbolsByOwner.set(symbol.ownerFile, names)
    }
  }

  const missing = []
  for (const [ownerFile, protectedSymbols] of symbolsByOwner) {
    const source = await fs.readFile(ownerFile, 'utf8')
    const declarations = collectDeclaredSymbols(ownerFile, source)
    for (const symbol of protectedSymbols) {
      if (!declarations.has(symbol)) {
        missing.push({ ownerFile, symbol })
      }
    }
  }
  return missing
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

function isLegacyMainImport(filePath, specifier) {
  if (!isProtectedPath(filePath, PRIMARY_MAIN_GUARD_PATHS)) {
    return false
  }

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(filePath), specifier)
    return LEGACY_MAIN_DIRS.some((legacyDir) => isUnder(resolved, legacyDir))
  }

  return (
    specifier === '@/presenter/agentPresenter' ||
    specifier.startsWith('@/presenter/agentPresenter/') ||
    specifier === '@/presenter/sessionPresenter' ||
    specifier.startsWith('@/presenter/sessionPresenter/')
  )
}

function withoutSourceExtension(value) {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

function resolveSpecifierPath(filePath, specifier) {
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(filePath), specifier)
  }
  if (specifier.startsWith('@/')) {
    return path.join(ROOT, 'src/main', specifier.slice(2))
  }
  return null
}

export function isDeepChatHarnessInternalImport(filePath, specifier) {
  if (isUnder(filePath, DEEPCHAT_HARNESS_DIR)) {
    return false
  }
  const resolved = resolveSpecifierPath(filePath, specifier)
  if (!resolved || !isUnder(resolved, DEEPCHAT_HARNESS_DIR)) {
    return false
  }
  const normalized = withoutSourceExtension(resolved)
  return (
    normalized !== withoutSourceExtension(DEEPCHAT_HARNESS_DIR) &&
    normalized !== withoutSourceExtension(DEEPCHAT_HARNESS_BARREL_FILE)
  )
}

export function findDeepChatHarnessBarrelViolations(source) {
  const sourceFile = createTypeScriptSourceFile(DEEPCHAT_HARNESS_BARREL_FILE, source)
  const violations = []
  const flag = (name) => {
    if (!DEEPCHAT_HARNESS_PUBLIC_EXPORTS.has(name)) {
      violations.push({ kind: 'deepchat-harness-export-surface', detail: name })
    }
  }
  const flagBindingName = (name) => {
    if (ts.isIdentifier(name)) {
      flag(name.text)
      return
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) flagBindingName(element.name)
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        violations.push({ kind: 'deepchat-harness-export-surface', detail: '* re-export' })
        continue
      }
      for (const element of statement.exportClause.elements) {
        flag(element.name.text)
      }
      continue
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        flag(statement.expression.text)
      } else {
        violations.push({ kind: 'deepchat-harness-export-surface', detail: 'default export' })
      }
      continue
    }
    const isDeclaration =
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isVariableStatement(statement)
    if (!isDeclaration) continue
    if ((ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) === 0) continue

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        flagBindingName(declaration.name)
      }
      continue
    }
    if (statement.name) {
      flag(statement.name.text)
    } else {
      violations.push({ kind: 'deepchat-harness-export-surface', detail: 'default export' })
    }
  }

  return violations
}

export function isDeepChatHarnessImport(filePath, specifier) {
  if (!DEEPCHAT_RUNTIME_LAYER_DIRS.some((layerDir) => isUnder(filePath, layerDir))) {
    return false
  }

  if (specifier.startsWith('.')) {
    return isUnder(path.resolve(path.dirname(filePath), specifier), DEEPCHAT_HARNESS_DIR)
  }

  return (
    withoutSourceExtension(specifier) === '@/agent/deepchat/harness' ||
    specifier.startsWith('@/agent/deepchat/harness/')
  )
}

function buildViolation(kind, filePath, detail) {
  return {
    kind,
    file: relativePath(filePath),
    detail
  }
}

async function findViolations() {
  const scanRoots = [
    path.join(ROOT, 'src/main/agent'),
    path.join(ROOT, 'src/main/app/composition.ts'),
    path.join(ROOT, 'src/main/skill'),
    path.join(ROOT, 'src/main/mcp/toolManager.ts'),
    path.join(ROOT, 'src/main/sync/index.ts'),
    path.join(ROOT, 'src/main/provider/providers'),
    path.join(ROOT, 'src/renderer/src/features/chat-page/ChatPage.vue'),
    path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
    path.join(ROOT, 'src/renderer/src/stores/ui'),
    path.join(ROOT, 'src/renderer/src/components/chat'),
    path.join(ROOT, 'src/renderer/src/components/message'),
    path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'),
    path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')
  ]

  const fileSet = new Set()
  for (const entry of scanRoots) {
    try {
      for (const file of await collectFiles(entry)) {
        fileSet.add(file)
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Agent cleanup guard scan root is missing: ${relativePath(entry)}`)
      }
      throw error
    }
  }

  const violations = []
  for (const missing of await findMissingDeepChatOwnershipSymbols()) {
    violations.push(
      buildViolation(
        'deepchat-ownership-symbol-missing',
        missing.ownerFile,
        missing.symbol
      )
    )
  }
  for (const filePath of [...fileSet].sort()) {
    const source = await fs.readFile(filePath, 'utf8')

    if (filePath === DEEPCHAT_AGENT_HARNESS_FILE) {
      const lineCount = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
      if (lineCount > DEEPCHAT_AGENT_HARNESS_MAX_LINES) {
        violations.push(
          buildViolation(
            'deepchat-agent-harness-size',
            filePath,
            `${lineCount} lines (max ${DEEPCHAT_AGENT_HARNESS_MAX_LINES})`
          )
        )
      }
    }

    if (filePath === DEEPCHAT_HARNESS_BARREL_FILE) {
      for (const violation of findDeepChatHarnessBarrelViolations(source)) {
        violations.push(buildViolation(violation.kind, filePath, violation.detail))
      }
    }

    if (DEEPCHAT_HARNESS_OWNERSHIP_FILES.includes(filePath)) {
      for (const violation of findDeepChatRootOwnershipViolations(source, filePath)) {
        violations.push(buildViolation(violation.kind, filePath, violation.detail))
      }
    }

    for (const specifier of extractModuleSpecifiers(source)) {
      if (isLegacyMainImport(filePath, specifier)) {
        violations.push(buildViolation('legacy-main-import', filePath, specifier))
      }

      if (isDeepChatHarnessImport(filePath, specifier)) {
        violations.push(buildViolation('deepchat-runtime-owner-imports-harness', filePath, specifier))
      }

      if (isDeepChatHarnessInternalImport(filePath, specifier)) {
        violations.push(buildViolation('deepchat-harness-internal-import', filePath, specifier))
      }

      if (
        isProtectedPath(filePath, RENDERER_CHAT_GUARD_PATHS) &&
        (specifier === '@shared/chat' || specifier.startsWith('@shared/chat/'))
      ) {
        violations.push(buildViolation('legacy-chat-import', filePath, specifier))
      }
    }

    if (filePath === MCP_TOOL_MANAGER_FILE && source.includes('input_chatMode')) {
      violations.push(buildViolation('global-chat-mode', filePath, 'input_chatMode'))
    }

    if (
      isProtectedPath(filePath, PRIMARY_MAIN_GUARD_PATHS) &&
      source.includes('presenter.sessionPresenter.')
    ) {
      violations.push(buildViolation('legacy-session-access', filePath, 'presenter.sessionPresenter'))
    }

    if (isProtectedPath(filePath, [SKILL_SERVICE_DIR]) && /\bpresenter\./.test(source)) {
      violations.push(buildViolation('skill-global-presenter', filePath, 'presenter.*'))
    }

    if (
      isProtectedPath(filePath, [SKILL_SERVICE_DIR]) &&
      (source.includes('getLegacyConversation') || source.includes('updateLegacyConversationSettings'))
    ) {
      violations.push(buildViolation('skill-legacy-fallback', filePath, 'legacy conversation skills'))
    }

    if (isProtectedPath(filePath, [LEGACY_AGENT_RUNTIME_DIR])) {
      for (const legacyGlobal of LEGACY_AGENT_RUNTIME_GLOBALS) {
        if (source.includes(`presenter.${legacyGlobal}`)) {
          violations.push(
            buildViolation(`agent-global-${legacyGlobal}`, filePath, `presenter.${legacyGlobal}`)
          )
        }
      }
    }

    if (isProtectedPath(filePath, [PROVIDER_LAYER_DIR]) && source.includes('presenter.mcpPresenter')) {
      violations.push(buildViolation('provider-global-mcp', filePath, 'presenter.mcpPresenter'))
    }
  }

  return violations
}

async function main() {
  const violations = await findViolations()
  if (violations.length > 0) {
    console.error('Agent cleanup guard failed.')
    for (const violation of violations) {
      console.error(`- [${violation.kind}] ${violation.file} -> ${violation.detail}`)
    }
    process.exit(1)
  }

  console.log('Agent cleanup guard passed. Baseline violations tracked: 0.')
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main().catch((error) => {
    console.error('Agent cleanup guard failed to run:', error)
    process.exit(1)
  })
}
