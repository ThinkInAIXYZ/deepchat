/** Thrown when a programmatic CLI launch cannot prove authoritative settlement for its command. */
export class ProgrammaticCommandLaunchError extends Error {
  constructor(options?: ErrorOptions) {
    super('Programmatic CLI launch did not reach authoritative settlement', options)
    this.name = 'ProgrammaticCommandLaunchError'
  }
}

export function isProgrammaticCommandLaunchError(
  error: unknown
): error is ProgrammaticCommandLaunchError {
  return error instanceof ProgrammaticCommandLaunchError
}
