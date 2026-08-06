import type { JsonValue } from '@shared/contracts/common'
import type { LocalControlErrorCode } from '@shared/contracts/localControl'

export class CliRequestError extends Error {
  constructor(
    readonly code: LocalControlErrorCode,
    message: string,
    readonly options: {
      httpStatus?: number
      retriable?: boolean
      details?: Record<string, JsonValue>
    } = {}
  ) {
    super(message)
    this.name = 'CliRequestError'
  }

  get httpStatus(): number {
    return this.options.httpStatus ?? 400
  }

  get retriable(): boolean {
    return this.options.retriable ?? false
  }
}
