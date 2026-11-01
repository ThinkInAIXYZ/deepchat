import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { terminateProcessTreeByPid } from './processTree'

const RECORD_VERSION = 1
const DEFAULT_MAX_RECORD_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type ChildProcessSubsystem = 'background-exec' | 'mcp-stdio' | 'acp-agent' | 'sync-tunnel'

export interface ChildProcessLaunchRecord {
  version: number
  subsystem: string
  recordId: string
  pid: number
  ownerPid: number
  commandLine: string[]
  cwd?: string
  recordedAt: number
  startedAtMs?: number
  nativeIdentity?: string
}

export interface ObservedProcessIdentity {
  alive: boolean
  commandLine?: string
  startedAtMs?: number
  nativeIdentity?: string
}

export type ChildProcessAttester = (
  record: ChildProcessLaunchRecord,
  observed: ObservedProcessIdentity
) => boolean

export interface ReapStaleChildProcessesResult {
  reaped: string[]
  refused: string[]
  cleared: string[]
  skipped: string[]
}

export interface ReapStaleChildProcessesOptions {
  ownerPid?: number
  attester?: ChildProcessAttester
  excludeRecordIds?: ReadonlySet<string>
  maxRecordAgeMs?: number
}

export interface ChildProcessRegistryOptions {
  rootDir?: string
  now?: () => number
  isAlive?: (pid: number) => boolean
  observe?: (pid: number, record?: ChildProcessLaunchRecord) => Promise<ObservedProcessIdentity>
  terminate?: (pid: number) => Promise<boolean>
  log?: (message: string, ...args: unknown[]) => void
}

function defaultRegistryRoot(): string {
  const userDataDir =
    process.env.DEEPCHAT_E2E_USER_DATA_DIR?.trim() || process.env.DEEPCHAT_USER_DATA_DIR?.trim()
  const baseDir = userDataDir || path.join(os.homedir(), '.deepchat')
  return path.join(baseDir, 'child-processes')
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function runAndCapture(
  command: string,
  args: string[]
): Promise<{ code: number | null; stdout: string }> {
  return await new Promise((resolve) => {
    let stdout = ''
    try {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        timeout: 5000,
        killSignal: 'SIGKILL',
        ...(process.platform === 'win32' ? { windowsHide: true } : {})
      })
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })
      child.on('error', () => resolve({ code: null, stdout: '' }))
      child.on('close', (code) => resolve({ code, stdout }))
    } catch {
      resolve({ code: null, stdout: '' })
    }
  })
}

async function observePosix(pid: number): Promise<ObservedProcessIdentity> {
  const { code, stdout } = await runAndCapture('ps', [
    '-ww',
    '-p',
    `${pid}`,
    '-o',
    'lstart=',
    '-o',
    'command='
  ])
  const trimmed = stdout.trim()
  if (code !== 0 || !trimmed) {
    return { alive: defaultIsAlive(pid) }
  }
  const match = /^(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([\s\S]*)$/.exec(trimmed)
  if (!match) {
    return { alive: true }
  }
  const startedAtMs = Date.parse(`${match[1]} GMT`)
  if (!Number.isFinite(startedAtMs)) {
    return { alive: true }
  }
  return {
    alive: true,
    commandLine: match[2],
    startedAtMs
  }
}

async function observeWindows(pid: number): Promise<ObservedProcessIdentity> {
  const command = [
    'Get-CimInstance Win32_Process -Filter "ProcessId=',
    `${pid}`,
    '" | Select-Object CommandLine,@{Name="CreationDate";Expression={',
    '$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress'
  ].join('')
  const { stdout } = await runAndCapture('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command
  ])
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { alive: true }
  }
  try {
    const parsed = JSON.parse(trimmed) as { CreationDate?: string; CommandLine?: string | null }
    const startedAtMs = parsed.CreationDate ? Date.parse(parsed.CreationDate) : Number.NaN
    return {
      alive: true,
      ...(parsed.CommandLine ? { commandLine: parsed.CommandLine } : {}),
      ...(Number.isFinite(startedAtMs) ? { startedAtMs } : {})
    }
  } catch {
    return { alive: true }
  }
}

function isNativeIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^darwin:[\dA-Fa-f-]{36}:[1-9]\d{0,19}$/.test(value)
}

export async function observeProcessIdentity(
  pid: number,
  record?: ChildProcessLaunchRecord
): Promise<ObservedProcessIdentity> {
  if (!defaultIsAlive(pid)) {
    return { alive: false }
  }
  const executable = process.env.DEEPCHAT_HARNESS_EXECUTABLE
  if (process.platform === 'darwin' && executable && (!record || record.nativeIdentity)) {
    const result = await runAndCapture(executable, ['--process-identity', String(pid)])
    if (result.code === 0) {
      try {
        const value = JSON.parse(result.stdout)
        if (value.pid === pid && isNativeIdentity(value.nativeIdentity))
          return { alive: true, nativeIdentity: value.nativeIdentity }
      } catch {
        // Missing native identity cannot authorize releasing an execution gate.
      }
    }
    return { alive: defaultIsAlive(pid) }
  }
  return process.platform === 'win32' ? await observeWindows(pid) : await observePosix(pid)
}

export function defaultChildProcessAttester(
  record: ChildProcessLaunchRecord,
  observed: ObservedProcessIdentity
): boolean {
  if (!observed.alive) {
    return false
  }
  if (record.nativeIdentity !== undefined) return record.nativeIdentity === observed.nativeIdentity
  if (
    !Number.isFinite(record.startedAtMs) ||
    !Number.isFinite(observed.startedAtMs) ||
    observed.startedAtMs !== record.startedAtMs
  ) {
    return false
  }
  if (!observed.commandLine) {
    return false
  }
  return record.commandLine.every(
    (segment) => segment.length > 0 && observed.commandLine!.includes(segment)
  )
}

function isLaunchRecord(value: unknown): value is ChildProcessLaunchRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.recordId === 'string' &&
    typeof record.subsystem === 'string' &&
    Number.isSafeInteger(record.pid) &&
    (record.pid as number) > 0 &&
    Number.isSafeInteger(record.ownerPid) &&
    Array.isArray(record.commandLine) &&
    record.commandLine.every((segment) => typeof segment === 'string') &&
    (record.nativeIdentity === undefined || isNativeIdentity(record.nativeIdentity)) &&
    Number.isFinite(record.recordedAt)
  )
}

function recordFileName(recordId: string): string {
  const sanitized = recordId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'record'
  const fingerprint = createHash('sha1').update(recordId).digest('hex').slice(0, 8)
  return `${sanitized}_${fingerprint}.json`
}

export class ChildProcessRegistry {
  private readonly configuredRootDir?: string
  private resolvedRootDir?: string
  private readonly now: () => number
  private readonly isAlive: (pid: number) => boolean
  private readonly observe: NonNullable<ChildProcessRegistryOptions['observe']>
  private readonly terminate: (record: ChildProcessLaunchRecord) => Promise<boolean>
  private readonly log: (message: string, ...args: unknown[]) => void
  private readonly onceReaps = new Map<string, Promise<ReapStaleChildProcessesResult> | null>()
  private readonly inflightReaps = new Map<string, Promise<ReapStaleChildProcessesResult>>()
  private readonly pendingRecords = new Map<string, ChildProcessLaunchRecord>()

  constructor(options: ChildProcessRegistryOptions = {}) {
    this.configuredRootDir = options.rootDir
    this.now = options.now ?? Date.now
    this.isAlive = options.isAlive ?? defaultIsAlive
    this.observe = options.observe ?? observeProcessIdentity
    this.terminate = (record) =>
      options.terminate
        ? options.terminate(record.pid)
        : terminateProcessTreeByPid(record.pid, {
            graceMs: 2000,
            nativeIdentity: record.nativeIdentity
          })
    this.log = options.log ?? ((message, ...args) => console.warn(message, ...args))
  }

  async record(
    entry: {
      subsystem: ChildProcessSubsystem
      recordId: string
      pid: number
      commandLine: string[]
      cwd?: string
    },
    child?: Readonly<Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode'>>
  ): Promise<ObservedProcessIdentity | 'exited' | 'failed'> {
    if (!Number.isSafeInteger(entry.pid) || entry.pid <= 0 || !entry.recordId) {
      return 'failed'
    }
    const isCurrentChild = () =>
      !child || (child.pid === entry.pid && child.exitCode === null && child.signalCode === null)
    if (!isCurrentChild()) return 'failed'
    const key = `${entry.subsystem}:${entry.recordId}`
    let record: ChildProcessLaunchRecord | undefined
    try {
      record = {
        version: RECORD_VERSION,
        subsystem: entry.subsystem,
        recordId: entry.recordId,
        pid: entry.pid,
        ownerPid: process.pid,
        commandLine: [...entry.commandLine],
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
        recordedAt: this.now()
      }
      this.pendingRecords.set(key, record)
      this.writeRecord(record)
      // PID-only callers retain legacy attestation; native identity needs a live owned child.
      const observed = await this.observe(entry.pid, child ? undefined : record)
      // A reaped child may have released its PID while inspection was pending.
      if (!isCurrentChild()) return 'failed'
      if (this.pendingRecords.get(key) === record && !observed.alive) {
        this.clear(entry.subsystem, entry.recordId)
        return 'exited'
      }
      // An exit or a newer launch may have cleared/replaced this record while ps ran.
      if (
        this.pendingRecords.get(key) === record &&
        observed.alive &&
        (isNativeIdentity(observed.nativeIdentity) ||
          (typeof observed.startedAtMs === 'number' &&
            Number.isFinite(observed.startedAtMs) &&
            observed.startedAtMs <= record.recordedAt))
      ) {
        record.startedAtMs = observed.startedAtMs
        record.nativeIdentity = observed.nativeIdentity
        this.writeRecord(record)
        return observed
      }
      return 'failed'
    } catch (error) {
      this.log(`[ChildProcessRegistry] Failed to record launch ${entry.recordId}:`, error)
      return 'failed'
    } finally {
      if (this.pendingRecords.get(key) === record) this.pendingRecords.delete(key)
    }
  }

  clear(subsystem: ChildProcessSubsystem, recordId: string): void {
    this.pendingRecords.delete(`${subsystem}:${recordId}`)
    if (!recordId) {
      return
    }
    try {
      fs.unlinkSync(this.recordPath(subsystem, recordId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log(`[ChildProcessRegistry] Failed to clear launch record ${recordId}:`, error)
      }
    }
  }

  list(subsystem: ChildProcessSubsystem, ownerPid?: number): ChildProcessLaunchRecord[] {
    if (ownerPid !== undefined && (!Number.isSafeInteger(ownerPid) || ownerPid <= 0))
      throw new Error('Invalid child process owner PID')
    const subsystemDir = path.join(this.rootDir, subsystem)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(subsystemDir, { withFileTypes: true })
    } catch (error) {
      if (ownerPid !== undefined && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return []
    }

    const records: ChildProcessLaunchRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }
      const filePath = path.join(subsystemDir, entry.name)
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (isLaunchRecord(parsed)) {
          if (ownerPid !== undefined) {
            if (parsed.subsystem !== subsystem || parsed.version !== RECORD_VERSION)
              throw new Error('Invalid owned child process record')
            if (parsed.ownerPid !== ownerPid) continue
          }
          records.push(parsed)
        } else {
          if (ownerPid !== undefined) throw new Error('Invalid owned child process record')
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        if (ownerPid !== undefined) throw error
        try {
          fs.unlinkSync(filePath)
        } catch {
          // Unreadable record files are removed best-effort.
        }
      }
    }
    return records
  }

  async reapStale(
    subsystem: ChildProcessSubsystem,
    options: ReapStaleChildProcessesOptions = {}
  ): Promise<ReapStaleChildProcessesResult> {
    const previous = this.inflightReaps.get(subsystem)
    const snapshot = {
      ...options,
      excludeRecordIds: options.excludeRecordIds ? new Set(options.excludeRecordIds) : undefined
    }
    const reapPromise = (async () => {
      if (previous) await previous.catch(() => undefined)
      return await this.reapStaleRecords(subsystem, snapshot)
    })().finally(() => {
      if (this.inflightReaps.get(subsystem) === reapPromise) this.inflightReaps.delete(subsystem)
    })
    this.inflightReaps.set(subsystem, reapPromise)
    return await reapPromise
  }

  async reapStaleOnce(
    subsystem: ChildProcessSubsystem,
    options: Omit<ReapStaleChildProcessesOptions, 'ownerPid'> = {}
  ): Promise<ReapStaleChildProcessesResult | null> {
    if (this.onceReaps.has(subsystem)) return await (this.onceReaps.get(subsystem) ?? null)
    const recovery = this.reapStale(subsystem, options).finally(() => {
      this.onceReaps.set(subsystem, null)
    })
    this.onceReaps.set(subsystem, recovery)
    return await recovery
  }

  private async reapStaleRecords(
    subsystem: ChildProcessSubsystem,
    options: ReapStaleChildProcessesOptions
  ): Promise<ReapStaleChildProcessesResult> {
    const result: ReapStaleChildProcessesResult = {
      reaped: [],
      refused: [],
      cleared: [],
      skipped: []
    }
    const attester = options.attester ?? defaultChildProcessAttester
    const maxRecordAgeMs = options.maxRecordAgeMs ?? DEFAULT_MAX_RECORD_AGE_MS

    for (const record of this.list(subsystem, options.ownerPid)) {
      if (options.excludeRecordIds?.has(record.recordId)) {
        result.skipped.push(record.recordId)
        continue
      }
      if (
        options.ownerPid === undefined &&
        record.nativeIdentity === undefined &&
        this.now() - record.recordedAt > maxRecordAgeMs
      ) {
        this.clear(subsystem, record.recordId)
        result.cleared.push(record.recordId)
        continue
      }
      if (record.pid === process.pid) {
        result.refused.push(record.recordId)
        continue
      }
      if (!this.isAlive(record.pid) && record.nativeIdentity === undefined) {
        this.clear(subsystem, record.recordId)
        result.cleared.push(record.recordId)
        continue
      }
      if (record.ownerPid !== process.pid && this.isAlive(record.ownerPid)) {
        result.skipped.push(record.recordId)
        continue
      }

      const observed = await this.observe(record.pid, record)
      if (
        record.nativeIdentity !== undefined &&
        isNativeIdentity(observed.nativeIdentity) &&
        record.nativeIdentity.slice(0, 43).toLowerCase() !==
          observed.nativeIdentity.slice(0, 43).toLowerCase()
      ) {
        this.clear(subsystem, record.recordId)
        result.cleared.push(record.recordId)
        continue
      }
      const nativeRootGone = !observed.alive && record.nativeIdentity !== undefined
      if (!observed.alive && !nativeRootGone) {
        this.clear(subsystem, record.recordId)
        result.cleared.push(record.recordId)
        continue
      }

      let attested = false
      if (
        !nativeRootGone &&
        (record.nativeIdentity !== undefined
          ? !isNativeIdentity(observed.nativeIdentity)
          : !Number.isFinite(record.startedAtMs) || !Number.isFinite(observed.startedAtMs))
      ) {
        result.refused.push(record.recordId)
        continue
      }
      try {
        attested = nativeRootGone
          ? options.attester === undefined || attester(record, observed)
          : (record.nativeIdentity !== undefined
              ? record.nativeIdentity === observed.nativeIdentity
              : record.startedAtMs === observed.startedAtMs) && attester(record, observed)
      } catch (error) {
        this.log(`[ChildProcessRegistry] Attester failed for ${record.recordId}:`, error)
      }

      if (!attested) {
        result.refused.push(record.recordId)
        this.log(
          `[ChildProcessRegistry] Refusing unattested cleanup of pid ${record.pid} (${record.recordId})`
        )
        // A reused native root PID cannot prove that its escaped descendants have retired.
        if (record.nativeIdentity === undefined && record.startedAtMs !== observed.startedAtMs) {
          this.clear(subsystem, record.recordId)
        }
        continue
      }

      const terminated = await this.terminate(record).catch((error) => {
        this.log(`[ChildProcessRegistry] Failed to terminate pid ${record.pid}:`, error)
        return false
      })
      if (terminated) {
        this.clear(subsystem, record.recordId)
        result.reaped.push(record.recordId)
      } else {
        result.refused.push(record.recordId)
      }
    }

    return result
  }

  private get rootDir(): string {
    // Resolved on first use so the default root reflects the userData path configured
    // during app startup (including the DEEPCHAT_E2E_USER_DATA_DIR override).
    this.resolvedRootDir ??= this.configuredRootDir ?? defaultRegistryRoot()
    return this.resolvedRootDir
  }

  private writeRecord(record: ChildProcessLaunchRecord): void {
    const filePath = this.recordPath(record.subsystem, record.recordId)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(record), 'utf-8')
    fs.renameSync(tempPath, filePath)
  }

  private recordPath(subsystem: string, recordId: string): string {
    return path.join(this.rootDir, subsystem, recordFileName(recordId))
  }
}

export const childProcessRegistry = new ChildProcessRegistry()
