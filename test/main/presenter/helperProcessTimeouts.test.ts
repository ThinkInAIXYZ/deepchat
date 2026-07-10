import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  captureMarkedProcessIdentity,
  getProcessIdentityStatus,
  killMarkedChildIfStillOwned,
  type MarkedProcessIdentity
} from '../lib/processIdentity'

const DIRECT_CHILD_TIMEOUT_MS = process.platform === 'win32' ? 8_000 : 2_000
const TEST_GRACE_MS = 2_000
const SELF_EXIT_MS = DIRECT_CHILD_TIMEOUT_MS + TEST_GRACE_MS * 2
const HANG_SCRIPT = `setTimeout(() => process.exit(97), ${SELF_EXIT_MS}); setInterval(() => {}, 1000)`

describe('PTG-H0 native direct-child timeout contract', () => {
  it('execFile settles once only after its marked direct child is reaped', async () => {
    const marker = `ptg-h0-exec-file-${randomUUID()}`
    let callbackCount = 0
    let child!: ChildProcess
    let identity: MarkedProcessIdentity | null = null

    const completion = new Promise<Error>((resolve) => {
      child = execFile(
        process.execPath,
        ['-e', HANG_SCRIPT, marker],
        { timeout: DIRECT_CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error) => {
          callbackCount += 1
          resolve(error!)
        }
      )
    })

    try {
      identity = await captureMarkedProcessIdentity(child.pid!, marker)
      const error = (await completion) as Error & { killed?: boolean; signal?: string }
      const finalStatus = await getProcessIdentityStatus(identity)
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(identity.pid).toBe(child.pid)
      expect(identity.marker).toBe(marker)
      expect(identity.startIdentity).not.toBe('')
      expect(identity.commandLine).toContain(marker)
      expect(finalStatus).not.toBe('match')
      expect(error.killed).toBe(true)
      expect(error.signal).toBe('SIGKILL')
      expect(callbackCount).toBe(1)
    } finally {
      if (identity) await killMarkedChildIfStillOwned(child, identity, TEST_GRACE_MS)
    }
  }, 15_000)

  it('spawn emits one close only after its marked direct child is reaped', async () => {
    const marker = `ptg-h0-spawn-${randomUUID()}`
    const child = spawn(process.execPath, ['-e', HANG_SCRIPT, marker], {
      stdio: 'ignore',
      timeout: DIRECT_CHILD_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    })
    let identity: MarkedProcessIdentity | null = null
    let closeCount = 0
    child.on('close', () => {
      closeCount += 1
    })

    try {
      identity = await captureMarkedProcessIdentity(child.pid!, marker)
      const [code, signal] = (await once(child, 'close')) as [number | null, string | null]
      const finalStatus = await getProcessIdentityStatus(identity)
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(identity.startIdentity).not.toBe('')
      expect(identity.commandLine).toContain(marker)
      expect(finalStatus).not.toBe('match')
      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')
      expect(closeCount).toBe(1)
    } finally {
      if (identity) await killMarkedChildIfStillOwned(child, identity, TEST_GRACE_MS)
    }
  }, 15_000)
})
