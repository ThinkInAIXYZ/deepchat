const MEMORY_PROVIDER_ABORT_CODE = 'MEMORY_PROVIDER_ABORT'

export function createMemoryProviderAbortError(message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.name = 'AbortError'
  error.code = MEMORY_PROVIDER_ABORT_CODE
  return error
}

export function isMemoryProviderAbortError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === MEMORY_PROVIDER_ABORT_CODE
}
