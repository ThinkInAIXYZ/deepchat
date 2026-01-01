import type { ChildProcess } from 'child_process'

type ActiveCommandProcess = {
  child: ChildProcess
  markAborted: () => void
  terminating: boolean
  exitPromise: Promise<void>
}

const activeProcesses = new Map<string, ActiveCommandProcess>()

const getProcessKey = (conversationId: string, snippetId: string) =>
  `${conversationId}:${snippetId}`

export const registerCommandProcess = (
  conversationId: string,
  snippetId: string,
  child: ChildProcess,
  markAborted: () => void
) => {
  const processKey = getProcessKey(conversationId, snippetId)
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  activeProcesses.set(processKey, { child, markAborted, terminating: false, exitPromise })
}

export const unregisterCommandProcess = (conversationId: string, snippetId: string) => {
  activeProcesses.delete(getProcessKey(conversationId, snippetId))
}

export const terminateCommandProcess = async (conversationId: string, snippetId: string) => {
  const processKey = getProcessKey(conversationId, snippetId)
  const entry = activeProcesses.get(processKey)

  if (!entry) {
    console.warn(`[Workspace] No active process found for snippet ${snippetId}`)
    return
  }

  if (entry.terminating) {
    await entry.exitPromise
    return
  }

  entry.terminating = true
  entry.markAborted()

  const killTimer = setTimeout(() => {
    try {
      entry.child.kill('SIGKILL')
    } catch {
      // Ignore force-kill errors.
    }
  }, 2000)

  entry.child.once('exit', () => {
    clearTimeout(killTimer)
    activeProcesses.delete(processKey)
  })

  try {
    entry.child.kill('SIGTERM')
  } catch (error) {
    console.error(`[Workspace] Failed to terminate command ${snippetId}:`, error)
  }
}
