import type {
  ToolchainDownloadReason,
  ToolchainKind,
  ToolchainResolveReason
} from '@shared/types/toolchains'

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

export class ToolchainDownloadError extends Error {
  readonly reason: ToolchainDownloadReason

  constructor(reason: ToolchainDownloadReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ToolchainDownloadError'
    this.reason = reason
  }
}

export function isToolchainResolutionError(error: unknown): error is ToolchainResolutionError {
  return error instanceof ToolchainResolutionError
}

export function isToolchainDownloadError(error: unknown): error is ToolchainDownloadError {
  return error instanceof ToolchainDownloadError
}

export function classifyDownloadError(error: unknown): ToolchainDownloadError {
  if (isToolchainDownloadError(error)) return error
  if (isAbortError(error)) {
    return new ToolchainDownloadError('cancelled', 'Download cancelled', { cause: error })
  }

  const code = errorCode(error)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return new ToolchainDownloadError('dns', 'Toolchain download DNS lookup failed', {
      cause: error
    })
  }
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT'
  ) {
    return new ToolchainDownloadError('timeout', 'Toolchain download timed out', { cause: error })
  }
  if (
    code === 'ENOSPC' ||
    code === 'EIO' ||
    code === 'EACCES' ||
    code === 'EROFS' ||
    code === 'EPERM' ||
    code === 'EBUSY' ||
    code === 'ENOTEMPTY'
  ) {
    return new ToolchainDownloadError('disk', 'Toolchain download could not write to disk', {
      cause: error
    })
  }
  if (looksLikeProxyError(error)) {
    return new ToolchainDownloadError('proxy', 'Toolchain download failed through the proxy', {
      cause: error
    })
  }
  return new ToolchainDownloadError('http', 'Toolchain download failed', { cause: error })
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  )
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  if (error instanceof Error && error.cause) return errorCode(error.cause)
  return undefined
}

function looksLikeProxyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('proxy') || errorCode(error) === 'UND_ERR_PROXY'
}
