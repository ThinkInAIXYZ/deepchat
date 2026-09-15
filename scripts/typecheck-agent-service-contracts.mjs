import { readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

// Type gate for the Stage 1 client-facing contract test.
//
// The repository's `typecheck` scripts compile `src/**` only, so a contract test's `expectTypeOf`
// assertions — the ones that state "this operation takes exactly this DTO and no `AbortSignal`", or
// "this public type has no forbidden host type in it" — are erased by the test run and were never
// compiled by anything. This gate compiles them, so those assertions are enforced by a command instead
// of being documentation.
//
// The scope is deliberately two paths, not all of `test/**`: the client contract test and the
// agent-service contract sources it consumes. A mutation inside that surface fails here; a failure
// anywhere else is some other gate's business, and widening this one would make it slow enough that it
// stops being run.

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

const configPath = join(rootDir, 'tsconfig.node.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], createFormatHost()))
  process.exitCode = 1
} else {
  // The base config is `tsconfig.node.json`, so this gate resolves the same `@shared/*` and `@/*`
  // aliases the sources do. Two settings are relaxed the way the memory test gate relaxes them: test
  // fixtures legitimately carry unused bindings, and `composite`/`incremental` are irrelevant to a
  // one-shot check.
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir, {
    composite: false,
    incremental: false,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    types: ['electron-vite/node', 'vitest/globals']
  })
  const program = ts.createProgram({ rootNames, options: parsed.options })
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => {
      if (!diagnostic.file) return false
      const fileName = resolve(diagnostic.file.fileName)
      return scopedRoots.some((root) => fileName === root || fileName.startsWith(root))
    })

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

function createFormatHost() {
  return {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => ts.sys.newLine
  }
}
