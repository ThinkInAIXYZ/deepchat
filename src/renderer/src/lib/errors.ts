export function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\bAbortError\b|(?:^|:\s)Aborted(?:[.:]|$)|operation was aborted/i.test(message)
}
