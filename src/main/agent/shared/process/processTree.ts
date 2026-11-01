import { spawn, type ChildProcess } from 'child_process'

const FORCE_KILL_SETTLE_MS = 500
const PID_EXIT_POLL_MS = 25

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

export function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (
    hasExited(child) &&
    (child.stdio ?? [child.stdin, child.stdout, child.stderr]).every(
      (stream) => !stream || stream.closed
    )
  ) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      child.removeListener('close', onClose)
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const onClose = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(true)
    }

    child.once('close', onClose)
    timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve(false)
    }, timeoutMs)
  })
}

async function spawnAndWait(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        ...(process.platform === 'win32' ? { windowsHide: true } : {})
      })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    } catch {
      resolve()
    }
  })
}

async function spawnAndCapture(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve) => {
    let output = ''

    try {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      child.stdout?.on('data', (chunk: Buffer | string) => {
        output += chunk.toString()
      })
      child.on('error', () => resolve(''))
      child.on('close', () => resolve(output))
    } catch {
      resolve('')
    }
  })
}

async function listChildPids(pid: number): Promise<number[]> {
  const output = await spawnAndCapture('pgrep', ['-P', `${pid}`])
  return output
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((childPid) => Number.isInteger(childPid) && childPid > 0)
}

async function collectDescendantPids(pid: number): Promise<number[]> {
  const descendants: number[] = []
  const pending = [pid]
  const seen = new Set<number>()

  while (pending.length > 0) {
    const currentPid = pending.pop()
    if (!currentPid) {
      continue
    }

    const childPids = await listChildPids(currentPid)
    for (const childPid of childPids) {
      if (seen.has(childPid)) {
        continue
      }

      seen.add(childPid)
      descendants.push(childPid)
      pending.push(childPid)
    }
  }

  return descendants
}

async function signalDescendantsRecursively(
  pid: number,
  childSignal: '-TERM' | '-KILL'
): Promise<void> {
  const descendants = await collectDescendantPids(pid)
  for (const descendantPid of descendants.reverse()) {
    await spawnAndWait('kill', [childSignal, `${descendantPid}`])
  }
}

async function signalProcessTree(
  pid: number,
  signal: 'SIGTERM' | 'SIGKILL',
  ownedGroup = false
): Promise<boolean> {
  if (process.platform === 'win32') {
    const args = ['/PID', `${pid}`, '/T', '/F']
    await spawnAndWait('taskkill', args)
    return false
  }

  const childSignal = signal === 'SIGKILL' ? '-KILL' : '-TERM'
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    // Never fall back to a potentially reused root PID after acquiring its group.
    if (ownedGroup) return true
    await signalDescendantsRecursively(pid, childSignal)
    try {
      process.kill(pid, signal)
    } catch {
      // Process may have already exited.
    }
    return false
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isProcessAlive(pid)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return false
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(PID_EXIT_POLL_MS, remaining)))
  }
  return true
}

export async function terminateProcessTreeByPid(
  pid: number,
  options: {
    graceMs?: number
    nativeIdentity?: string
    ownedGroup?: boolean
  } = {}
): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Cannot terminate invalid process id: ${pid}`)
  }
  if (options.nativeIdentity !== undefined) {
    const executable = process.env.DEEPCHAT_HARNESS_EXECUTABLE
    if (process.platform !== 'darwin' || !executable) return false
    const output = await spawnAndCapture(executable, [
      options.ownedGroup === false ? '--terminate-owner' : '--terminate-tree',
      `${pid}`,
      options.nativeIdentity,
      `${Math.min(2000, Math.max(0, options.graceMs ?? 2000))}`
    ])
    try {
      return JSON.parse(output).retired === true
    } catch {
      return false
    }
  }
  if (options.ownedGroup === false) return false
  if (!isProcessAlive(pid)) {
    return process.platform === 'win32' || !isProcessAlive(-pid)
  }

  const graceMs = Math.max(0, options.graceMs ?? 2000)
  const grouped = await signalProcessTree(pid, 'SIGTERM')
  const target = grouped ? -pid : pid
  if (await waitForPidExit(target, graceMs)) {
    return true
  }

  await signalProcessTree(pid, 'SIGKILL', grouped)
  return await waitForPidExit(target, FORCE_KILL_SETTLE_MS)
}

export async function terminateProcessTree(
  child: ChildProcess,
  options: {
    graceMs?: number
    nativeIdentity?: string
  } = {}
): Promise<boolean> {
  const graceMs = Math.max(0, options.graceMs ?? 2000)

  if (options.nativeIdentity !== undefined) {
    if (!child.pid) return false
    const retired = await terminateProcessTreeByPid(child.pid, options)
    return retired && (await waitForClose(child, FORCE_KILL_SETTLE_MS))
  }

  if (hasExited(child)) {
    if (process.platform !== 'win32' && child.pid && isProcessAlive(-child.pid)) return false
    return await waitForClose(child, graceMs)
  }

  const pid = child.pid
  if (!pid) {
    try {
      child.kill('SIGTERM')
    } catch {
      // Ignore missing pid failures.
    }
    return await waitForClose(child, graceMs)
  }

  const grouped = await signalProcessTree(pid, 'SIGTERM')
  const settled = await Promise.all([
    waitForClose(child, graceMs),
    grouped ? waitForPidExit(-pid, graceMs) : Promise.resolve(true)
  ])
  if (settled.every(Boolean)) {
    return true
  }

  await signalProcessTree(pid, 'SIGKILL', grouped)
  const forced = await Promise.all([
    waitForClose(child, FORCE_KILL_SETTLE_MS),
    grouped ? waitForPidExit(-pid, FORCE_KILL_SETTLE_MS) : Promise.resolve(true)
  ])
  return forced.every(Boolean)
}
