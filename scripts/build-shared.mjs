import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL('../packages/shared/', import.meta.url))
const compiler = createRequire(new URL('../package.json', import.meta.url)).resolve('typescript/bin/tsc')
rmSync(new URL('../packages/shared/dist/', import.meta.url), { recursive: true, force: true })
execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
  cwd: packageDirectory,
  stdio: 'inherit'
})
