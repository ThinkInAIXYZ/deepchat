import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RutisAgentInvocationAdmission } from '@/agent/invocationAdmission'
import type { AgentInvocationAdmissionObservation } from '@/agent/invocationAdmission'

const { cpSync, mkdtempSync, rmSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
const require = createRequire(import.meta.url)
const active = new Set<RutisAgentInvocationAdmission>()
const directories = new Set<string>()
const create = async (
  capacity = 1,
  maxPending = 4,
  observations?: AgentInvocationAdmissionObservation[],
  directory = path.resolve('out/harness')
) => {
  const admission = await RutisAgentInvocationAdmission.create({
    directory,
    electronExecutable: require('electron'),
    capacity,
    maxPending,
    diagnostics: { observe: (value) => observations?.push(value) }
  })
  active.add(admission)
  return admission
}

afterEach(async () => {
  for (const admission of active) {
    await admission.close().catch(() => undefined)
    await admission.flushObservations().catch(() => undefined)
    await admission.shutdown()
  }
  active.clear()
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  directories.clear()
})

describe('application Rutis admission runtime', () => {
  it('preserves owner fairness, queue cancellation and permit accounting through the real host', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deepchat-harness-closure-'))
    directories.add(directory)
    cpSync(path.resolve('out/harness'), directory, { recursive: true })
    const admission = await create(1, 4, undefined, directory)
    await expect(
      admission.acquire({ ownerId: 'pre-aborted', signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ name: 'AgentInvocationAdmissionAbortedError' })
    const first = await admission.acquire({ ownerId: 'a' })
    const cancelled = new AbortController()
    const rejection = expect(
      admission.acquire({ ownerId: 'cancelled', signal: cancelled.signal })
    ).rejects.toMatchObject({ name: 'AgentInvocationAdmissionAbortedError' })
    const order: string[] = []
    const a = admission.run({ ownerId: 'a' }, async () => {
      order.push('a')
    })
    const b = admission.run({ ownerId: 'b' }, async () => {
      order.push('b')
    })
    await expect.poll(async () => (await admission.snapshot()).pending).toBe(3)
    cancelled.abort()
    await rejection
    first.release()
    first.release()
    await Promise.all([a, b])
    expect(order).toEqual(['a', 'b'])
    expect(await admission.snapshot()).toMatchObject({
      active: 0,
      pending: 0,
      granted: 3,
      rejected: 2
    })
  })

  it('preserves owner headroom and lease suspend/resume ordering with correlated diagnostics', async () => {
    const observations: AgentInvocationAdmissionObservation[] = []
    const admission = await create(2, 4, observations)
    const lease = admission.createLease({
      ownerId: 'a',
      maxActiveForOwner: 1,
      correlation: {
        kind: 'live_delegation',
        parentSessionId: 'parent',
        delegationId: 'delegation',
        turnId: 'turn'
      }
    })
    await lease.resume()
    const next = admission.acquire({ ownerId: 'a', maxActiveForOwner: 1 })
    const other = await admission.acquire({ ownerId: 'b' })
    expect(await admission.snapshot()).toMatchObject({ active: 2, pending: 1 })
    lease.suspend()
    expect(lease.state).toBe('suspended')
    const permit = await next
    const resume = lease.resume()
    await expect.poll(async () => (await admission.snapshot()).pending).toBe(1)
    permit.release()
    await resume
    expect(lease.state).toBe('active')
    lease.suspend()
    const cancelledResume = lease.resume()
    lease.release()
    await expect(cancelledResume).rejects.toMatchObject({
      name: 'AgentInvocationAdmissionAbortedError'
    })
    other.release()
    await admission.flushObservations()
    expect(await admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
    expect(observations).toContainEqual(
      expect.objectContaining({ type: 'released', reason: 'lease_suspended', turnId: 'turn' })
    )
    const identity = admission.identity!
    expect(identity.hostPid).not.toBe(process.pid)
    expect(identity.runtime.pid).not.toBe(identity.hostPid)
    await admission.close()
    expect(observations.at(-1)).toMatchObject({ type: 'closed', active: 0, pending: 0 })
    await admission.shutdown()
    expect(() => process.kill(identity.runtime.pid, 0)).toThrow()
  })

  it('isolates asynchronous diagnostic failures from admission outcomes', async () => {
    const admission = await RutisAgentInvocationAdmission.create({
      directory: path.resolve('out/harness'),
      electronExecutable: require('electron'),
      diagnostics: {
        observe: async () => {
          throw new Error('Observer unavailable')
        }
      }
    })
    active.add(admission)
    const permit = await admission.acquire({
      ownerId: 'diagnostics',
      correlation: {
        kind: 'live_delegation',
        parentSessionId: 'parent',
        delegationId: 'delegation',
        turnId: 'turn'
      }
    })
    permit.release()
    await admission.flushObservations()
    expect(await admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
  })

  it('rejects an oversized private frame and tears down the owned runtime', async () => {
    const directory = path.resolve('out/harness')
    const child = spawn(
      path.join(
        directory,
        `deepchat-harness-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
      ),
      [
        require('electron'),
        path.join(directory, 'node_modules', '@arcships', 'rutis-runtime'),
        path.join(directory, 'admission.mjs'),
        '1',
        '4'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
    child.stderr.resume()
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve)
      child.once('error', reject)
    })
    let forced = false
    const timer = setTimeout(() => {
      forced = true
      child.kill('SIGKILL')
    }, 5000)
    try {
      const ready = await new Promise<{ runtime: { pid: number } }>((resolve, reject) => {
        let bytes = Buffer.alloc(0)
        child.once('error', reject)
        child.stdout.on('data', (chunk: Buffer) => {
          bytes = Buffer.concat([bytes, chunk])
          if (bytes.length >= 4 && bytes.length >= 4 + bytes.readUInt32BE(0)) {
            resolve(JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32BE(0)).toString('utf8')))
          }
        })
        child.once('close', () => reject(new Error('Host exited before ready')))
      })
      const header = Buffer.alloc(4)
      header.writeUInt32BE(64 * 1024 + 1)
      child.stdin.write(header)
      expect(await exited).not.toBe(0)
      expect(forced).toBe(false)
      expect(() => process.kill(ready.runtime.pid, 0)).toThrow()
    } finally {
      clearTimeout(timer)
      child.stdin.destroy()
      if (child.exitCode === null) child.kill('SIGKILL')
      await exited
    }
  })

  it('fails closed when its runtime dies and never starts a replacement owner', async () => {
    const admission = await create()
    await admission.acquire({ ownerId: 'active' })
    const queued = expect(admission.acquire({ ownerId: 'queued' })).rejects.toThrow()
    await expect.poll(async () => (await admission.snapshot()).pending).toBe(1)
    const identity = admission.identity!
    process.kill(identity.runtime.pid, 'SIGKILL')
    await queued
    await expect(admission.acquire({ ownerId: 'late' })).rejects.toThrow(/Rutis host/)
    expect(admission.identity).toEqual(identity)
    await admission.shutdown()
    expect(() => process.kill(identity.hostPid, 0)).toThrow()
  })
})
