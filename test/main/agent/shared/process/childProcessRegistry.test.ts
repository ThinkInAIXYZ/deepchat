import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { __esModule: true, ...actual, default: actual }
})

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return { __esModule: true, ...actual, default: actual }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import {
  ChildProcessRegistry,
  defaultChildProcessAttester,
  type ChildProcessLaunchRecord,
  type ObservedProcessIdentity
} from '@/agent/shared/process/childProcessRegistry'

function makeRecord(overrides: Partial<ChildProcessLaunchRecord> = {}): ChildProcessLaunchRecord {
  return {
    version: 1,
    subsystem: 'background-exec',
    recordId: 'bg_test',
    pid: 4321,
    ownerPid: 9999,
    commandLine: ['/bin/zsh', '-c', 'npm run dev'],
    recordedAt: 1_000_000,
    startedAtMs: 998_000,
    ...overrides
  }
}

describe('ChildProcessRegistry', () => {
  let rootDir: string
  let alivePids: Set<number>
  let observations: Map<number, ObservedProcessIdentity>
  let terminate: ReturnType<typeof vi.fn<(pid: number) => Promise<boolean>>>
  let registry: ChildProcessRegistry

  const writeRecord = (subsystem: string, record: ChildProcessLaunchRecord) => {
    const dir = path.join(rootDir, subsystem)
    fs.mkdirSync(dir, { recursive: true })
    const sanitized = record.recordId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'record'
    const fingerprint = createHash('sha1').update(record.recordId).digest('hex').slice(0, 8)
    fs.writeFileSync(path.join(dir, `${sanitized}_${fingerprint}.json`), JSON.stringify(record))
  }

  const recordFileCount = (subsystem: string) => {
    const dir = path.join(rootDir, subsystem)
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'child-process-registry-'))
    alivePids = new Set()
    observations = new Map()
    terminate = vi.fn<(pid: number) => Promise<boolean>>().mockResolvedValue(true)
    registry = new ChildProcessRegistry({
      rootDir,
      now: () => 1_060_000,
      isAlive: (pid) => alivePids.has(pid),
      observe: async (pid) => observations.get(pid) ?? { alive: alivePids.has(pid) },
      terminate,
      log: () => {}
    })
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('persists the observed process start time independently of the write time', async () => {
    observations.set(4321, { alive: true, startedAtMs: 998_000 })
    const recorded = await registry.record({
      subsystem: 'background-exec',
      recordId: 'bg_session/1',
      pid: 4321,
      commandLine: ['/bin/zsh', '-c', 'npm run dev'],
      cwd: '/tmp/work'
    })
    expect(recorded).toEqual({ alive: true, startedAtMs: 998_000 })

    const records = registry.list('background-exec')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      recordId: 'bg_session/1',
      pid: 4321,
      ownerPid: process.pid,
      commandLine: ['/bin/zsh', '-c', 'npm run dev'],
      cwd: '/tmp/work',
      recordedAt: 1_060_000,
      startedAtMs: 998_000
    })
  })

  it('reports registration failure for unavailable storage or process identity', async () => {
    const entry = {
      subsystem: 'background-exec' as const,
      recordId: 'unregistered-command',
      pid: 4321,
      commandLine: ['command']
    }
    observations.set(entry.pid, { alive: true })
    expect(await registry.record(entry)).toBe('failed')
    expect(registry.list(entry.subsystem)).toMatchObject([{ pid: entry.pid }])
    observations.set(entry.pid, { alive: false })
    expect(await registry.record(entry)).toBe('exited')
    expect(registry.list(entry.subsystem)).toEqual([])
    fs.rmSync(rootDir, { recursive: true })
    fs.writeFileSync(rootDir, 'not a directory')
    expect(await registry.record(entry)).toBe('failed')
  })

  it('clears records and tolerates missing files', () => {
    registry.record({
      subsystem: 'mcp-stdio',
      recordId: 'server-a',
      pid: 4321,
      commandLine: ['npx', 'server-a']
    })
    expect(recordFileCount('mcp-stdio')).toBe(1)

    registry.clear('mcp-stdio', 'server-a')
    expect(recordFileCount('mcp-stdio')).toBe(0)
    expect(() => registry.clear('mcp-stdio', 'server-a')).not.toThrow()
  })

  it('drops unreadable record files during list', () => {
    const dir = path.join(rootDir, 'mcp-stdio')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{nope')
    expect(registry.list('mcp-stdio')).toEqual([])
    expect(recordFileCount('mcp-stdio')).toBe(0)
  })

  it('clears records whose process is already gone without terminating', async () => {
    writeRecord('background-exec', makeRecord())

    const result = await registry.reapStale('background-exec')

    expect(result.cleared).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('reaps an attested orphan from a dead owner', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/bin/zsh -c npm run dev',
      startedAtMs: record.recordedAt - 2000
    })

    const result = await registry.reapStale('background-exec')

    expect(result.reaped).toEqual(['bg_test'])
    expect(terminate).toHaveBeenCalledWith(record.pid)
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('skips records still owned by a live foreign process', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    alivePids.add(record.ownerPid)

    const result = await registry.reapStale('background-exec')

    expect(result.skipped).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(1)
  })

  it('retains uncertain legacy ownership when argv changes without a different birth time', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/usr/libexec/LoginWindowUnrelated',
      startedAtMs: record.recordedAt - 2000
    })

    const result = await registry.reapStale('background-exec')

    expect(result.refused).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(1)
  })

  it('recovers a native identity across exec but refuses reused or unobservable identities', async () => {
    const identity = 'darwin:11111111-1111-4111-8111-111111111111:12345'
    const record = makeRecord({ nativeIdentity: identity, startedAtMs: undefined })
    alivePids.add(record.pid)
    const nextBoot = identity.replace(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
    for (const observedIdentity of [undefined, `${identity}6`, nextBoot, identity]) {
      writeRecord('background-exec', record)
      observations.set(record.pid, {
        alive: true,
        nativeIdentity: observedIdentity,
        commandLine: '/different/executable'
      })
      const result = await registry.reapStale('background-exec', { ownerPid: record.ownerPid })
      if (observedIdentity === identity) {
        expect(result.reaped).toEqual([record.recordId])
        expect(terminate).toHaveBeenCalledExactlyOnceWith(record.pid)
      } else if (observedIdentity === nextBoot) {
        expect(result.cleared).toEqual([record.recordId])
        expect(terminate).not.toHaveBeenCalled()
        expect(recordFileCount('background-exec')).toBe(0)
      } else {
        expect(result.refused).toEqual([record.recordId])
        expect(terminate).not.toHaveBeenCalled()
        expect(recordFileCount('background-exec')).toBe(1)
      }
    }
  })

  it('retains native ownership after root loss until group retirement succeeds', async () => {
    const record = makeRecord({
      nativeIdentity: 'darwin:11111111-1111-4111-8111-111111111111:12345',
      startedAtMs: undefined,
      recordedAt: -14 * 24 * 60 * 60 * 1000
    })
    writeRecord('background-exec', record)
    terminate.mockResolvedValueOnce(false)
    const failed = await registry.reapStale('background-exec')
    expect(failed.refused).toEqual([record.recordId])
    expect(failed.cleared).toEqual([])
    expect(recordFileCount('background-exec')).toBe(1)
    const refused = await registry.reapStale('background-exec', {
      ownerPid: record.ownerPid,
      attester: () => false
    })
    expect(refused.refused).toEqual([record.recordId])
    expect(terminate).toHaveBeenCalledTimes(1)
    const retired = await registry.reapStale('background-exec', { ownerPid: record.ownerPid })
    expect(retired.reaped).toEqual([record.recordId])
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('refuses a reused pid with the same command even within the old tolerance window', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/bin/zsh -c npm run dev',
      startedAtMs: record.startedAtMs! + 1000
    })

    const result = await registry.reapStale('background-exec')

    expect(result.refused).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('keeps the record when identity cannot be observed', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, { alive: true })

    const result = await registry.reapStale('background-exec')

    expect(result.refused).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(1)
  })

  it('keeps legacy records without a persisted start time without terminating', async () => {
    const record = makeRecord({ startedAtMs: undefined })
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/bin/zsh -c npm run dev',
      startedAtMs: 998_000
    })

    expect((await registry.reapStale('background-exec')).refused).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(1)
  })

  it.each(['clear', 'replace', 'exit'] as const)(
    'does not restore an old record when observation completes after %s',
    async (action) => {
      let resolveObservation!: (identity: ObservedProcessIdentity) => void
      const observe = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ObservedProcessIdentity>((resolve) => {
              resolveObservation = resolve
            })
        )
        .mockResolvedValue({ alive: true, startedAtMs: 999_000 })
      const delayedRegistry = new ChildProcessRegistry({ rootDir, observe, log: () => {} })
      const entry = {
        subsystem: 'mcp-stdio' as const,
        recordId: 'server',
        pid: 4321,
        commandLine: ['node']
      }
      const child = { pid: entry.pid, exitCode: null as number | null, signalCode: null }
      const pending = delayedRegistry.record(entry, child)
      if (action === 'clear') {
        delayedRegistry.clear(entry.subsystem, entry.recordId)
      } else if (action === 'replace') {
        await delayedRegistry.record({ ...entry, pid: 4322 })
      } else {
        child.exitCode = 0
      }
      resolveObservation({ alive: true, startedAtMs: 998_000 })
      await pending

      const records = delayedRegistry.list('mcp-stdio')
      if (action === 'clear') expect(records).toEqual([])
      else if (action === 'replace')
        expect(records).toMatchObject([{ pid: 4322, startedAtMs: 999_000 }])
      else {
        expect(records).toHaveLength(1)
        expect(records[0].startedAtMs).toBeUndefined()
        expect(records[0].nativeIdentity).toBeUndefined()
      }
    }
  )

  it('observes a live process consistently across scans without terminating it', async () => {
    const realRegistry = new ChildProcessRegistry({ rootDir, terminate, log: () => {} })
    await realRegistry.record({
      subsystem: 'mcp-stdio',
      recordId: 'live-process',
      pid: process.pid,
      commandLine: [process.execPath]
    })
    const [record] = realRegistry.list('mcp-stdio')
    expect(record.startedAtMs).toEqual(expect.any(Number))
    // A separate observer must report the same OS timestamp, not a Date.now()-based estimate.
    await realRegistry.record({
      subsystem: 'mcp-stdio',
      recordId: 'second-observation',
      pid: process.pid,
      commandLine: [process.execPath]
    })
    expect(realRegistry.list('mcp-stdio').map((entry) => entry.startedAtMs)).toEqual([
      record.startedAtMs,
      record.startedAtMs
    ])
    expect(terminate).not.toHaveBeenCalled()
  })

  it('retains a live process record when the OS query fails', async () => {
    const record = makeRecord({ pid: process.ppid })
    writeRecord('mcp-stdio', { ...record, subsystem: 'mcp-stdio' })
    const actual = await vi.importActual<typeof import('child_process')>('child_process')
    vi.mocked(spawn).mockImplementationOnce(() =>
      actual.spawn(process.execPath, ['-e', 'process.exit(1)'], {
        stdio: ['ignore', 'pipe', 'ignore']
      })
    )
    const failedQueryRegistry = new ChildProcessRegistry({
      rootDir,
      now: () => 1_060_000,
      isAlive: (pid) => pid === record.pid,
      terminate,
      log: () => {}
    })

    const result = await failedQueryRegistry.reapStale('mcp-stdio')

    expect(result.refused).toEqual([record.recordId])
    expect(recordFileCount('mcp-stdio')).toBe(1)
    expect(terminate).not.toHaveBeenCalled()
  })

  it('never terminates the current process', async () => {
    const record = makeRecord({ pid: process.pid })
    writeRecord('background-exec', record)

    const result = await registry.reapStale('background-exec')

    expect(result.refused).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
  })

  it('clears records older than the maximum record age', async () => {
    const record = makeRecord({ recordedAt: 1_000_000 })
    writeRecord('background-exec', record)
    alivePids.add(record.pid)

    const result = await registry.reapStale('background-exec', { maxRecordAgeMs: 1000 })

    expect(result.cleared).toEqual(['bg_test'])
    expect(terminate).not.toHaveBeenCalled()
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('keeps the record when termination fails', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/bin/zsh -c npm run dev',
      startedAtMs: record.startedAtMs
    })
    terminate.mockResolvedValue(false)

    const result = await registry.reapStale('background-exec')

    expect(result.refused).toEqual(['bg_test'])
    expect(recordFileCount('background-exec')).toBe(1)
  })

  it('honors excluded record ids and custom attesters', async () => {
    const excluded = makeRecord({ recordId: 'keep-me', pid: 5001 })
    const vetted = makeRecord({ recordId: 'custom', pid: 5002 })
    writeRecord('acp-agent', excluded)
    writeRecord('acp-agent', vetted)
    alivePids.add(5001).add(5002)
    observations.set(5002, { alive: true, startedAtMs: vetted.startedAtMs })
    const attester = vi.fn().mockReturnValue(true)

    const result = await registry.reapStale('acp-agent', {
      excludeRecordIds: new Set(['keep-me']),
      attester
    })

    expect(result.skipped).toEqual(['keep-me'])
    expect(result.reaped).toEqual(['custom'])
    expect(attester).toHaveBeenCalledWith(vetted, { alive: true, startedAtMs: vetted.startedAtMs })
    expect(terminate).toHaveBeenCalledWith(5002)
    expect(terminate).not.toHaveBeenCalledWith(5001)
  })

  it('reaps a subsystem only once per process', async () => {
    writeRecord('mcp-stdio', makeRecord({ subsystem: 'mcp-stdio' }))

    const first = await registry.reapStaleOnce('mcp-stdio')
    const second = await registry.reapStaleOnce('mcp-stdio')

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('waits for in-flight recovery before allowing another startup to proceed', async () => {
    writeRecord('mcp-stdio', makeRecord({ subsystem: 'mcp-stdio' }))
    alivePids.add(4321)
    observations.set(4321, {
      alive: true,
      startedAtMs: 998_000,
      commandLine: '/bin/zsh -c npm run dev'
    })
    let finishTermination!: (terminated: boolean) => void
    terminate.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishTermination = resolve
        })
    )
    const first = registry.reapStaleOnce('mcp-stdio')
    const ready = vi.fn()
    const second = registry.reapStaleOnce('mcp-stdio').then(ready)
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    finishTermination(true)
    await Promise.all([first, second])
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ reaped: ['bg_test'] }))
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('serializes scoped retirement without sharing owners or expiring live records', async () => {
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    for (const [pid, ownerPid] of [
      [4321, 1001],
      [4322, 1002],
      [4323, 1003]
    ]) {
      writeRecord('background-exec', makeRecord({ pid, ownerPid, recordId: `job-${pid}` }))
      alivePids.add(pid)
      observations.set(pid, {
        alive: true,
        startedAtMs: 998_000,
        commandLine: '/bin/zsh -c npm run dev'
      })
    }
    terminate.mockImplementationOnce(async () => {
      entered.resolve()
      await released.promise
      return true
    })
    const first = registry.reapStale('background-exec', { ownerPid: 1001, maxRecordAgeMs: 1 })
    const second = registry.reapStale('background-exec', { ownerPid: 1002, maxRecordAgeMs: 1 })
    try {
      await entered.promise
      expect(terminate).toHaveBeenCalledExactlyOnceWith(4321)
    } finally {
      released.resolve()
    }
    expect((await first).reaped).toEqual(['job-4321'])
    expect((await second).reaped).toEqual(['job-4322'])
    expect(terminate.mock.calls.map(([pid]) => pid)).toEqual([4321, 4322])
    expect(registry.list('background-exec', 1003).map((record) => record.pid)).toEqual([4323])
  })

  it('refuses an owned retirement receipt when records cannot be read', async () => {
    const directory = path.join(rootDir, 'background-exec')
    fs.mkdirSync(directory)
    const corrupted = path.join(directory, 'corrupt.json')
    fs.writeFileSync(corrupted, '{')
    await expect(registry.reapStale('background-exec', { ownerPid: 1001 })).rejects.toThrow()
    expect(fs.existsSync(corrupted)).toBe(true)
    expect(terminate).not.toHaveBeenCalled()
  })

  it('resolves the default root from DEEPCHAT_USER_DATA_DIR at first use', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-userdata-'))
    const previous = process.env.DEEPCHAT_USER_DATA_DIR
    process.env.DEEPCHAT_USER_DATA_DIR = userDataDir
    try {
      const defaultRegistry = new ChildProcessRegistry({
        observe: async () => ({ alive: true, startedAtMs: Date.now() - 1000 }),
        log: () => {}
      })
      await defaultRegistry.record({
        subsystem: 'mcp-stdio',
        recordId: 'srv',
        pid: 4321,
        commandLine: ['npx', 'srv']
      })
      expect(fs.readdirSync(path.join(userDataDir, 'child-processes', 'mcp-stdio'))).toHaveLength(1)
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPCHAT_USER_DATA_DIR
      } else {
        process.env.DEEPCHAT_USER_DATA_DIR = previous
      }
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

describe('defaultChildProcessAttester', () => {
  const record = makeRecord()

  it('accepts matching start time and command line fingerprint', () => {
    expect(
      defaultChildProcessAttester(record, {
        alive: true,
        commandLine: '/bin/zsh -c npm run dev',
        startedAtMs: record.startedAtMs
      })
    ).toBe(true)
  })

  it('rejects dead processes, missing observations and mismatched fingerprints', () => {
    expect(defaultChildProcessAttester(record, { alive: false })).toBe(false)
    expect(defaultChildProcessAttester(record, { alive: true })).toBe(false)
    expect(
      defaultChildProcessAttester(record, {
        alive: true,
        commandLine: '/bin/zsh -c npm run dev'
      })
    ).toBe(false)
    expect(
      defaultChildProcessAttester(record, {
        alive: true,
        commandLine: '/bin/zsh -c npm test',
        startedAtMs: record.recordedAt
      })
    ).toBe(false)
  })
})
