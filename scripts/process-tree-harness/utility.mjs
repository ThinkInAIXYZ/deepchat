import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const marker = process.env.DEEPCHAT_PTG_MARKER
const eventPath = process.env.DEEPCHAT_PTG_EVENT_PATH
const stopFile = process.env.DEEPCHAT_PTG_STOP_FILE
const grandchildPath = process.env.DEEPCHAT_PTG_GRANDCHILD_PATH
const nodePath = process.env.DEEPCHAT_PTG_NODE_PATH
const observeCallbacks = process.env.DEEPCHAT_PTG_OBSERVE_CALLBACKS === '1'
const parentPort = process.parentPort

if (!marker || !eventPath || !stopFile || !grandchildPath || !nodePath || !parentPort) {
  throw new Error('Incomplete utility harness environment')
}

function appendEvent(event) {
  appendFileSync(eventPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
}

function recordCallback(name, value) {
  appendEvent({ type: 'utility-callback', name, value: value ?? null, pid: process.pid })
}

if (observeCallbacks) {
  parentPort.on('close', () => recordCallback('parentPort.close'))
  parentPort.on('disconnect', () => recordCallback('parentPort.disconnect'))
  for (const eventName of ['disconnect', 'beforeExit', 'exit', 'SIGTERM', 'SIGHUP', 'SIGINT']) {
    process.on(eventName, (value) => recordCallback(`process.${eventName}`, value))
  }
}

const shell =
  process.platform === 'win32'
    ? spawn(
        process.env.ComSpec || 'cmd.exe',
        [
          '/d',
          '/s',
          '/c',
          `"${nodePath}" "${grandchildPath}" "${marker}" "${eventPath}" "${stopFile}"`
        ],
        { stdio: 'ignore', windowsHide: true }
      )
    : spawn(
        process.env.SHELL || '/bin/sh',
        [
          '-c',
          '"$1" "$2" "$3" "$4" "$5" & wait',
          `ptg-shell-${marker}`,
          nodePath,
          grandchildPath,
          marker,
          eventPath,
          stopFile
        ],
        { stdio: 'ignore' }
      )

appendEvent({ type: 'process-ready', role: 'utility', pid: process.pid, marker })
appendEvent({ type: 'process-ready', role: 'shell', pid: shell.pid, marker })

let settled = false
let settlementCount = 0
function settle(reason, code) {
  if (settled) return
  settled = true
  settlementCount += 1
  appendEvent({
    type: 'utility-settled',
    pid: process.pid,
    reason,
    code,
    settlementCount
  })
  parentPort.postMessage({ type: 'utility-settled', reason, code, settlementCount })
  process.exit(code)
}

shell.once('error', (error) => settle(`shell-error:${error.message}`, 71))
shell.once('close', (code, signal) => settle(`shell-close:${code ?? 'null'}:${signal ?? 'null'}`, 0))

const readyDeadline = Date.now() + 5_000
const readyTimer = setInterval(() => {
  if (existsSync(eventPath)) {
    const events = readFileSync(eventPath, 'utf8')
    if (events.includes('"role":"grandchild"')) {
      clearInterval(readyTimer)
      parentPort.postMessage({ type: 'tree-ready', shellPid: shell.pid })
      return
    }
  }
  if (Date.now() >= readyDeadline) {
    clearInterval(readyTimer)
    settle('grandchild-ready-timeout', 72)
  }
}, 25)

parentPort.on('message', (event) => {
  const message = event?.data ?? event
  if (message?.type !== 'healthy-shutdown') return
  writeFileSync(stopFile, 'stop\n')
})
