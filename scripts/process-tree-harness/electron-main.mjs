import { appendFileSync, existsSync } from 'node:fs'
import { app, utilityProcess } from 'electron'

const marker = process.env.DEEPCHAT_PTG_MARKER
const eventPath = process.env.DEEPCHAT_PTG_EVENT_PATH
const controlFile = process.env.DEEPCHAT_PTG_CONTROL_FILE
const utilityPath = process.env.DEEPCHAT_PTG_UTILITY_PATH
const mode = process.env.DEEPCHAT_PTG_MODE

if (!marker || !eventPath || !controlFile || !utilityPath || !mode) {
  throw new Error('Incomplete Electron harness environment')
}

function appendEvent(event) {
  appendFileSync(eventPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
}

void app.whenReady().then(() => {
  appendEvent({
    type: 'process-ready',
    role: 'owner',
    pid: process.pid,
    marker,
    electronVersion: process.versions.electron
  })

  const host = utilityProcess.fork(utilityPath, [`--ptg-marker=${marker}`], {
    env: { ...process.env },
    stdio: 'pipe',
    serviceName: `DeepChat PTG ${marker}`
  })

  host.stderr?.setEncoding('utf8')
  host.stderr?.on('data', (chunk) => {
    appendEvent({ type: 'utility-stderr', chunk })
  })

  host.on('spawn', () => {
    appendEvent({ type: 'process-ready', role: 'utility-host', pid: host.pid, marker })
  })
  host.on('exit', (code) => {
    appendEvent({ type: 'utility-host-exit', pid: host.pid, code })
    if (mode === 'healthy-shutdown') app.exit(code ?? 0)
  })
  host.on('message', (event) => {
    if (event.type !== 'tree-ready') return
    appendEvent({ type: 'tree-ready', shellPid: event.shellPid })
    const deadline = Date.now() + 5_000
    const timer = setInterval(() => {
      if (existsSync(controlFile)) {
        clearInterval(timer)
        if (mode === 'healthy-shutdown') {
          host.postMessage({ type: 'healthy-shutdown' })
        } else {
          appendEvent({ type: 'owner-forced-exit', pid: process.pid, code: 17 })
          process.exit(17)
        }
        return
      }
      if (Date.now() >= deadline) {
        clearInterval(timer)
        appendEvent({ type: 'owner-control-timeout', pid: process.pid })
        process.exit(73)
      }
    }, 25)
  })
})

setTimeout(() => {
  appendEvent({ type: 'owner-harness-timeout', pid: process.pid })
  process.exit(74)
}, 15_000).unref()
