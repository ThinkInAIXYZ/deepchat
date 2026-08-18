import type { ToolchainKind, ToolchainResolveReason } from '@shared/types/toolchains'

export class ToolchainResolutionError extends Error {
  readonly kind: ToolchainKind
  readonly reason: ToolchainResolveReason

  constructor(kind: ToolchainKind, reason: ToolchainResolveReason, message: string) {
    super(message)
    this.name = 'ToolchainResolutionError'
    this.kind = kind
    this.reason = reason
  }
}

export function isToolchainResolutionError(error: unknown): error is ToolchainResolutionError {
  return error instanceof ToolchainResolutionError
}
