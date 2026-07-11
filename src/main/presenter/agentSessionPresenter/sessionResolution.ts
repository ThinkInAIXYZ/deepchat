import logger from '@shared/logger'
import type {
  SessionResolutionResult,
  SessionResolutionStage
} from '@shared/types/presenters/agent-session.presenter'
import type { SessionRecord, SessionWithState } from '@shared/types/agent-interface'

export type TerminalSessionResolution = Exclude<
  SessionResolutionResult,
  { availability: 'available' }
>

export class SessionResolutionError extends Error {
  readonly code: 'SESSION_MISSING' | 'SESSION_UNAVAILABLE' | 'SESSION_RESOLUTION_FAILED'
  readonly availability: TerminalSessionResolution['availability']
  readonly sessionId: string
  readonly stage: SessionResolutionStage
  readonly retryable: boolean

  constructor(operation: string, resolution: TerminalSessionResolution) {
    const metadata = getTerminalSessionResolutionMetadata(resolution)
    super(`${metadata.code}: ${operation} (${resolution.sessionId})`)
    this.name = 'SessionResolutionError'
    this.code = metadata.code
    this.availability = resolution.availability
    this.sessionId = resolution.sessionId
    this.stage = metadata.stage
    this.retryable = resolution.availability === 'transient_error'
  }
}

export function getAvailableSession(resolution: SessionResolutionResult): SessionWithState | null {
  return resolution.availability === 'available' ? resolution.session : null
}

export function getResolutionRecord(resolution: SessionResolutionResult): SessionRecord | null {
  if (resolution.availability === 'available') {
    return resolution.session
  }
  return 'record' in resolution ? resolution.record : null
}

export function requireAvailableSession(
  operation: string,
  resolution: SessionResolutionResult,
  attemptCount: number = 1
): SessionWithState {
  if (resolution.availability === 'available') {
    return resolution.session
  }

  reportTerminalSessionResolution(operation, resolution, attemptCount)
  throw new SessionResolutionError(operation, resolution)
}

export function reportTerminalSessionResolution(
  operation: string,
  resolution: SessionResolutionResult,
  attemptCount: number = 1
): void {
  if (resolution.availability === 'available') {
    return
  }

  const metadata = getTerminalSessionResolutionMetadata(resolution)
  logger.warn('[SessionResolution] Terminal lookup', {
    operation,
    sessionId: resolution.sessionId,
    availability: resolution.availability,
    stage: metadata.stage,
    code: metadata.code,
    retryable: resolution.availability === 'transient_error',
    attemptCount
  })
}

function getTerminalSessionResolutionMetadata(resolution: TerminalSessionResolution): {
  code: 'SESSION_MISSING' | 'SESSION_UNAVAILABLE' | 'SESSION_RESOLUTION_FAILED'
  stage: SessionResolutionStage
} {
  switch (resolution.availability) {
    case 'missing':
      return { code: 'SESSION_MISSING', stage: 'record_read' }
    case 'unavailable':
      return { code: 'SESSION_UNAVAILABLE', stage: 'agent_lookup' }
    case 'transient_error':
      return { code: resolution.error.code, stage: resolution.error.stage }
  }
}
