import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

// Type gate for the Stage 1 client-facing contract test. `pnpm typecheck` compiles `src/**` only, so
// the contract test's `expectTypeOf` assertions — "this operation takes exactly this DTO and no
// AbortSignal" — were erased by the test run and compiled by nothing. This gate compiles them, which
// is why the scope is deliberately two paths: widening it would make the gate slow enough to stop
// being run.

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDirectory, '..')

const scopedTestFiles = ['test/main/contracts/agentServiceClientContract.test.ts']
const scopedSourceDirectories = ['src/shared/contracts/agent-service']

const scopedSourceFiles = scopedSourceDirectories.flatMap((directory) =>
  readdirSync(join(rootDir, directory))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(rootDir, directory, entry))
)
const rootNames = [...scopedTestFiles.map((path) => join(rootDir, path)), ...scopedSourceFiles]

const scopedRoots = [
  ...scopedTestFiles.map((path) => join(rootDir, path)),
  ...scopedSourceDirectories.map((directory) => join(rootDir, directory) + sep)
]

// Readability is checked by reading: `fileExists` is true for a `chmod 000` root, which TypeScript
// then cannot read. An unreadable root silently shrinks the program, so it is named here with a
// missing/unreadable distinction the diagnostic filter cannot express.
const unreadableRoots = rootNames
  .filter((rootName) => ts.sys.readFile(rootName) === undefined)
  .map((rootName) => ({ exists: ts.sys.fileExists(rootName), path: relative(rootDir, rootName) }))

if (unreadableRoots.length > 0) {
  const report = []
  const missingRootFiles = unreadableRoots.filter((root) => !root.exists)
  const unreadableRootFiles = unreadableRoots.filter((root) => root.exists)

  if (missingRootFiles.length > 0) {
    report.push(
      'Agent service contract type gate failed: scoped root file(s) are missing.',
      ...missingRootFiles.map((root) => `- ${root.path}`),
      'Restore the file(s), or update scopedTestFiles/scopedSourceDirectories in',
      'scripts/typecheck-agent-service-contracts.mjs so the gate matches the current layout.'
    )
  }

  if (unreadableRootFiles.length > 0) {
    report.push(
      'Agent service contract type gate failed: scoped root file(s) cannot be read.',
      ...unreadableRootFiles.map((root) => `- ${root.path}`),
      'Make the file(s) readable, then re-run this gate.'
    )
  }

  console.error(report.join('\n'))
  process.exit(1)
}

const configPath = join(rootDir, 'tsconfig.node.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], createFormatHost()))
  process.exitCode = 1
} else {
  // `tsconfig.node.json` is the base config, so this gate resolves the same `@shared/*` alias the
  // sources do. The relaxed settings match the memory test gate: fixtures legitimately carry unused
  // bindings, and `composite`/`incremental` are irrelevant to a one-shot check.
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir, {
    composite: false,
    incremental: false,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    types: ['node', 'electron-vite/node', 'vitest/globals']
  })
  const program = ts.createProgram({ rootNames, options: parsed.options })
  // Config-level and file-less program diagnostics are kept as well: dropping them is the same root
  // cause as an unreadable root, one level up — a smaller program reporting a pass.
  const diagnostics = [
    ...parsed.errors,
    ...ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => !diagnostic.file || isScopedFile(diagnostic.file.fileName))
  ]

  if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, createFormatHost()))
    process.exitCode = 1
  } else {
    console.log(
      `Agent service contract type gate passed (${rootNames.length} files: ` +
        `${scopedTestFiles.length} contract test, ${scopedSourceFiles.length} contract sources).`
    )
  }
}

function isScopedFile(fileName) {
  const scopedFileName = resolve(fileName)
  return scopedRoots.some((root) => scopedFileName === root || scopedFileName.startsWith(root))
}

function createFormatHost() {
  return {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => ts.sys.newLine
  }
}
