import { spawn, type ChildProcess } from 'child_process'

const FORCE_KILL_SETTLE_MS = 500

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {
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
      const child = spawn(command, args, { stdio: 'ignore' })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    } catch {
      resolve()
    }
  })
}

async function signalProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/PID', `${pid}`, '/T', '/F']
    await spawnAndWait('taskkill', args)
    return
  }

  const childSignal = signal === 'SIGKILL' ? '-KILL' : '-TERM'
  await spawnAndWait('pkill', [childSignal, '-P', `${pid}`])

  try {
    process.kill(pid, signal)
  } catch {
    // Process may have already exited.
  }
}

export async function terminateProcessTree(
  child: ChildProcess,
  options: {
    graceMs?: number
  } = {}
): Promise<boolean> {
  const graceMs = Math.max(0, options.graceMs ?? 2000)

  if (hasExited(child)) {
    return true
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

  await signalProcessTree(pid, 'SIGTERM')
  if (await waitForClose(child, graceMs)) {
    return true
  }

  await signalProcessTree(pid, 'SIGKILL')
  return await waitForClose(child, FORCE_KILL_SETTLE_MS)
}
