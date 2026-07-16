export const MEMORY_PROVIDER_CANCELLATION_CODE = 'MEMORY_PROVIDER_CANCELLED'
export const MEMORY_PROVIDER_DEADLINE_CODE = 'MEMORY_PROVIDER_DEADLINE'
export const MEMORY_PROVIDER_CAPACITY_CODE = 'MEMORY_PROVIDER_CAPACITY'

function createMemoryProviderControlError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.name = 'AbortError'
  error.code = code
  return error
}

export function createMemoryProviderCancellationError(message: string): Error {
  return createMemoryProviderControlError(message, MEMORY_PROVIDER_CANCELLATION_CODE)
}

export function createMemoryProviderDeadlineError(message: string): Error {
  return createMemoryProviderControlError(message, MEMORY_PROVIDER_DEADLINE_CODE)
}

export function createMemoryProviderCapacityError(message: string): Error {
  return createMemoryProviderControlError(message, MEMORY_PROVIDER_CAPACITY_CODE)
}

export function isMemoryProviderCancellationError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === MEMORY_PROVIDER_CANCELLATION_CODE
}
