import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// Build the @deepchat/agent-kernel workspace package with plain per-file tsc emit (JS + .d.ts),
// then assert the emitted closure is alias-free and free of Desktop-only imports. The repo
// `typescript` is the tsgo native bridge; bundlers like dts-bundle-generator are incompatible
// with it, so declarations are emitted per file and consumers walk the relative closure.

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDirectory, '..')
const packageDir = join(rootDir, 'packages', 'agent-kernel')

const FORBIDDEN_SPECIFIER_PATTERNS = [
  { pattern: /^(@\/|@shared\/)/, label: 'path alias' },
  { pattern: /(^|\/)electron(\/|$)/, label: 'electron' },
  { pattern: /better-sqlite3/, label: 'better-sqlite3' },
  { pattern: /node-pty/, label: 'node-pty' },
  { pattern: /(^|\/)src\/main(\/|$)/, label: 'src/main' }
]

function listFilesRecursively(directory, extension) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) {
      files.push(...listFilesRecursively(entryPath, extension))
    } else if (entryPath.endsWith(extension)) {
      files.push(entryPath)
    }
  }
  return files
}

function extractSpecifiers(text) {
  const specifiers = []
  const patterns = [
    /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) specifiers.push(match[1])
  }
  return specifiers
}

function main() {
  rmSync(join(packageDir, 'dist'), { recursive: true, force: true })
  // The repo `typescript` (tsgo native bridge) is hoisted at the root; resolve it explicitly so
  // the build does not depend on the caller's PATH or a package-local install.
  const tscBinary = process.platform === 'win32'
    ? join(rootDir, 'node_modules', '.bin', 'tsc.cmd')
    : join(rootDir, 'node_modules', '.bin', 'tsc')
  execSync(`"${tscBinary}" -p tsconfig.json`, { cwd: packageDir, stdio: 'inherit' })

  const distDir = join(packageDir, 'dist')
  const emitted = [...listFilesRecursively(distDir, '.js'), ...listFilesRecursively(distDir, '.d.ts')]
  if (emitted.length === 0) {
    console.error(`agent-kernel build: no output found under ${relative(rootDir, distDir)}`)
    process.exit(1)
  }

  const violations = []
  for (const file of emitted) {
    const text = readFileSync(file, 'utf8')
    for (const specifier of extractSpecifiers(text)) {
      for (const { pattern, label } of FORBIDDEN_SPECIFIER_PATTERNS) {
        if (pattern.test(specifier)) {
          violations.push(`${relative(rootDir, file)}: ${label} specifier '${specifier}'`)
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('agent-kernel build: forbidden specifiers in emitted output.')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log(
    `agent-kernel build: ${emitted.length} emitted files clean ` +
      `(${listFilesRecursively(distDir, '.js').length} js, ` +
      `${listFilesRecursively(distDir, '.d.ts').length} d.ts).`
  )
}

main()
