export interface WorkflowInvocationContext {
  runId: string
  invocationId: string
}

export interface WorkflowInvocationContextPort {
  get(sessionId: string): WorkflowInvocationContext | null
}

export class WorkflowInvocationContextRegistry implements WorkflowInvocationContextPort {
  private readonly contexts = new Map<string, WorkflowInvocationContext>()

  bind(sessionId: string, context: WorkflowInvocationContext): () => void {
    const normalizedSessionId = requireId(sessionId, 'workflow child session')
    const normalizedContext = Object.freeze({
      runId: requireId(context.runId, 'workflow run'),
      invocationId: requireId(context.invocationId, 'workflow invocation')
    })
    const existing = this.contexts.get(normalizedSessionId)
    if (existing) {
      if (
        existing.runId !== normalizedContext.runId ||
        existing.invocationId !== normalizedContext.invocationId
      ) {
        throw new Error(`Workflow child session ${normalizedSessionId} is already bound.`)
      }
      return () => undefined
    }

    this.contexts.set(normalizedSessionId, normalizedContext)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      if (this.contexts.get(normalizedSessionId) === normalizedContext) {
        this.contexts.delete(normalizedSessionId)
      }
    }
  }

  get(sessionId: string): WorkflowInvocationContext | null {
    const normalizedSessionId = sessionId.trim()
    return normalizedSessionId ? (this.contexts.get(normalizedSessionId) ?? null) : null
  }

  clear(): void {
    this.contexts.clear()
  }

  get size(): number {
    return this.contexts.size
  }
}

function requireId(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) {
    throw new Error(`${label} id must contain 1-256 characters.`)
  }
  return normalized
}
