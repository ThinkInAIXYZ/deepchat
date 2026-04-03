import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const REPORT_DIR = path.join(ROOT, 'docs/architecture/baselines')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.d.ts'])
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build'])

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

function toPosix(value) {
  return value.split(path.sep).join('/')
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function walk(dirPath, output = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

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

function extractSpecifiers(source) {
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

async function main() {
  await ensureDir(REPORT_DIR)
  const scopes = []

  for (const target of ANALYSIS_TARGETS) {
    scopes.push(await analyzeScope(target.label, target.root))
  }

  const archiveReferences = await collectArchiveReferences()

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
    )
  ])

  console.log('Architecture baseline reports updated in docs/architecture/baselines.')
}

main().catch((error) => {
  console.error('Failed to generate architecture baseline reports:', error)
  process.exit(1)
})
