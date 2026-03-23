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

const LEGACY_MAIN_DIRS = [
  path.join(ROOT, 'src/main/presenter/agentPresenter'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter')
]

const PRIMARY_MAIN_GUARD_PATHS = [
  path.join(ROOT, 'src/main/presenter/newAgentPresenter'),
  path.join(ROOT, 'src/main/presenter/deepchatAgentPresenter'),
  path.join(ROOT, 'src/main/presenter/skillPresenter'),
  path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts'),
  path.join(ROOT, 'src/main/presenter/syncPresenter/index.ts')
]

const RENDERER_CHAT_GUARD_PATHS = [
  path.join(ROOT, 'src/renderer/src/pages/ChatPage.vue'),
  path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
  path.join(ROOT, 'src/renderer/src/stores/ui'),
  path.join(ROOT, 'src/renderer/src/components/chat'),
  path.join(ROOT, 'src/renderer/src/components/message'),
  path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'),
  path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')
]

const LEGACY_AGENT_RUNTIME_DIR = path.join(ROOT, 'src/main/presenter/agentPresenter')
const PROVIDER_LAYER_DIR = path.join(ROOT, 'src/main/presenter/llmProviderPresenter/providers')
const SKILL_PRESENTER_DIR = path.join(ROOT, 'src/main/presenter/skillPresenter')
const MCP_TOOL_MANAGER_FILE = path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts')

const LEGACY_AGENT_RUNTIME_GLOBALS = [
  'sessionManager',
  'toolPresenter',
  'mcpPresenter',
  'configPresenter',
  'skillPresenter',
  'filePermissionService',
  'settingsPermissionService',
  'newAgentPresenter',
  'sessionPresenter',
  'yoBrowserPresenter',
  'filePresenter',
  'llmproviderPresenter',
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
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1])
    }
  }

  return specifiers
}

async function collectFiles(entryPath) {
  try {
    await fs.access(entryPath)
  } catch {
    return []
  }

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

function buildViolation(kind, filePath, specifier) {
  return {
    kind,
    file: relativePath(filePath),
    specifier
  }
}

async function findViolations() {
  const scanRoots = [
    path.join(ROOT, 'src/main/presenter/newAgentPresenter'),
    path.join(ROOT, 'src/main/presenter/deepchatAgentPresenter'),
    path.join(ROOT, 'src/main/presenter/skillPresenter'),
    path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts'),
    path.join(ROOT, 'src/main/presenter/syncPresenter/index.ts'),
    path.join(ROOT, 'src/main/presenter/llmProviderPresenter/providers'),
    path.join(ROOT, 'src/renderer/src/pages/ChatPage.vue'),
    path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
    path.join(ROOT, 'src/renderer/src/stores/ui'),
    path.join(ROOT, 'src/renderer/src/components/chat'),
    path.join(ROOT, 'src/renderer/src/components/message'),
    path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'),
    path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')
  ]

  const fileSet = new Set()
  for (const entry of scanRoots) {
    for (const file of await collectFiles(entry)) {
      fileSet.add(file)
    }
  }

  const violations = []
  for (const filePath of [...fileSet].sort()) {
    const source = await fs.readFile(filePath, 'utf8')

    for (const specifier of extractModuleSpecifiers(source)) {
      if (isLegacyMainImport(filePath, specifier)) {
        violations.push(buildViolation('legacy-main-import', filePath, specifier))
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

    if (isProtectedPath(filePath, [SKILL_PRESENTER_DIR]) && /\bpresenter\./.test(source)) {
      violations.push(buildViolation('skill-global-presenter', filePath, 'presenter.*'))
    }

    if (
      isProtectedPath(filePath, [SKILL_PRESENTER_DIR]) &&
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
      console.error(`- [${violation.kind}] ${violation.file} -> ${violation.specifier}`)
    }
    process.exit(1)
  }

  console.log('Agent cleanup guard passed. Baseline violations tracked: 0.')
}

main().catch((error) => {
  console.error('Agent cleanup guard failed to run:', error)
  process.exit(1)
})
