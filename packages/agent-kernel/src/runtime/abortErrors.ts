export const PENDING_INPUT_ABORT_REASON = 'pending_input'

export function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export function throwIfAbortRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
}
