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

const MAIN_PROTECTED_DIRS = [
  path.join(ROOT, 'src/main/presenter/newAgentPresenter'),
  path.join(ROOT, 'src/main/presenter/deepchatAgentPresenter')
]

const MAIN_COMPAT_PROTECTED_DIRS = [
  path.join(ROOT, 'src/main/presenter/skillPresenter'),
  path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts')
]

const RENDERER_PROTECTED_DIRS = [
  path.join(ROOT, 'src/renderer/src/pages/ChatPage.vue'),
  path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'),
  path.join(ROOT, 'src/renderer/src/stores/ui'),
  path.join(ROOT, 'src/renderer/src/components/chat'),
  path.join(ROOT, 'src/renderer/src/components/message'),
  path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'),
  path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')
]

const ALLOWED_BASELINE = new Set(['src/main/presenter/mcpPresenter/toolManager.ts|global-chat-mode'])

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

function classifyViolation(filePath, specifier) {
  if (isProtectedPath(filePath, [...MAIN_PROTECTED_DIRS, ...MAIN_COMPAT_PROTECTED_DIRS])) {
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filePath), specifier)
      if (LEGACY_MAIN_DIRS.some((legacyDir) => isUnder(resolved, legacyDir))) {
        return 'legacy-main'
      }
    }

    if (
      specifier === '@/presenter/agentPresenter' ||
      specifier.startsWith('@/presenter/agentPresenter/') ||
      specifier === '@/presenter/sessionPresenter' ||
      specifier.startsWith('@/presenter/sessionPresenter/')
    ) {
      return 'legacy-main'
    }
  }

  if (
    isProtectedPath(filePath, RENDERER_PROTECTED_DIRS) &&
    (specifier === '@shared/chat' || specifier.startsWith('@shared/chat/'))
  ) {
    return 'legacy-chat'
  }

  return null
}

async function findViolations() {
  const files = [
    ...(await collectFiles(path.join(ROOT, 'src/main/presenter/newAgentPresenter'))),
    ...(await collectFiles(path.join(ROOT, 'src/main/presenter/deepchatAgentPresenter'))),
    ...(await collectFiles(path.join(ROOT, 'src/main/presenter/skillPresenter'))),
    ...(await collectFiles(path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/pages/ChatPage.vue'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/pages/NewThreadPage.vue'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/stores/ui'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/components/chat'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/components/message'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/composables/useArtifacts.ts'))),
    ...(await collectFiles(path.join(ROOT, 'src/renderer/src/components/sidepanel/WorkspacePanel.vue')))
  ]

  const violations = []
  for (const filePath of files) {
    const file = relativePath(filePath)
    const source = await fs.readFile(filePath, 'utf8')
    for (const specifier of extractModuleSpecifiers(source)) {
      const kind = classifyViolation(filePath, specifier)
      if (!kind) {
        continue
      }

      violations.push({
        kind,
        file,
        specifier,
        key: `${file}|${specifier}`
      })
    }

    if (
      isProtectedPath(filePath, [path.join(ROOT, 'src/main/presenter/mcpPresenter/toolManager.ts')]) &&
      source.includes('input_chatMode')
    ) {
      violations.push({
        kind: 'global-chat-mode',
        file,
        specifier: 'input_chatMode',
        key: `${file}|global-chat-mode`
      })
    }
  }

  violations.sort((left, right) => left.key.localeCompare(right.key))
  return violations
}

function printViolationList(title, violations) {
  if (violations.length === 0) {
    return
  }

  console.error(title)
  for (const violation of violations) {
    console.error(`- [${violation.kind}] ${violation.file} -> ${violation.specifier}`)
  }
}

async function main() {
  const violations = await findViolations()
  const unexpected = violations.filter((violation) => !ALLOWED_BASELINE.has(violation.key))
  const removedFromBaseline = [...ALLOWED_BASELINE]
    .filter((key) => !violations.some((violation) => violation.key === key))
    .sort()

  if (unexpected.length > 0) {
    console.error('Agent cleanup guard failed. New legacy coupling was introduced.')
    printViolationList('Unexpected violations:', unexpected)
    process.exit(1)
  }

  if (removedFromBaseline.length > 0) {
    console.log('Agent cleanup guard note: some baseline violations were removed.')
    for (const key of removedFromBaseline) {
      console.log(`- ${key}`)
    }
    console.log('You can shrink the allowlist in scripts/agent-cleanup-guard.mjs in a follow-up.')
  }

  console.log(`Agent cleanup guard passed. Baseline violations tracked: ${violations.length}.`)
}

main().catch((error) => {
  console.error('Agent cleanup guard failed to run:', error)
  process.exit(1)
})
