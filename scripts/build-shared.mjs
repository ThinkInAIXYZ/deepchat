import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL('../packages/shared/', import.meta.url))
const compiler = fileURLToPath(
  new URL(`../node_modules/.bin/${process.platform === 'win32' ? 'tsc.cmd' : 'tsc'}`, import.meta.url)
)
rmSync(new URL('../packages/shared/dist/', import.meta.url), { recursive: true, force: true })
execFileSync(compiler, ['-p', 'tsconfig.json'], {
  cwd: packageDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
