/**
 * Minimal error classification for default diagnostics.
 *
 * Raw error objects and remote text can carry URLs, auth hints, commands, paths or user input and
 * must not reach default console logging. Default diagnostics log the operation, the server id
 * and this category only; detailed diagnostics belong to an explicitly injected host capability.
 */
export function errorCategory(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error'
  if (typeof error === 'string') return 'string'
  if (error === null || error === undefined) return 'absent'
  return typeof error
}
