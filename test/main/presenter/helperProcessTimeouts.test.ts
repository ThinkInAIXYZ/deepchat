import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'

const DIRECT_CHILD_TIMEOUT_MS = 100
const TEST_GRACE_MS = 1_000

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForReap(pid: number): Promise<void> {
  const deadline = Date.now() + TEST_GRACE_MS
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(isProcessAlive(pid)).toBe(false)
}

async function killMarkedSurvivor(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => setTimeout(resolve, TEST_GRACE_MS))
  ])
}

describe('PTG-H0 native direct-child timeout contract', () => {
  it('execFile settles once only after its marked direct child is reaped', async () => {
    const marker = `ptg-h0-exec-file-${randomUUID()}`
    let callbackCount = 0
    let child!: ChildProcess

    const completion = new Promise<Error>((resolve) => {
      child = execFile(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', marker],
        { timeout: DIRECT_CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error) => {
          callbackCount += 1
          resolve(error!)
        }
      )
    })
    const identity = {
      pid: child.pid!,
      marker,
      startedAtNs: process.hrtime.bigint(),
      spawnfile: child.spawnfile
    }

    try {
      const error = (await completion) as Error & { killed?: boolean; signal?: string }
      await waitForReap(identity.pid)
      await new Promise((resolve) => setTimeout(resolve, DIRECT_CHILD_TIMEOUT_MS + 20))

      expect(identity).toEqual({
        pid: expect.any(Number),
        marker,
        startedAtNs: identity.startedAtNs,
        spawnfile: process.execPath
      })
      expect(typeof identity.startedAtNs).toBe('bigint')
      expect(error.killed).toBe(true)
      expect(error.signal).toBe('SIGKILL')
      expect(callbackCount).toBe(1)
    } finally {
      await killMarkedSurvivor(child)
    }
  })

  it('spawn emits one close only after its marked direct child is reaped', async () => {
    const marker = `ptg-h0-spawn-${randomUUID()}`
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {
      stdio: 'ignore',
      timeout: DIRECT_CHILD_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    })
    const identity = {
      pid: child.pid!,
      marker,
      startedAtNs: process.hrtime.bigint(),
      spawnfile: child.spawnfile
    }
    let closeCount = 0
    child.on('close', () => {
      closeCount += 1
    })

    try {
      const [code, signal] = (await once(child, 'close')) as [number | null, string | null]
      await waitForReap(identity.pid)
      await new Promise((resolve) => setTimeout(resolve, DIRECT_CHILD_TIMEOUT_MS + 20))

      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')
      expect(closeCount).toBe(1)
    } finally {
      await killMarkedSurvivor(child)
    }
  })
})
