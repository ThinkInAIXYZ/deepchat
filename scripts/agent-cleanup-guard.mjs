import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const MAIN = path.join(ROOT, 'src/main')
const RETIRED = [
  path.join(MAIN, 'agent/deepchat'),
  path.join(MAIN, 'tool/codeMode'),
  path.join(MAIN, 'presenter/agentPresenter'),
  path.join(MAIN, 'presenter/sessionPresenter')
]
const ACP = path.join(MAIN, 'agent/acp')
const DIM = path.join(MAIN, 'agent/dim')
const SKILLS = path.join(MAIN, 'skill')
const MCP = path.join(MAIN, 'mcp/toolManager.ts')
const PROTECTED_MAIN = ['agent', 'skill', 'mcp/toolManager.ts', 'sync/index.ts'].map((p) =>
  path.join(MAIN, p)
)
const RENDERER_CHAT = [
  'features/chat-page/ChatPage.vue',
  'pages/NewThreadPage.vue',
  'stores/ui',
  'components/chat',
  'components/message',
  'composables/useArtifacts.ts',
  'components/sidepanel/WorkspacePanel.vue'
].map((p) => path.join(ROOT, 'src/renderer/src', p))
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue'])
const RETIRED_EXECUTORS =
  '(?:DeepChatAgentHarness|DeepChatAgentInstance|DeepChatAgentRuntime|DeepChatLoopEngine|DeepChatLoopRunner|LoopRun|AgentFileSystemHandler|AgentBashHandler|AgentFffSearchHandler|RunCodeRuntimeManager)'
const under = (file, directory) => file === directory || file.startsWith(`${directory}${path.sep}`)
const within = (file, roots) => roots.some((root) => under(file, root))
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')

function specifiers(source) {
  const result = new Set()
  for (const pattern of [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ])
    for (const match of source.matchAll(pattern)) result.add(match[1])
  return [...result]
}
function resolve(file, specifier) {
  if (specifier.startsWith('@/')) return path.join(MAIN, specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(file), specifier)
  return null
}

/** Native execution and direct ACP are separate owners; neither may reintroduce the retired loop. */
export function findAgentBoundaryViolations(source, filePath) {
  const file = path.resolve(filePath)
  const result = []
  const add = (kind, detail) => result.push({ kind, detail })
  if (within(file, RETIRED)) add('retired-runtime-source', relative(file))
  if (
    new RegExp(`\\b(?:class|new)\\s+${RETIRED_EXECUTORS}\\b`).test(source) ||
    /\bcreateDeepChatAgentHarness\s*\(/.test(source)
  )
    add('retired-executor', 'Use the dim owner or the direct ACP client')
  for (const specifier of specifiers(source)) {
    const target = resolve(file, specifier)
    if (target && within(target, RETIRED)) add('retired-runtime-import', specifier)
    if (target && under(file, ACP) && under(target, DIM)) add('acp-imports-dim', specifier)
    if (target && under(file, DIM) && under(target, ACP)) add('dim-imports-acp', specifier)
    if (
      within(file, RENDERER_CHAT) &&
      (specifier === '@shared/chat' || specifier.startsWith('@shared/chat/'))
    )
      add('legacy-chat-import', specifier)
  }
  if (file === MCP && source.includes('input_chatMode')) add('global-chat-mode', 'input_chatMode')
  if (within(file, PROTECTED_MAIN) && source.includes('presenter.sessionPresenter.'))
    add('legacy-session-access', 'presenter.sessionPresenter')
  if (under(file, SKILLS) && /\bpresenter\./.test(source))
    add('skill-global-presenter', 'presenter.*')
  if (under(file, SKILLS) && /getLegacyConversation|updateLegacyConversationSettings/.test(source))
    add('skill-legacy-fallback', 'legacy conversation skills')
  return result
}

export function findNativeCompositionViolations(source) {
  const requirements = [
    ['native-agent-factory', /\bcreateDimAgent\s*\(/],
    ['native-host-owner', /\bnew\s+DimRuntimeSupervisor\s*\(/],
    ['native-host-required', /\bnativePlugins\s*:\s*true\b/],
    ['native-text-models', /\.setNativeModels\s*\(/],
    ['native-media-models', /\.setNativeMedia\s*\(/],
    ['native-embeddings', /\.setNativeEmbedding\s*\(/]
  ]
  return requirements
    .filter(([, pattern]) => !pattern.test(source))
    .map(([kind]) => ({ kind, detail: 'Missing native owner wiring' }))
}
async function collect(directory) {
  const stat = await fs.stat(directory)
  if (stat.isFile()) return EXTENSIONS.has(path.extname(directory)) ? [directory] : []
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => !['node_modules', 'dist', 'out'].includes(entry.name))
      .map((entry) => collect(path.join(directory, entry.name)))
  )
  return files.flat()
}
export async function verifyAgentBoundaries() {
  const roots = [MAIN, ...RENDERER_CHAT]
  const files = new Set((await Promise.all(roots.map(collect))).flat())
  const violations = []
  for (const file of [...files].sort()) {
    const source = await fs.readFile(file, 'utf8')
    for (const violation of findAgentBoundaryViolations(source, file))
      violations.push({ file: relative(file), ...violation })
    if (file === path.join(MAIN, 'app/composition.ts'))
      for (const violation of findNativeCompositionViolations(source))
        violations.push({ file: relative(file), ...violation })
  }
  return violations
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const violations = await verifyAgentBoundaries()
  if (violations.length) {
    for (const violation of violations)
      console.error(`${violation.kind}: ${violation.file}: ${violation.detail}`)
    process.exitCode = 1
  } else
    console.log(
      'Agent cleanup guard passed. Retired executors: 0; native and ACP owners remain separate.'
    )
}
