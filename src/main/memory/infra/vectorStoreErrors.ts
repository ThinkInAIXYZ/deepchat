export class MemoryVectorStoreQuarantineRequiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MemoryVectorStoreQuarantineRequiredError'
  }
}

export class MemoryVectorStoreTerminalRecoveryError extends MemoryVectorStoreQuarantineRequiredError {
  readonly fatal: boolean
  readonly recoveryCause?: unknown

  constructor(
    message: string,
    options: { cause?: unknown; fatal?: boolean; recoveryCause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = 'MemoryVectorStoreTerminalRecoveryError'
    this.fatal = options.fatal ?? false
    this.recoveryCause = options.recoveryCause
  }
}

export class MemoryVectorStorePostCommitError extends MemoryVectorStoreQuarantineRequiredError {
  constructor(cause: unknown) {
    super(`[MemoryVectorStore] committed v2 store failed to open: ${String(cause)}`, { cause })
    this.name = 'MemoryVectorStorePostCommitError'
  }
}

export function isDuckDbFatalError(error: unknown): boolean {
  const visited = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current)
    const message = String(current).toLowerCase()
    if (
      message.includes('internal error') ||
      message.includes('fatal error') ||
      message.includes('database has been invalidated') ||
      (message.includes('hnsw') && message.includes('duplicate keys'))
    ) {
      return true
    }
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined
  }
  return false
}
