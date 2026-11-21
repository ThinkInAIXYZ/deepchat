import type { DimRuntimeDiagnostic } from './runtimeSupervisor'

const MAX_LOGGED_STDERR = 4096

/**
 * Bearer tokens, `key=value` style secrets and long opaque tokens are masked, so a native
 * crash tail can be logged without carrying provider credentials.
 */
export function redactDimStderr(value: string): string {
  return value
    .replace(/(authorization["']?\s*[:=][^\S\r\n]*)[^\r\n]+/giu, '$1***')
    .replace(/(bearer\s+)[^\s"',]+/giu, '$1***')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/giu, '$1***')
    .replace(/\b(?:sk|pk|rk|xai|gsk|AIza)[-_A-Za-z0-9]{12,}/gu, '***')
    .slice(-MAX_LOGGED_STDERR)
}

/**
 * Production sink for native host lifecycle events: routine phases stay silent, while failures
 * log their phase, exit state and a bounded, redacted stderr tail.
 */
export function createDimRuntimeDiagnostic(log: {
  warn(message: string, details: Record<string, unknown>): void
}) {
  return (event: DimRuntimeDiagnostic): void => {
    if (!event.detail) return
    log.warn('[dim] native host failure', {
      phase: event.phase,
      detail: redactDimStderr(event.detail),
      pid: event.pid,
      exitCode: event.exitCode,
      elapsedMs: event.elapsedMs,
      ...(event.stderr ? { stderr: redactDimStderr(event.stderr) } : {})
    })
  }
}
