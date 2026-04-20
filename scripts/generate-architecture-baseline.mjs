import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const REPORT_DIR = path.join(ROOT, 'docs/architecture/baselines')
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

const ANALYSIS_TARGETS = [
  {
    label: 'main',
    root: path.join(ROOT, 'src/main')
  },
  {
    label: 'renderer',
    root: path.join(ROOT, 'src/renderer/src')
  }
]

const MAIN_SOURCE_ROOT = path.join(ROOT, 'src/main')
const RENDERER_SOURCE_ROOT = path.join(ROOT, 'src/renderer/src')
const RENDERER_QUARANTINE_ROOTS = [path.join(ROOT, 'src/renderer/api/legacy')]
const BRIDGE_REGISTER_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/main-kernel-bridge-register.json'
)

const HOT_PATH_FILES = [
  path.join(ROOT, 'src/main/presenter/index.ts'),
  path.join(ROOT, 'src/main/eventbus.ts'),
  path.join(ROOT, 'src/main/presenter/agentSessionPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/agentRuntimePresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/llmProviderPresenter/index.ts'),
  path.join(ROOT, 'src/main/presenter/sessionPresenter/index.ts')
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

const USE_PRESENTER_CALL_PATTERN = /\busePresenter\s*\(/g
const WINDOW_ELECTRON_PATTERN = /window\.electron\b/g
const WINDOW_API_PATTERN = /window\.api\b/g
const RAW_TIMER_PATTERN = /\b(?:setTimeout|setInterval)\s*\(/g
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

async function collectArchiveReferences() {
  const scanRoots = [path.join(ROOT, 'docs'), path.join(ROOT, 'src')]
  const references = []

  for (const scanRoot of scanRoots) {
    const files = await walk(scanRoot)
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      const lines = source.split('\n')

      lines.forEach((line, index) => {
        if (!line.includes('archives/code/')) {
          return
        }

        references.push({
          file: toPosix(path.relative(ROOT, file)),
          line: index + 1,
          text: line.trim()
        })
      })
    }
  }

  return references.sort((left, right) =>
    `${left.file}:${left.line}`.localeCompare(`${right.file}:${right.line}`)
  )
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
  const businessFiles = await walk(RENDERER_SOURCE_ROOT)
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

function renderArchiveReferenceReport(references) {
  const lines = [
    '# Archive Reference Baseline',
    '',
    `Generated on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    `- Total references: ${references.length}`,
    ''
  ]

  for (const reference of references) {
    lines.push(`- \`${reference.file}:${reference.line}\` ${reference.text}`)
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
    `| \`hotpath.presenterEdge.count\` | ${metrics['hotpath.presenterEdge.count']} |`,
    `| \`runtime.rawTimer.count\` | ${metrics['runtime.rawTimer.count']} |`,
    `| \`migrated.rawChannel.count\` | ${metrics['migrated.rawChannel.count']} |`,
    `| \`bridge.active.count\` | ${metrics['bridge.active.count']} |`,
    `| \`bridge.expired.count\` | ${metrics['bridge.expired.count']} |`,
    ''
  ]

  lines.push('## Renderer Single-Track Split')
  lines.push('')
  lines.push('- Business layer: `src/renderer/src/**`')
  lines.push('- Quarantine layer: `src/renderer/api/legacy/**`')
  lines.push('')
  lines.push('| Legacy surface | Business layer | Quarantine layer | Total |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(
    `| \`usePresenter()\` | ${rendererLegacySplit.usePresenter.business.total} | ${rendererLegacySplit.usePresenter.quarantine.total} | ${rendererLegacySplit.usePresenter.total.total} |`
  )
  lines.push(
    `| \`window.electron\` | ${rendererLegacySplit.windowElectron.business.total} | ${rendererLegacySplit.windowElectron.quarantine.total} | ${rendererLegacySplit.windowElectron.total.total} |`
  )
  lines.push(
    `| \`window.api\` | ${rendererLegacySplit.windowApi.business.total} | ${rendererLegacySplit.windowApi.quarantine.total} | ${rendererLegacySplit.windowApi.total.total} |`
  )
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

  renderTopCountSection(lines, 'Renderer usePresenter', usePresenterSummary)
  renderTopCountSection(lines, 'Renderer window.electron', windowElectronSummary)
  renderTopCountSection(lines, 'Renderer window.api', windowApiSummary)
  renderTopCountSection(lines, 'Raw Timers', rawTimerSummary)
  renderTopCountSection(lines, 'Migrated Path Raw Channel Literals', migratedRawChannelSummary)

  return lines.join('\n')
}

function renderMigrationScoreboardReport({ currentPhase, metrics }) {
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

async function main() {
  await ensureDir(REPORT_DIR)
  const scopes = []

  for (const target of ANALYSIS_TARGETS) {
    scopes.push(await analyzeScope(target.label, target.root))
  }

  const archiveReferences = await collectArchiveReferences()
  const mainAndRendererFiles = await collectFilesFromTargets([MAIN_SOURCE_ROOT, RENDERER_SOURCE_ROOT])
  const usePresenterCountsByLayer = await collectRendererPatternCountsByLayer(USE_PRESENTER_CALL_PATTERN)
  const windowElectronCountsByLayer = await collectRendererPatternCountsByLayer(WINDOW_ELECTRON_PATTERN)
  const windowApiCountsByLayer = await collectRendererPatternCountsByLayer(WINDOW_API_PATTERN)
  const rawTimerCounts = await collectPatternCounts(mainAndRendererFiles, RAW_TIMER_PATTERN)
  const migratedRawChannelCounts = await collectMigratedRawChannelCounts()
  const hotPathEdges = await collectHotPathDirectEdges()
  const bridgeRegister = await loadBridgeRegister()
  const bridgeSummary = summarizeBridges(bridgeRegister)

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
    'hotpath.presenterEdge.count': hotPathEdges.length,
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

  const scoreboardPayload = {
    program: 'main-kernel-refactor',
    generatedOn: new Date().toISOString().slice(0, 10),
    currentPhase: bridgeRegister.currentPhase,
    metrics,
    hotPathEdges: hotPathEdges.map((edge) => `${edge.source} -> ${edge.target}`),
    migratedRawChannels: Object.fromEntries(migratedRawChannelCounts)
  }

  await Promise.all([
    fs.writeFile(
      path.join(REPORT_DIR, 'dependency-report.md'),
      `${renderDependencyReport(scopes)}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'zero-inbound-candidates.md'),
      `${renderZeroInboundReport(scopes)}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'archive-reference-report.md'),
      `${renderArchiveReferenceReport(archiveReferences)}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'main-kernel-boundary-baseline.md'),
      `${renderBoundaryBaselineReport({
        currentPhase: bridgeRegister.currentPhase,
        metrics,
        rendererLegacySplit,
        usePresenterSummary,
        windowElectronSummary,
        windowApiSummary,
        rawTimerSummary,
        migratedRawChannelSummary,
        hotPathEdges
      })}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'main-kernel-migration-scoreboard.md'),
      `${renderMigrationScoreboardReport({
        currentPhase: bridgeRegister.currentPhase,
        metrics
      })}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'main-kernel-migration-scoreboard.json'),
      `${JSON.stringify(scoreboardPayload, null, 2)}\n`
    ),
    fs.writeFile(
      path.join(REPORT_DIR, 'main-kernel-bridge-register.md'),
      `${renderBridgeRegisterReport(bridgeRegister, bridgeSummary)}\n`
    )
  ])

  console.log('Architecture baseline reports updated in docs/architecture/baselines.')
}

main().catch((error) => {
  console.error('Failed to generate architecture baseline reports:', error)
  process.exit(1)
})
