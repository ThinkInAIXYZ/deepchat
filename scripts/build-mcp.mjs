import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDirectory = fileURLToPath(new URL('../packages/mcp/', import.meta.url))
const compiler = createRequire(new URL('../package.json', import.meta.url)).resolve('typescript/bin/tsc')

const list = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const target = `${directory}/${entry}`
    return statSync(target).isDirectory() ? list(target) : [target]
  })

rmSync(new URL('../packages/mcp/dist/', import.meta.url), { recursive: true, force: true })
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
  cwd: packageDirectory,
  stdio: 'inherit'
})

const forbidden = /(?:from\s+['"](?:electron|@\/|@shared\/)|from\s+['"][^'"]*(?:src\/main|better-sqlite3))/
const violations = list(`${packageDirectory}dist`)
  .filter((file) => /\.(?:js|d\.ts)$/.test(file))
  .filter((file) => forbidden.test(readFileSync(file, 'utf8')))

if (violations.length) {
  throw new Error(`@deepchat/mcp emitted forbidden host imports:\n${violations.join('\n')}`)
}

console.log(`@deepchat/mcp build: ${list(`${packageDirectory}dist`).length} emitted files clean.`)
