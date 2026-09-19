import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedSourceAliases } from './shared-source-aliases.mjs'

const packageName = process.argv[2]
if (!['provider', 'mcp'].includes(packageName) || process.argv.length !== 3) {
  throw new Error('Usage: typecheck-package-source.mjs <provider|mcp>')
}

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDirectory = fileURLToPath(new URL(`../packages/${packageName}/`, import.meta.url))
const cacheDirectory = join(packageDirectory, 'node_modules', '.cache')
const compiler = createRequire(new URL('../package.json', import.meta.url)).resolve('typescript/bin/tsc')
mkdirSync(cacheDirectory, { recursive: true })
const configDirectory = mkdtempSync(join(cacheDirectory, 'source-typecheck-'))
const configPath = join(configDirectory, 'tsconfig.json')
const toConfigPath = (path) => relative(configDirectory, path).replaceAll('\\', '/')

try {
  writeFileSync(
    configPath,
    JSON.stringify({
      extends: toConfigPath(join(packageDirectory, 'tsconfig.json')),
      compilerOptions: {
        noEmit: true,
        incremental: false,
        rootDir: toConfigPath(root),
        paths: Object.fromEntries(
          Object.entries(sharedSourceAliases).map(([specifier, path]) => [specifier, [toConfigPath(path)]])
        )
      }
    })
  )
  execFileSync(process.execPath, [compiler, '-p', configPath], {
    cwd: root,
    stdio: 'inherit'
  })
} finally {
  rmSync(configDirectory, { recursive: true, force: true })
}
