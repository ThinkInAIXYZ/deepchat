import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000

async function queryWindowsProcesses() {
  const script = [
    'Get-CimInstance Win32_Process | ForEach-Object {',
    "  [PSCustomObject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; startIdentity = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = [string]$_.CommandLine }",
    '} | ConvertTo-Json -Compress'
  ].join('\n')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: QUERY_TIMEOUT_MS, windowsHide: true }
  )
  const parsed = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (entry) => entry.commandLine && entry.startIdentity
  )
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

export async function censusProcesses() {
  return (
    process.platform === 'win32'
      ? await queryWindowsProcesses()
      : process.platform === 'darwin' || process.platform === 'linux'
        ? await queryPosixProcesses()
        : (() => {
            throw new Error(`Unsupported process identity platform: ${process.platform}`)
          })()
  )
}

export async function censusMarkedProcesses(marker) {
  return (await censusProcesses()).filter((entry) => entry.commandLine.includes(marker))
}

export async function captureProcessIdentity(pid, marker, commandMarkerRequired = true) {
  const identity = (await censusProcesses()).find((entry) => entry.pid === pid)
  if (!identity) throw new Error(`Process ${pid} exited before identity capture`)
  if (commandMarkerRequired && !identity.commandLine.includes(marker)) {
    throw new Error(`Process ${pid} command does not contain marker ${marker}`)
  }
  return { ...identity, marker, commandMarkerRequired }
}

export async function getProcessIdentityStatus(identity) {
  const match = (await censusProcesses()).find((entry) => entry.pid === identity.pid)
  if (!match) return 'absent'
  return match.startIdentity === identity.startIdentity &&
    (identity.commandMarkerRequired === false || match.commandLine.includes(identity.marker))
    ? 'match'
    : 'mismatch'
}

async function waitForIdentityToLeave(identity, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await getProcessIdentityStatus(identity)) !== 'match') return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return (await getProcessIdentityStatus(identity)) !== 'match'
}

export async function cleanupMarkedIdentity(identity, graceMs = 500) {
  const before = await getProcessIdentityStatus(identity)
  if (before !== 'match') return { pid: identity.pid, before, signals: [], after: before }

  const signals = []
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if ((await getProcessIdentityStatus(identity)) !== 'match') break
    try {
      process.kill(identity.pid, signal)
      signals.push(signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    if (await waitForIdentityToLeave(identity, graceMs)) break
  }

  const after = await getProcessIdentityStatus(identity)
  if (after === 'match') {
    throw new Error(`Marked process ${identity.pid} survived identity-safe cleanup`)
  }
  return { pid: identity.pid, before, signals, after }
}
