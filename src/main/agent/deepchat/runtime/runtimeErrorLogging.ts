export interface RedactedRuntimeError {
  name: string
}

export function redactRuntimeErrorForLog(error: unknown): RedactedRuntimeError {
  return { name: error instanceof Error ? 'Error' : 'UnknownError' }
}
