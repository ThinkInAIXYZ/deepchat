import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDirectory, '..')
const manifest = JSON.parse(readFileSync(join(rootDir, 'test/memory-test-scope.json'), 'utf8'))
const configPath = join(rootDir, 'tsconfig.node.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], createFormatHost()))
  process.exitCode = 1
} else {
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir, {
    composite: false,
    incremental: false,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: false,
    types: ['electron-vite/node', 'vitest/globals']
  })
  parsed.options.paths = {
    ...parsed.options.paths,
    '@/presenter/memoryPresenter': [
      join(rootDir, 'test/main/presenter/fakes/memoryPresenterTestAdapter.ts')
    ]
  }
  const scopedTests = ['behavior', 'native', 'eval', 'perf'].flatMap(
    (category) => manifest[category] ?? []
  )
  const rootNames = [
    ...scopedTests.map((path) => join(rootDir, path)),
    join(rootDir, 'test/main/presenter/fakes/memoryFakes.ts'),
    join(rootDir, 'test/main/presenter/fakes/memoryPresenterTestAdapter.ts')
  ]
  const rootNameSet = new Set(rootNames.map((path) => resolve(path)))
  const program = ts.createProgram({ rootNames: [...new Set(rootNames)], options: parsed.options })
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || rootNameSet.has(resolve(diagnostic.file.fileName)))

  if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, createFormatHost()))
    process.exitCode = 1
  } else {
    console.log(`Memory test type gate passed (${scopedTests.length} scoped tests).`)
  }
}

function createFormatHost() {
  return {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => ts.sys.newLine
  }
}
