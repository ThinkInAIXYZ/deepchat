import type { ProcessTerminalSelection } from './types'

export class CommittedRunProjectionError extends Error {
  readonly terminal: Pick<ProcessTerminalSelection, 'outcome' | 'stopReason' | 'errorMessage'>

  constructor(
    readonly runId: string,
    terminal: ProcessTerminalSelection,
    options?: ErrorOptions
  ) {
    const terminalLabel = `${terminal.outcome}/${terminal.stopReason}`
    super(
      `Run ${runId} committed terminal ${terminalLabel}, but its projection failed.`,
      options
    )
    this.name = 'CommittedRunProjectionError'
    this.terminal = {
      outcome: terminal.outcome,
      stopReason: terminal.stopReason,
      ...(terminal.errorMessage === undefined ? {} : { errorMessage: terminal.errorMessage })
    }
  }
}

export function isCommittedRunProjectionError(
  error: unknown
): error is CommittedRunProjectionError {
  return error instanceof CommittedRunProjectionError
}
