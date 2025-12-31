import type { ChildProcess } from 'child_process'

type ActiveCommandProcess = {
  child: ChildProcess
  markAborted: () => void
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
  activeProcesses.set(getProcessKey(conversationId, snippetId), { child, markAborted })
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

  entry.markAborted()

  try {
    entry.child.kill('SIGTERM')
  } catch (error) {
    console.error(`[Workspace] Failed to terminate command ${snippetId}:`, error)
  }

  const killTimer = setTimeout(() => {
    try {
      entry.child.kill('SIGKILL')
    } catch {
      // Ignore force-kill errors.
    }
  }, 2000)

  entry.child.once('exit', () => {
    clearTimeout(killTimer)
  })

  activeProcesses.delete(processKey)
}
