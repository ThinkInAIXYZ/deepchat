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
const RENDERER_TYPED_BOUNDARY_ROOT = path.join(ROOT, 'src/renderer/api')
const RENDERER_QUARANTINE_ROOTS = [path.join(ROOT, 'src/renderer/api/legacy')]
const MAIN_SOURCE_ROOT = path.join(ROOT, 'src/main')
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

const RENDERER_USE_PRESENTER_BASELINE = new Map([
  ['src/renderer/src/App.vue', 2],
  ['src/renderer/src/components/AppBar.vue', 2],
  ['src/renderer/src/components/artifacts/ArtifactThinking.vue', 1],
  ['src/renderer/src/components/artifacts/SvgArtifact.vue', 1],
  ['src/renderer/src/components/chat-input/composables/useAgentMcpData.ts', 1],
  ['src/renderer/src/components/chat-input/composables/useChatMode.ts', 1],
  ['src/renderer/src/components/chat-input/composables/useInputSettings.ts', 1],
  ['src/renderer/src/components/chat-input/composables/useRateLimitStatus.ts', 1],
  ['src/renderer/src/components/chat-input/composables/useSkillsData.ts', 1],
  ['src/renderer/src/components/chat-input/McpIndicator.vue', 3],
  ['src/renderer/src/components/chat-input/SkillsIndicator.vue', 1],
  ['src/renderer/src/components/chat/ChatStatusBar.vue', 3],
  ['src/renderer/src/components/chat/composables/useChatInputFiles.ts', 1],
  ['src/renderer/src/components/chat/composables/useChatInputMentions.ts', 3],
  ['src/renderer/src/components/ChatConfig.vue', 1],
  ['src/renderer/src/components/icons/AcpAgentIcon.vue', 1],
  ['src/renderer/src/components/markdown/MarkdownRenderer.vue', 1],
  ['src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts', 2],
  ['src/renderer/src/components/mcp-config/AgentMcpSelector.vue', 1],
  ['src/renderer/src/components/mcp-config/mcpServerForm.vue', 1],
  ['src/renderer/src/components/message/MessageBlockContent.vue', 1],
  ['src/renderer/src/components/message/MessageBlockThink.vue', 1],
  ['src/renderer/src/components/message/MessageItemUser.vue', 1],
  ['src/renderer/src/components/popup/TranslatePopup.vue', 1],
  ['src/renderer/src/components/settings/ModelConfigDialog.vue', 1],
  ['src/renderer/src/components/sidepanel/BrowserPanel.vue', 1],
  ['src/renderer/src/components/sidepanel/WorkspacePanel.vue', 3],
  ['src/renderer/src/components/sidepanel/WorkspaceViewer.vue', 1],
  ['src/renderer/src/components/trace/TraceDialog.vue', 1],
  ['src/renderer/src/components/WindowSideBar.vue', 1],
  ['src/renderer/src/components/workspace/WorkspaceFileNode.vue', 1],
  ['src/renderer/src/composables/message/useMessageCapture.ts', 1],
  ['src/renderer/src/composables/useDeviceVersion.ts', 1],
  ['src/renderer/src/composables/useIpcMutation.ts', 1],
  ['src/renderer/src/composables/useIpcQuery.ts', 1],
  ['src/renderer/src/composables/usePageCapture.example.ts', 1],
  ['src/renderer/src/composables/usePageCapture.ts', 1],
  ['src/renderer/src/pages/AgentWelcomePage.vue', 1],
  ['src/renderer/src/pages/ChatPage.vue', 1],
  ['src/renderer/src/pages/NewThreadPage.vue', 2],
  ['src/renderer/src/pages/WelcomePage.vue', 2],
  ['src/renderer/src/stores/agentModelStore.ts', 1],
  ['src/renderer/src/stores/dialog.ts', 1],
  ['src/renderer/src/stores/floatingButton.ts', 1],
  ['src/renderer/src/stores/language.ts', 1],
  ['src/renderer/src/stores/mcp.ts', 2],
  ['src/renderer/src/stores/mcpSampling.ts', 1],
  ['src/renderer/src/stores/modelConfigStore.ts', 1],
  ['src/renderer/src/stores/modelStore.ts', 2],
  ['src/renderer/src/stores/ollamaStore.ts', 1],
  ['src/renderer/src/stores/providerStore.ts', 1],
  ['src/renderer/src/stores/shortcutKey.ts', 2],
  ['src/renderer/src/stores/skillsStore.ts', 2],
  ['src/renderer/src/stores/sync.ts', 3],
  ['src/renderer/src/stores/systemPromptStore.ts', 1],
  ['src/renderer/src/stores/theme.ts', 1],
  ['src/renderer/src/stores/ui/agent.ts', 1],
  ['src/renderer/src/stores/ui/pendingInput.ts', 1],
  ['src/renderer/src/stores/ui/project.ts', 2],
  ['src/renderer/src/stores/ui/session.ts', 3],
  ['src/renderer/src/stores/ui/spotlight.ts', 2],
  ['src/renderer/src/stores/upgrade.ts', 2]
])

const RENDERER_WINDOW_ELECTRON_BASELINE = new Map([
  ['src/renderer/src/App.vue', 1],
  ['src/renderer/src/components/AppBar.vue', 1],
  ['src/renderer/src/components/chat/ChatStatusBar.vue', 2],
  ['src/renderer/src/components/chat/composables/useChatInputMentions.ts', 2],
  ['src/renderer/src/components/chat-input/composables/useChatMode.ts', 2],
  ['src/renderer/src/components/chat-input/composables/useRateLimitStatus.ts', 6],
  ['src/renderer/src/components/chat-input/composables/useSkillsData.ts', 6],
  ['src/renderer/src/components/chat-input/McpIndicator.vue', 6],
  ['src/renderer/src/components/message/SelectedTextContextMenu.vue', 4],
  ['src/renderer/src/components/sidepanel/BrowserPanel.vue', 12],
  ['src/renderer/src/components/sidepanel/ChatSidePanel.vue', 2],
  ['src/renderer/src/components/sidepanel/composables/useWorkspaceSync.ts', 2],
  ['src/renderer/src/composables/usePresenter.ts', 2],
  ['src/renderer/src/stores/dialog.ts', 2],
  ['src/renderer/src/stores/floatingButton.ts', 1],
  ['src/renderer/src/stores/language.ts', 1],
  ['src/renderer/src/stores/mcp.ts', 6],
  ['src/renderer/src/stores/mcpSampling.ts', 6],
  ['src/renderer/src/stores/modelStore.ts', 4],
  ['src/renderer/src/stores/ollamaStore.ts', 2],
  ['src/renderer/src/stores/providerStore.ts', 5],
  ['src/renderer/src/stores/sync.ts', 7],
  ['src/renderer/src/stores/theme.ts', 4],
  ['src/renderer/src/stores/ui/agent.ts', 2],
  ['src/renderer/src/stores/ui/pendingInput.ts', 2],
  ['src/renderer/src/stores/ui/project.ts', 1],
  ['src/renderer/src/stores/upgrade.ts', 4]
])

const RENDERER_WINDOW_API_BASELINE = new Map([
  ['src/renderer/src/components/AppBar.vue', 3],
  ['src/renderer/src/components/artifacts/ArtifactBlock.vue', 1],
  ['src/renderer/src/components/artifacts/CodeArtifact.vue', 2],
  ['src/renderer/src/components/chat/composables/useChatInputFiles.ts', 2],
  ['src/renderer/src/components/chat-input/SkillsIndicator.vue', 1],
  ['src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts', 2],
  ['src/renderer/src/components/message/MessageBlockToolCall.vue', 4],
  ['src/renderer/src/components/message/MessageItemAssistant.vue', 2],
  ['src/renderer/src/components/message/MessageItemUser.vue', 1],
  ['src/renderer/src/components/sidepanel/BrowserPanel.vue', 1],
  ['src/renderer/src/components/sidepanel/ChatSidePanel.vue', 1],
  ['src/renderer/src/components/sidepanel/WorkspacePanel.vue', 1],
  ['src/renderer/src/components/trace/TraceDialog.vue', 1],
  ['src/renderer/src/components/WindowSideBar.vue', 1],
  ['src/renderer/src/composables/usePageCapture.ts', 3],
  ['src/renderer/src/lib/chatInputWorkspaceReference.ts', 1],
  ['src/renderer/src/lib/windowContext.ts', 5],
  ['src/renderer/src/pages/WelcomePage.vue', 1]
])

const RENDERER_IPC_LISTENER_BASELINE = new Map([
  ['src/renderer/src/components/chat-input/composables/useChatMode.ts', 1],
  ['src/renderer/src/components/chat-input/composables/useRateLimitStatus.ts', 3],
  ['src/renderer/src/components/chat-input/composables/useSkillsData.ts', 2],
  ['src/renderer/src/components/chat-input/McpIndicator.vue', 2],
  ['src/renderer/src/components/chat/composables/useChatInputMentions.ts', 1],
  ['src/renderer/src/components/message/SelectedTextContextMenu.vue', 2],
  ['src/renderer/src/components/sidepanel/BrowserPanel.vue', 6],
  ['src/renderer/src/components/sidepanel/ChatSidePanel.vue', 1],
  ['src/renderer/src/components/sidepanel/composables/useWorkspaceSync.ts', 1],
  ['src/renderer/src/stores/dialog.ts', 1],
  ['src/renderer/src/stores/floatingButton.ts', 1],
  ['src/renderer/src/stores/language.ts', 1],
  ['src/renderer/src/stores/mcp.ts', 6],
  ['src/renderer/src/stores/mcpSampling.ts', 3],
  ['src/renderer/src/stores/modelStore.ts', 2],
  ['src/renderer/src/stores/ollamaStore.ts', 1],
  ['src/renderer/src/stores/providerStore.ts', 5],
  ['src/renderer/src/stores/sync.ts', 7],
  ['src/renderer/src/stores/theme.ts', 2],
  ['src/renderer/src/stores/ui/agent.ts', 2],
  ['src/renderer/src/stores/ui/pendingInput.ts', 1],
  ['src/renderer/src/stores/ui/project.ts', 1],
  ['src/renderer/src/stores/uiSettingsStore.ts', 8],
  ['src/renderer/src/stores/upgrade.ts', 4]
])

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

const MIGRATED_RAW_CHANNEL_BASELINE = new Map([
  ['src/main/presenter/windowPresenter/index.ts', 4],
  ['src/renderer/src/App.vue', 1]
])

const HOT_PATH_FILES = [
  path.join(ROOT, 'src/main/presenter/index.ts'),
  path.join(ROOT, 'src/main/eventbus.ts'),
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/llmProviderPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter/index.ts')
]

const HOT_PATH_EDGE_BASELINE = 11

const USE_PRESENTER_CALL_PATTERN = /\busePresenter\s*\(/g
const WINDOW_ELECTRON_PATTERN = /window\.electron\b/g
const WINDOW_API_PATTERN = /window\.api\b/g
const IPC_RENDERER_LISTENER_PATTERN =
  /window\.electron(?:\?\.|\.)ipcRenderer(?:\?\.|\.)(?:on|once|addListener)\s*\(/g
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

function isRendererQuarantineFile(filePath) {
  return RENDERER_QUARANTINE_ROOTS.some((quarantineRoot) => isUnder(filePath, quarantineRoot))
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

async function resolveImport(specifier, importer) {
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
    return await tryFile(path.join(MAIN_SOURCE_ROOT, specifier.slice(2)))
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

function validateRendererLegacyAccess({
  actualCount,
  baselineMap,
  filePath,
  violations,
  code
}) {
  if (actualCount === 0) {
    return
  }

  const file = relativePath(filePath)
  const baselineCount = baselineMap.get(file)

  if (baselineCount === undefined) {
    violations.push(
      `[${code}] ${file} must move behind a typed client/runtime wrapper or be added to the quarantine whitelist`
    )
    return
  }

  if (actualCount > baselineCount) {
    violations.push(`[${code}-growth] ${file} expected <= ${baselineCount}, found ${actualCount}`)
  }
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

  for (const filePath of [...fileSet].sort()) {
    const source = await fs.readFile(filePath, 'utf8')
    const specifiers = extractModuleSpecifiers(source)

    if (isUnder(filePath, RENDERER_SOURCE_ROOT)) {
      const file = relativePath(filePath)
      const usePresenterCount = countMatches(source, USE_PRESENTER_CALL_PATTERN)
      const windowElectronCount = countMatches(source, WINDOW_ELECTRON_PATTERN)
      const windowApiCount = countMatches(source, WINDOW_API_PATTERN)

      validateRendererLegacyAccess({
        actualCount: usePresenterCount,
        baselineMap: RENDERER_USE_PRESENTER_BASELINE,
        filePath,
        violations,
        code: 'renderer-business-direct-use-presenter'
      })
      validateRendererLegacyAccess({
        actualCount: windowElectronCount,
        baselineMap: RENDERER_WINDOW_ELECTRON_BASELINE,
        filePath,
        violations,
        code: 'renderer-business-direct-window-electron'
      })
      validateRendererLegacyAccess({
        actualCount: windowApiCount,
        baselineMap: RENDERER_WINDOW_API_BASELINE,
        filePath,
        violations,
        code: 'renderer-business-direct-window-api'
      })

      const actualListenerCount = countMatches(source, IPC_RENDERER_LISTENER_PATTERN)
      const baselineListenerCount = RENDERER_IPC_LISTENER_BASELINE.get(file) ?? 0

      if (actualListenerCount > baselineListenerCount) {
        violations.push(
          `[renderer-ipc-listener-growth] ${file} expected <= ${baselineListenerCount}, found ${actualListenerCount}`
        )
      }
    }

    if (isUnder(filePath, RENDERER_TYPED_BOUNDARY_ROOT) && !isRendererQuarantineFile(filePath)) {
      const file = relativePath(filePath)
      const usePresenterCount = countMatches(source, USE_PRESENTER_CALL_PATTERN)
      const windowElectronCount = countMatches(source, WINDOW_ELECTRON_PATTERN)
      const windowApiCount = countMatches(source, WINDOW_API_PATTERN)

      if (usePresenterCount > 0) {
        violations.push(`[renderer-typed-boundary-direct-use-presenter] ${file}`)
      }

      if (windowElectronCount > 0) {
        violations.push(`[renderer-typed-boundary-direct-window-electron] ${file}`)
      }

      if (windowApiCount > 0) {
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
