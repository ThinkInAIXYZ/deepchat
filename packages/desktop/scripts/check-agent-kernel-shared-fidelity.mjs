import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Guards the @shared value-module copies inside packages/agent-kernel/src/shared against silent
// drift from their host originals in src/shared. In-repo tests cannot catch this drift because
// the vitest kernelSharedBridgePlugin rewrites the kernel's shared imports back to the host
// alias, so this check is the only development-time signal.
//
// Comparison is specifier-normalized and whitespace-insensitive:
// - Kernel copies reference the shared tree with relative specifiers (NodeNext emit forbids
//   aliases); host originals use the '@shared/…' alias. Both are canonicalized to shared://…
//   logical paths with extensions stripped.
// - Formatting rewraps after specifier rewrites, so whitespace differences are ignored and the
//   token streams are compared instead.
//
// Explicitly exempt (documented, reviewed in the Stage 2B-3a acceptance):
// - shared/chat.ts: deliberately trimmed copy; the host barrel's .d.ts hides undeclared names
//   behind skipLibCheck that a checked .ts cannot compile with.
// - shared/types/tool.ts and shared/types/agent-interface.ts: faithful .ts conversions of host
//   .d.ts declarations; type drift is caught by typecheck:node and the kernel-ports gate, which
//   compile the package sources directly.

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDirectory, '..')
const workspaceRoot = resolve(rootDir, '../..')
const packageSharedDir = join(workspaceRoot, 'packages', 'agent-kernel', 'src', 'shared')
const hostSharedDir = join(rootDir, 'src', 'shared')

const EXEMPT_FILES = new Map([
  ['chat.ts', 'deliberately trimmed copy (host barrel .d.ts cannot compile as checked .ts)'],
  [
    'types/tool.ts',
    'faithful .ts conversion of host .d.ts declarations (type drift caught by typecheck gates)'
  ],
  [
    'types/agent-interface.ts',
    'faithful .ts conversion of host .d.ts declarations (type drift caught by typecheck gates)'
  ]
])

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function normalizeSpecifiers(source, baseDirectory, sharedRoot) {
  return source.replace(
    /((?:from\s*|import\s*\(\s*|require\s*\(\s*|export\s+\*\s+from\s*|import\s*)?)'([^']+)'/g,
    (whole, prefix, specifier) => {
      let logical = null
      if (specifier.startsWith('@shared/')) {
        logical = specifier.slice('@shared/'.length)
      } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolved = resolve(baseDirectory, specifier)
        if (resolved.startsWith(sharedRoot + '/') || resolved === sharedRoot) {
          logical = relative(sharedRoot, resolved)
        }
      }
      if (logical === null) return whole
      const withoutExtension = logical.replace(/\.(js|ts|mts|cts)$/, '')
      return `${prefix}'shared://${withoutExtension}'`
    }
  )
}

function stripWhitespace(source) {
  return source.replace(/\s+/g, '')
}

export function checkSharedCopyFidelity() {
  const packageFiles = listFiles(packageSharedDir)
  const mismatches = []
  const exempted = []
  let compared = 0

  for (const packageFile of packageFiles) {
    const relPath = relative(packageSharedDir, packageFile)
    if (EXEMPT_FILES.has(relPath)) {
      exempted.push({ file: relPath, reason: EXEMPT_FILES.get(relPath) })
      continue
    }

    const hostFile = join(hostSharedDir, relPath)
    let hostSource
    try {
      hostSource = readFileSync(hostFile, 'utf8')
    } catch {
      mismatches.push({
        file: relPath,
        reason: 'no host original at src/shared (unexpected orphan copy)'
      })
      continue
    }

    const packageSource = readFileSync(packageFile, 'utf8')
    const normalizedHost = stripWhitespace(
      normalizeSpecifiers(hostSource, dirname(hostFile), hostSharedDir)
    )
    const normalizedPackage = stripWhitespace(
      normalizeSpecifiers(packageSource, dirname(packageFile), packageSharedDir)
    )
    compared += 1
    if (normalizedHost !== normalizedPackage) {
      mismatches.push({
        file: relPath,
        reason:
          'kernel shared copy drifted from src/shared original (specifier-normalized token compare)'
      })
    }
  }

  const hostOnlyFiles = []
  for (const hostFile of listFiles(hostSharedDir)) {
    const relPath = relative(hostSharedDir, hostFile)
    if (relPath.endsWith('.d.ts')) continue
    const packageFile = join(packageSharedDir, relPath)
    try {
      statSync(packageFile)
    } catch {
      // Host-only files are fine: the kernel copies only what it needs. Recorded for visibility.
      hostOnlyFiles.push(relPath)
    }
  }

  return { compared, mismatches, exempted, hostOnlyCount: hostOnlyFiles.length }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isDirectRun) {
  const result = checkSharedCopyFidelity()
  for (const exemption of result.exempted) {
    console.log(`exempt: ${exemption.file} — ${exemption.reason}`)
  }
  if (result.mismatches.length > 0) {
    for (const mismatch of result.mismatches) {
      console.error(`mismatch: ${mismatch.file} — ${mismatch.reason}`)
    }
    console.error(
      `agent-kernel shared fidelity check FAILED: ${result.mismatches.length} mismatch(es) across ${result.compared} compared files`
    )
    process.exit(1)
  }
  console.log(
    `agent-kernel shared fidelity check passed: ${result.compared} copies faithful, ${result.exempted.length} exempt, ${result.hostOnlyCount} host-only files uncopied`
  )
}
