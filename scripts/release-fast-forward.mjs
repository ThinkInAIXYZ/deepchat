import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.platform === 'win32') {
  console.error('Windows release automation is not supported.')
  console.error('Please follow the manual release steps in:')
  console.error('- CONTRIBUTING.md')
  console.error('- CONTRIBUTING.zh.md')
  console.error('- docs/release-flow.md')
  process.exit(1)
}

const scriptPath = path.join(__dirname, 'release-fast-forward.sh')
const child = spawn('bash', [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
})

child.on('error', (error) => {
  console.error(`Failed to start release helper: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
