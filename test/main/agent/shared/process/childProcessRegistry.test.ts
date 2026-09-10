import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { __esModule: true, ...actual, default: actual }
})

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return { __esModule: true, ...actual, default: actual }
})

import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
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
    ...overrides
  }
}

describe('ChildProcessRegistry', () => {
  let rootDir: string
  let alivePids: Set<number>
  let observations: Map<number, ObservedProcessIdentity>
  let terminate: ReturnType<typeof vi.fn>
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
    terminate = vi.fn().mockResolvedValue(true)
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

  it('persists launch records and lists them back', () => {
    registry.record({
      subsystem: 'background-exec',
      recordId: 'bg_session/1',
      pid: 4321,
      commandLine: ['/bin/zsh', '-c', 'npm run dev'],
      cwd: '/tmp/work'
    })

    const records = registry.list('background-exec')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      recordId: 'bg_session/1',
      pid: 4321,
      ownerPid: process.pid,
      commandLine: ['/bin/zsh', '-c', 'npm run dev'],
      cwd: '/tmp/work',
      recordedAt: 1_060_000
    })
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

  it('refuses to kill a reused pid whose command line does not match', async () => {
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
    // The recorded process is demonstrably gone; the stale record is dropped.
    expect(recordFileCount('background-exec')).toBe(0)
  })

  it('refuses to kill a reused pid whose start time is outside the tolerance window', async () => {
    const record = makeRecord()
    writeRecord('background-exec', record)
    alivePids.add(record.pid)
    observations.set(record.pid, {
      alive: true,
      commandLine: '/bin/zsh -c npm run dev',
      startedAtMs: record.recordedAt + 10 * 60 * 1000
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
      startedAtMs: record.recordedAt
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
    observations.set(5002, { alive: true })
    const attester = vi.fn().mockReturnValue(true)

    const result = await registry.reapStale('acp-agent', {
      excludeRecordIds: new Set(['keep-me']),
      attester
    })

    expect(result.skipped).toEqual(['keep-me'])
    expect(result.reaped).toEqual(['custom'])
    expect(attester).toHaveBeenCalledWith(vetted, { alive: true })
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
})

describe('defaultChildProcessAttester', () => {
  const record = makeRecord()

  it('accepts matching start time and command line fingerprint', () => {
    expect(
      defaultChildProcessAttester(record, {
        alive: true,
        commandLine: '/bin/zsh -c npm run dev',
        startedAtMs: record.recordedAt + 30_000
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
