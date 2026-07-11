import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const DEFAULT_CONFIGS = ['tsconfig.node.json', 'tsconfig.app.tsgo.json']

function isUnder(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function checkConfig(configFile) {
  const configPath = path.resolve(configFile)
  const configDirectory = path.dirname(configPath)
  const sharedRoot = path.join(configDirectory, 'src/shared')
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile)

  if (readResult.error) {
    return { configFile, declarationCount: 0, diagnostics: [readResult.error] }
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    configDirectory,
    {
      composite: false,
      incremental: false,
      noEmit: true,
      skipLibCheck: false
    },
    configPath
  )
  const rootNames = ts.sys
    .readDirectory(sharedRoot, ['.d.ts'], undefined, ['**/*.d.ts'])
    .filter((filePath) => isUnder(filePath, sharedRoot))

  if (rootNames.length === 0) {
    throw new Error(`${configFile}: no declarations found under src/shared`)
  }

  const program = ts.createProgram({ rootNames, options: parsed.options })
  return {
    configFile,
    declarationCount: rootNames.length,
    diagnostics: [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  }
}

const configFiles = process.argv.slice(2)
const results = (configFiles.length > 0 ? configFiles : DEFAULT_CONFIGS).map(checkConfig)
const diagnostics = results.flatMap((result) => result.diagnostics)

for (const result of results) {
  if (result.diagnostics.length === 0) {
    console.log(`${result.configFile}: ${result.declarationCount} shared declarations passed`)
  }
}

if (diagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine
    })
  )
  process.exitCode = 1
}
