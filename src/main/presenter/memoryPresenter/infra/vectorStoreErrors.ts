export class MemoryVectorStoreQuarantineRequiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MemoryVectorStoreQuarantineRequiredError'
  }
}

export class MemoryVectorStorePostCommitError extends Error {
  constructor(cause: unknown) {
    super(`[MemoryVectorStore] committed v2 store failed to open: ${String(cause)}`, { cause })
    this.name = 'MemoryVectorStorePostCommitError'
  }
}
