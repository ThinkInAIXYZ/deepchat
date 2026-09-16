import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

// Type gate for the Stage 2B kernel port structure test. `pnpm typecheck` compiles `src/**` only, so
// the structural `expectTypeOf` assertions — "the host classes satisfy the kernel's named ports" —
// would be erased by the test run and compiled by nothing. `typecheck:node` already compiles the
// full `src/main` closure this test imports, so this gate compiles the test file and keeps only the
// diagnostics that belong to it.

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDirectory, '..')

const scopedTestFiles = ['test/main/agent/deepchat/contracts/kernelPortStructure.test.ts']
const rootNames = scopedTestFiles.map((path) => join(rootDir, path))
const scopedRoots = rootNames.map((path) => path)

const missingRootFiles = rootNames.filter((rootName) => ts.sys.readFile(rootName) === undefined)
if (missingRootFiles.length > 0) {
  console.error(
    [
      'Kernel port structure type gate failed: scoped root file(s) are missing.',
      ...missingRootFiles.map((rootName) => `- ${relative(rootDir, rootName)}`),
      'Restore the file(s), or update scopedTestFiles in',
      'scripts/typecheck-kernel-port-structure.mjs so the gate matches the current layout.'
    ].join('\n')
  )
  process.exit(1)
}

const configPath = join(rootDir, 'tsconfig.node.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], createFormatHost()))
  process.exit(1)
}

const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir, {
  composite: false,
  incremental: false,
  noEmit: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  skipLibCheck: true,
  types: ['electron-vite/node', 'vitest/globals']
})

const program = ts.createProgram({ rootNames, options: parsed.options })
const diagnostics = [
  ...parsed.errors,
  ...ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || isScopedFile(diagnostic.file.fileName))
]

if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, createFormatHost()))
  process.exit(1)
}

console.log(
  `Kernel port structure type gate passed (${scopedTestFiles.length} test file, ` +
    `${program.getSourceFiles().length} compiled sources in closure).`
)

function isScopedFile(fileName) {
  const scopedFileName = resolve(fileName)
  return scopedRoots.some((root) => scopedFileName === root)
}

function createFormatHost() {
  return {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => ts.sys.newLine
  }
}
