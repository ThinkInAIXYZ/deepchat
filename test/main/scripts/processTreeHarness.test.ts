import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureProcessIdentity,
  cleanupMarkedIdentity,
  getProcessIdentityStatus
} from '../../../scripts/process-tree-harness/identity.mjs'
import {
  runProcessTreeHarness,
  waitForChildExit
} from '../../../scripts/process-tree-harness.mjs'

const children: Array<{
  child: ReturnType<typeof spawn>
  identity?: Awaited<ReturnType<typeof captureProcessIdentity>>
}> = []
const temporaryDirectories: string[] = []

async function spawnMarkedChild() {
  const marker = `deepchat-ptg-unit-${randomUUID()}`
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {
    stdio: 'ignore'
  })
  const entry: (typeof children)[number] = { child }
  children.push(entry)
  if (!child.pid) throw new Error('Marked child did not expose a PID')
  entry.identity = await captureProcessIdentity(child.pid, marker)
  return { child, identity: entry.identity }
}

afterEach(async () => {
  for (const entry of children.splice(0).reverse()) {
    if (entry.identity) await cleanupMarkedIdentity(entry.identity).catch(() => undefined)
    if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL')
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe.sequential('process tree harness ownership', () => {
  it('cleans a survivor only while marker, PID, and start identity still match', async () => {
    const { identity } = await spawnMarkedChild()

    const cleanup = await cleanupMarkedIdentity(identity)

    expect(cleanup.before).toBe('match')
    expect(cleanup.signals.length).toBeGreaterThan(0)
    expect(cleanup.after).toBe('absent')
  })

  it('does not signal a PID whose captured start identity mismatches', async () => {
    const { identity } = await spawnMarkedChild()

    const cleanup = await cleanupMarkedIdentity({
      ...identity,
      startIdentity: `${identity.startIdentity}-reused`
    })

    expect(cleanup).toMatchObject({ before: 'mismatch', signals: [], after: 'mismatch' })
    expect(await getProcessIdentityStatus(identity)).toBe('match')
  })

  it('times out once and removes competing child listeners', async () => {
    const child = new EventEmitter()
    const settlement = waitForChildExit(child, 20)

    await expect(settlement).rejects.toThrow('timed out')
    child.emit('exit', 0, null)

    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  })

  it.runIf(process.platform === 'darwin').each(['owner-loss', 'callback-observation'] as const)(
    'records real Electron %s without treating the measurement as containment success',
    async (mode) => {
      const outputDir = await mkdtemp(path.join(tmpdir(), 'deepchat-ptg-test-'))
      temporaryDirectories.push(outputDir)

      const result = await runProcessTreeHarness({
        mode,
        observationMs: 100,
        outputDir
      })
      const persisted = JSON.parse(await readFile(result.jsonPath, 'utf8'))

      expect(result.artifact).toMatchObject({
        mode,
        runtime: {
          platform: 'darwin',
          distribution: 'development-fixture',
          packaged: false,
          electronVersion: expect.any(String)
        },
        ownerExit: { code: 17, signal: null },
        cleanup: { allMarkedGone: true },
        error: null
      })
      expect(Object.keys(result.artifact.processTree).sort()).toEqual([
        'grandchild',
        'owner',
        'shell',
        'utility'
      ])
      expect(result.artifact.observation).toHaveProperty('contractSatisfied')
      expect(persisted).toEqual(result.artifact)
    },
    20_000
  )

  it.runIf(process.platform === 'darwin')(
    'settles the cooperative healthy tree exactly once',
    async () => {
      const outputDir = await mkdtemp(path.join(tmpdir(), 'deepchat-ptg-test-'))
      temporaryDirectories.push(outputDir)

      const { artifact } = await runProcessTreeHarness({
        mode: 'healthy-shutdown',
        observationMs: 50,
        outputDir
      })

      expect(artifact.ownerExit).toEqual({ code: 0, signal: null })
      expect(artifact.events.filter((event) => event.type === 'utility-settled')).toHaveLength(1)
      expect(artifact.observation.contractSatisfied).toBe(true)
      expect(artifact.cleanup.allMarkedGone).toBe(true)
    },
    20_000
  )
})
