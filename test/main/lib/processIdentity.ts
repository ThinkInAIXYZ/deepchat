import { execFile, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROCESS_QUERY_TIMEOUT_MS = 5_000

type ProcessSnapshot = {
  startIdentity: string
  commandLine: string
}

export type MarkedProcessIdentity = ProcessSnapshot & {
  pid: number
  marker: string
}

export type ProcessIdentityStatus = 'absent' | 'match' | 'mismatch'

async function queryWindowsProcess(pid: number): Promise<ProcessSnapshot | null> {
  const script = [
    `$target = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop`,
    "if ($null -eq $target) { [PSCustomObject]@{ status = 'absent' } | ConvertTo-Json -Compress }",
    "else { [PSCustomObject]@{ status = 'present'; startIdentity = $target.CreationDate.ToUniversalTime().ToString('o'); commandLine = [string]$target.CommandLine } | ConvertTo-Json -Compress }"
  ].join('; ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true
    }
  )
  const result = JSON.parse(stdout.trim()) as {
    status: 'absent' | 'present'
    startIdentity?: string
    commandLine?: string
  }
  if (result.status === 'absent') return null
  if (!result.startIdentity || !result.commandLine) {
    throw new Error(`Incomplete Windows process identity for PID ${pid}`)
  }
  return {
    startIdentity: result.startIdentity,
    commandLine: result.commandLine
  }
}

async function queryPosixProcess(pid: number): Promise<ProcessSnapshot | null> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      {
        timeout: PROCESS_QUERY_TIMEOUT_MS,
        killSignal: 'SIGKILL'
      }
    )
    const line = stdout.trim()
    if (!line) return null
    const startIdentity = line.slice(0, 24)
    const commandLine = line.slice(24).trim()
    if (!startIdentity || !commandLine) {
      throw new Error(`Incomplete POSIX process identity for PID ${pid}`)
    }
    return { startIdentity, commandLine }
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return null
    throw error
  }
}

async function queryProcess(pid: number): Promise<ProcessSnapshot | null> {
  if (process.platform === 'win32') return await queryWindowsProcess(pid)
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return await queryPosixProcess(pid)
  }
  throw new Error(`Unsupported process identity platform: ${process.platform}`)
}

export async function captureMarkedProcessIdentity(
  pid: number,
  marker: string
): Promise<MarkedProcessIdentity> {
  const snapshot = await queryProcess(pid)
  if (!snapshot) throw new Error(`Marked process ${pid} exited before identity capture`)
  if (!snapshot.commandLine.includes(marker)) {
    throw new Error(`Process ${pid} does not contain marker ${marker}`)
  }
  return { pid, marker, ...snapshot }
}

export async function getProcessIdentityStatus(
  identity: MarkedProcessIdentity
): Promise<ProcessIdentityStatus> {
  const snapshot = await queryProcess(identity.pid)
  if (!snapshot) return 'absent'
  return snapshot.startIdentity === identity.startIdentity &&
    snapshot.commandLine.includes(identity.marker)
    ? 'match'
    : 'mismatch'
}

export async function killMarkedChildIfStillOwned(
  child: ChildProcess,
  identity: MarkedProcessIdentity,
  graceMs: number
): Promise<void> {
  const status = await getProcessIdentityStatus(identity)
  if (status !== 'match') return

  const closePromise = once(child, 'close')
  child.kill('SIGKILL')
  await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, graceMs))])

  if ((await getProcessIdentityStatus(identity)) === 'match') {
    throw new Error(`Marked process ${identity.pid} survived cleanup`)
  }
}
