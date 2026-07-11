import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000

export class ProcessVisibilityUnknownError extends Error {
  constructor(message, processEntry) {
    super(message)
    this.name = 'ProcessVisibilityUnknownError'
    this.code = 'PROCESS_VISIBILITY_UNKNOWN'
    if (processEntry) this.processEntry = processEntry
  }
}

export function parseWindowsProcessOutput(stdout) {
  const parsed = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((entry) => Number.isInteger(entry?.pid))
    .map((entry) =>
      typeof entry.commandLine === 'string' && entry.commandLine.length > 0
        ? entry
        : {
            ...entry,
            commandLine: null,
            visibility: 'unknown',
            visibilityError: 'COMMAND_LINE_UNAVAILABLE'
          }
    )
}

async function queryWindowsProcesses() {
  const script = [
    'Get-CimInstance Win32_Process | ForEach-Object {',
    "  [PSCustomObject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; startIdentity = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine }",
    '} | ConvertTo-Json -Compress'
  ].join('\n')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: QUERY_TIMEOUT_MS, windowsHide: true }
  )
  return parseWindowsProcessOutput(stdout)
}

async function queryPosixProcesses() {
  const { stdout } = await execFileAsync(
    'ps',
    ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=', '-o', 'command='],
    { timeout: QUERY_TIMEOUT_MS, killSignal: 'SIGKILL' }
  )
  return stdout
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/)
      return match
        ? {
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            startIdentity: match[3].trim(),
            commandLine: match[4]
          }
        : null
    })
    .filter(Boolean)
}

export function parseLinuxStat(stat) {
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd < 0) return null
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
  const parentPid = Number(fields[1])
  const startTicks = fields[19]
  if (!Number.isInteger(parentPid) || !startTicks) return null
  return { parentPid, startTicks }
}

export async function queryLinuxProcess(pidText, readProcessFile = readFile) {
  const pid = Number(pidText)
  if (!Number.isInteger(pid)) return null
  let statBefore = null
  try {
    statBefore = parseLinuxStat(await readProcessFile(`/proc/${pidText}/stat`, 'utf8'))
    if (!statBefore) return null
    const commandBuffer = await readProcessFile(`/proc/${pidText}/cmdline`)
    const statAfter = parseLinuxStat(await readProcessFile(`/proc/${pidText}/stat`, 'utf8'))
    if (!statAfter || statBefore.startTicks !== statAfter.startTicks) return null
    const commandLine = commandBuffer.toString('utf8').replaceAll('\0', ' ').trim()
    if (!commandLine) return null
    return {
      pid,
      parentPid: statAfter.parentPid,
      startIdentity: `proc-start-ticks:${statAfter.startTicks}`,
      commandLine
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      return {
        pid,
        parentPid: statBefore?.parentPid ?? null,
        startIdentity: statBefore ? `proc-start-ticks:${statBefore.startTicks}` : null,
        commandLine: null,
        visibility: 'unknown',
        visibilityError: error.code
      }
    }
    throw error
  }
}

async function queryLinuxProcesses() {
  const entries = await readdir('/proc')
  return (
    await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(queryLinuxProcess))
  ).filter(Boolean)
}

export async function censusProcesses() {
  if (process.platform === 'win32') return queryWindowsProcesses()
  if (process.platform === 'linux') return queryLinuxProcesses()
  if (process.platform === 'darwin') return queryPosixProcesses()
  throw new Error(`Unsupported process identity platform: ${process.platform}`)
}

export class ProcessIdentityVerificationError extends Error {
  constructor(message, captureResult) {
    super(message)
    this.name = 'ProcessIdentityVerificationError'
    this.code = 'PROCESS_IDENTITY_UNVERIFIED'
    if (captureResult) this.captureResult = captureResult
  }
}

export function filterMarkedProcesses(processes, marker) {
  const unknown = processes.find((entry) => entry.visibility === 'unknown')
  if (unknown) {
    throw new ProcessVisibilityUnknownError(
      `Process ${unknown.pid} command visibility is unknown (${unknown.visibilityError})`,
      unknown
    )
  }
  return processes.filter((entry) => entry.commandLine.includes(marker))
}

export async function censusMarkedProcesses(marker) {
  return filterMarkedProcesses(await censusProcesses(), marker)
}

export async function captureProcessIdentity(pid, marker, commandMarkerRequired = true) {
  const identity = (await censusProcesses()).find((entry) => entry.pid === pid)
  if (!identity) {
    throw new ProcessIdentityVerificationError(`Process ${pid} exited before identity capture`)
  }
  if (identity.visibility === 'unknown') {
    throw new ProcessVisibilityUnknownError(
      `Process ${pid} command visibility is unknown (${identity.visibilityError})`,
      identity
    )
  }
  if (commandMarkerRequired && !identity.commandLine.includes(marker)) {
    throw new ProcessIdentityVerificationError(
      `Process ${pid} command does not contain marker ${marker}`
    )
  }
  return { ...identity, marker, commandMarkerRequired }
}

export async function getProcessIdentityStatus(identity) {
  const match = (await censusProcesses()).find((entry) => entry.pid === identity.pid)
  if (!match) return 'absent'
  if (match.visibility === 'unknown') return 'unknown'
  return match.startIdentity === identity.startIdentity &&
    (identity.commandMarkerRequired === false || match.commandLine.includes(identity.marker))
    ? 'match'
    : 'mismatch'
}

async function waitForIdentityToLeave(identity, timeoutMs, getStatus) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await getStatus(identity)) !== 'match') return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return (await getStatus(identity)) !== 'match'
}

export async function cleanupMarkedIdentity(identity, graceMs = 500, getStatus = getProcessIdentityStatus) {
  const before = await getStatus(identity)
  if (before !== 'match') return { pid: identity.pid, before, signals: [], after: before }

  const signals = []
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if ((await getStatus(identity)) !== 'match') break
    try {
      process.kill(identity.pid, signal)
      signals.push(signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    if (await waitForIdentityToLeave(identity, graceMs, getStatus)) break
  }

  const after = await getStatus(identity)
  if (after === 'match') {
    throw new Error(`Marked process ${identity.pid} survived identity-safe cleanup`)
  }
  return { pid: identity.pid, before, signals, after }
}
