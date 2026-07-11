import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureProcessIdentity,
  cleanupMarkedIdentity,
  getProcessIdentityStatus,
  parseLinuxStat,
  ProcessIdentityVerificationError
} from '../../../scripts/process-tree-harness/identity.mjs'
import {
  captureReadyIdentities,
  cleanupCapturedIdentities,
  evaluateHarnessContract,
  runProcessTreeHarness,
  waitForChildExit
} from '../../../scripts/process-tree-harness.mjs'

const harnessPath = fileURLToPath(
  new URL('../../../scripts/process-tree-harness.mjs', import.meta.url)
)

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
  it('parses Linux proc start ticks after a parenthesized command name', () => {
    const remainingFields = ['S', '42', ...Array(17).fill('0'), '777']

    expect(parseLinuxStat(`123 (worker ) name) ${remainingFields.join(' ')}`)).toEqual({
      parentPid: 42,
      startTicks: '777'
    })
  })

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

  it('does not signal a same-start-identity PID whose marker mismatches', async () => {
    const { identity } = await spawnMarkedChild()

    const cleanup = await cleanupMarkedIdentity({
      ...identity,
      marker: `${identity.marker}-different`
    })

    expect(cleanup).toMatchObject({ before: 'mismatch', signals: [], after: 'mismatch' })
    expect(await getProcessIdentityStatus(identity)).toBe('match')
  })

  it.runIf(process.platform === 'linux')(
    'uses Linux proc start ticks instead of second-resolution wall time',
    async () => {
      const { identity } = await spawnMarkedChild()

      expect(identity.startIdentity).toMatch(/^proc-start-ticks:\d+$/)
    }
  )

  it('times out once and removes competing child listeners', async () => {
    const child = new EventEmitter()
    const settlement = waitForChildExit(child, 20)

    await expect(settlement).rejects.toThrow('timed out')
    child.emit('exit', 0, null)

    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  })

  it('settles immediately for an already-exited child', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 23, signalCode: null })

    await expect(waitForChildExit(child, 5_000)).resolves.toEqual({ code: 23, signal: null })

    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  })

  it.runIf(process.platform !== 'win32')(
    'captures an owner that exits before tree-ready without waiting for the tree timeout',
    async () => {
      const outputDir = await mkdtemp(path.join(tmpdir(), 'deepchat-ptg-test-'))
      temporaryDirectories.push(outputDir)
      const startedAt = Date.now()

      const { artifact } = await runProcessTreeHarness({
        electronPath: '/usr/bin/false',
        observationMs: 0,
        outputDir
      })

      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect(artifact.ownerExit).toEqual({ code: 1, signal: null })
      expect(artifact.error).toContain('owner exited before tree-ready (code 1, signal null)')
      expect(artifact.cleanup.allMarkedGone).toBe(true)
    }
  )

  it.runIf(process.platform !== 'win32')(
    'lets the CLI exit promptly after an early owner exit without a dangling poll timer',
    async () => {
      const outputDir = await mkdtemp(path.join(tmpdir(), 'deepchat-ptg-test-'))
      temporaryDirectories.push(outputDir)
      const startedAt = Date.now()
      const child = spawn(
        process.execPath,
        [
          harnessPath,
          '--electron',
          '/usr/bin/false',
          '--observation-ms',
          '0',
          '--output-dir',
          outputDir
        ],
        { stdio: 'ignore' }
      )
      children.push({ child })

      await expect(waitForChildExit(child, 3_000)).resolves.toEqual({ code: 1, signal: null })
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    },
    5_000
  )

  it('rejects wrong owner exits and wrong healthy settlement details', () => {
    const base = {
      mode: 'healthy-shutdown',
      error: null,
      statusByRole: {
        owner: 'absent',
        utility: 'absent',
        shell: 'absent',
        grandchild: 'absent'
      },
      ownerExit: { code: 0, signal: null },
      utilitySettlements: [
        {
          reason: 'shell-close:0:null',
          code: 0,
          settlementCount: 1
        }
      ],
      before: [],
      preExit: [{}, {}, {}, {}],
      postObservation: []
    }

    expect(evaluateHarnessContract(base).contractSatisfied).toBe(true)
    expect(
      evaluateHarnessContract({ ...base, ownerExit: { code: 17, signal: null } })
        .contractSatisfied
    ).toBe(false)
    expect(
      evaluateHarnessContract({
        ...base,
        mode: 'owner-loss',
        ownerExit: { code: 0, signal: null }
      }).contractSatisfied
    ).toBe(false)
    expect(
      evaluateHarnessContract({
        ...base,
        mode: 'callback-observation',
        ownerExit: { code: 17, signal: null }
      }).contractSatisfied
    ).toBe(true)
    expect(
      evaluateHarnessContract({
        ...base,
        utilitySettlements: [{ reason: 'wrong', code: 0, settlementCount: 2 }]
      }).contractSatisfied
    ).toBe(false)
    expect(evaluateHarnessContract({ ...base, postObservation: [{}] }).contractSatisfied).toBe(
      false
    )
  })

  it('rejects an unverifiable command marker with a typed identity error', async () => {
    const { identity } = await spawnMarkedChild()

    await expect(
      captureProcessIdentity(identity.pid, `${identity.marker}-different`)
    ).rejects.toBeInstanceOf(ProcessIdentityVerificationError)
  })

  it('fails a Windows-style utility marker closed and never schedules it for signalling', async () => {
    const marker = 'deepchat-ptg-windows-synthetic'
    const events = [
      { type: 'process-ready', role: 'owner', pid: 101 },
      {
        type: 'process-ready',
        role: 'utility-host',
        pid: 102,
        markerMechanism: 'utility-event-unverified'
      },
      { type: 'process-ready', role: 'shell', pid: 103 },
      { type: 'process-ready', role: 'grandchild', pid: 104 }
    ]
    const parentByPid = new Map([
      [101, 1],
      [102, 101],
      [103, 102],
      [104, 103]
    ])
    const captureIdentity = vi.fn(async (pid, capturedMarker, commandMarkerRequired) => ({
      pid,
      parentPid: parentByPid.get(pid),
      startIdentity: `windows-creation-date-${pid}`,
      commandLine: commandMarkerRequired ? `fixture ${capturedMarker}` : 'electron utility',
      marker: capturedMarker,
      commandMarkerRequired
    }))

    await expect(captureReadyIdentities(events, marker, true, captureIdentity)).rejects.toMatchObject(
      { code: 'PROCESS_IDENTITY_UNVERIFIED' }
    )

    const captured = await captureReadyIdentities(events, marker, false, captureIdentity)
    expect(captured.unverified).toEqual([
      expect.objectContaining({
        role: 'utility',
        pid: 102,
        signalable: false,
        verificationCode: 'PROCESS_IDENTITY_UNVERIFIED'
      })
    ])
    const signal = vi.fn()
    const attempts = await cleanupCapturedIdentities(
      [],
      [{ ...captured.unverified[0], marker }],
      captured.unverified,
      signal
    )

    expect(attempts).toEqual([])
    expect(signal).not.toHaveBeenCalled()
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
      if (mode === 'callback-observation') {
        expect(
          result.artifact.observation.utilityProbes
            .filter((probe) => probe.target === 'parentPort')
            .map((probe) => probe.eventName)
        ).toEqual(['close', 'disconnect', 'exit', 'error'])
        expect(
          result.artifact.observation.utilityProbes
            .filter((probe) => probe.target === 'parentPort')
            .every((probe) => probe.registered && probe.documentedByElectron === false)
        ).toBe(true)
      }
      expect(result.artifact.processTree.utility.markerSource).toBe('process-title')
      expect(result.artifact.processTree.utility.commandLine).toContain(result.artifact.marker)
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
      expect(artifact.observation.utilitySettlements).toEqual([
        expect.objectContaining({
          reason: 'shell-close:0:null',
          code: 0,
          settlementCount: 1
        })
      ])
      expect(artifact.observation.checks).toEqual({
        processStatusesSatisfied: true,
        ownerExitSatisfied: true,
        healthySettlementSatisfied: true,
        censusSatisfied: true
      })
      expect(artifact.observation.contractSatisfied).toBe(true)
      expect(artifact.cleanup.allMarkedGone).toBe(true)
    },
    20_000
  )
})
