import { appendFileSync, existsSync } from 'node:fs'

const [marker, eventPath, stopFile] = process.argv.slice(2)
if (!marker || !eventPath || !stopFile) throw new Error('Incomplete grandchild harness arguments')

function appendEvent(event) {
  appendFileSync(eventPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
}

appendEvent({ type: 'process-ready', role: 'grandchild', pid: process.pid, marker })

const timer = setInterval(() => {
  if (!existsSync(stopFile)) return
  clearInterval(timer)
  appendEvent({ type: 'process-exit', role: 'grandchild', pid: process.pid, reason: 'healthy-stop' })
  process.exit(0)
}, 25)
