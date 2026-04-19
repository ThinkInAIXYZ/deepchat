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
  ['src/renderer/src/stores/providerStore.ts', 2],
  ['src/renderer/src/stores/shortcutKey.ts', 2],
  ['src/renderer/src/stores/skillsStore.ts', 2],
  ['src/renderer/src/stores/sync.ts', 3],
  ['src/renderer/src/stores/systemPromptStore.ts', 1],
  ['src/renderer/src/stores/theme.ts', 1],
  ['src/renderer/src/stores/ui/agent.ts', 1],
  ['src/renderer/src/stores/ui/message.ts', 1],
  ['src/renderer/src/stores/ui/pageRouter.ts', 1],
  ['src/renderer/src/stores/ui/pendingInput.ts', 1],
  ['src/renderer/src/stores/ui/project.ts', 2],
  ['src/renderer/src/stores/ui/session.ts', 3],
  ['src/renderer/src/stores/ui/spotlight.ts', 2],
  ['src/renderer/src/stores/uiSettingsStore.ts', 1],
  ['src/renderer/src/stores/upgrade.ts', 2]
])

const USE_PRESENTER_CALL_PATTERN = /\busePresenter\s*\(/g

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

function extractModuleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
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

  for (const filePath of [...fileSet].sort()) {
    const source = await fs.readFile(filePath, 'utf8')
    const specifiers = extractModuleSpecifiers(source)

    if (isUnder(filePath, RENDERER_SOURCE_ROOT)) {
      const file = relativePath(filePath)
      const actualCount = countMatches(source, USE_PRESENTER_CALL_PATTERN)
      const baselineCount = RENDERER_USE_PRESENTER_BASELINE.get(file) ?? 0

      if (actualCount > baselineCount) {
        violations.push(
          `[renderer-use-presenter-growth] ${file} expected <= ${baselineCount}, found ${actualCount}`
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
