import type { PermissionMode } from '@shared/types/agent-interface'
import type { ExecutionOperationIdentity } from '@/tape/domain/executionJournal'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  parseAgentCliProgrammaticExecInvocation
} from '@/cli/agentTokenAuthority'
import type {
  ProgrammaticToolParentRegistration,
  ProgrammaticToolParentRegistry
} from '@/cli/programmaticToolParentRegistry'
import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '@shared/contracts/localControl'
import {
  assertProgrammaticToolCapabilityDeferredDispatch,
  assertProgrammaticToolCapabilityViewActive,
  assertProgrammaticToolCapabilityViewCommitted,
  requireProgrammaticToolDeferredResumeCapability,
  type ProgrammaticToolCapabilityV1
} from './programmaticToolSurface'
import type { ToolSurfaceDeferredDispatch, ToolSurfaceSnapshot } from './toolSurface'

export function isProgrammaticExecAttempt(toolName: string, argumentsJson: string): boolean {
  if (toolName !== 'exec') return false
  try {
    const parsed = JSON.parse(argumentsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const args = parsed as Record<string, unknown>
    const command = typeof args.command === 'string' ? args.command : ''
    return (
      typeof args.stdin === 'string' ||
      /^deepchat tool (?:search|describe|call|batch)(?:\s|$)/.test(command)
    )
  } catch {
    return false
  }
}

export function prepareProgrammaticExecParent(input: {
  toolName: string
  argumentsJson: string
  operation: ExecutionOperationIdentity
  sessionId: string
  messageId: string
  permissionMode: PermissionMode
  toolSurfaceSnapshot?: ToolSurfaceSnapshot
  capability?: ProgrammaticToolCapabilityV1
  deferredDispatch?: ToolSurfaceDeferredDispatch
  parents?: Pick<ProgrammaticToolParentRegistry, 'prepare'>
}): ProgrammaticToolParentRegistration | undefined {
  if (!isProgrammaticExecAttempt(input.toolName, input.argumentsJson)) return undefined

  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(input.argumentsJson)
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    args = {}
  }
  const command = typeof args.command === 'string' ? args.command : ''
  const stdin = typeof args.stdin === 'string' ? args.stdin : undefined
  const deferredCapability = input.deferredDispatch
    ? requireProgrammaticToolDeferredResumeCapability(input.deferredDispatch)
    : undefined
  const capability = input.capability ?? deferredCapability
  const snapshot = input.toolSurfaceSnapshot ??
    (input.deferredDispatch?.authorityKind === 'process-live'
      ? input.deferredDispatch.snapshot
      : undefined)
  if (!capability || !snapshot || !input.parents) {
    throw new Error('Programmatic Tool exec requires its exact active View capability')
  }
  if (snapshot.adapterMode !== 'cli-programmatic') {
    throw new Error('Programmatic Tool exec requires a CLI Programmatic Tool Surface')
  }
  if (deferredCapability && deferredCapability !== capability) {
    throw new Error('Programmatic Tool deferred capability does not match its provider View')
  }
  if (args.background === true || args.yieldMs !== undefined) {
    throw new Error('Programmatic Tool exec must remain attached and foreground')
  }
  if (input.deferredDispatch) {
    assertProgrammaticToolCapabilityDeferredDispatch(capability, input.deferredDispatch)
  } else {
    assertProgrammaticToolCapabilityViewActive(capability, snapshot)
  }
  const invocation = parseAgentCliProgrammaticExecInvocation({ command, stdin })
  const suppliedRequestIdentity = input.operation as ExecutionOperationIdentity &
    Partial<{ sessionId: string; messageId: string }>
  if (
    (suppliedRequestIdentity.sessionId !== undefined &&
      suppliedRequestIdentity.sessionId !== input.sessionId) ||
    (suppliedRequestIdentity.messageId !== undefined &&
      suppliedRequestIdentity.messageId !== input.messageId)
  ) {
    throw new Error('Programmatic Tool exec operation identity does not match its request')
  }
  const operation = Object.freeze({
    ...input.operation,
    sessionId: input.sessionId,
    messageId: input.messageId
  })
  return input.parents.prepare({
    binding: {
      schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
      surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
      operation,
      command: invocation.command,
      route: invocation.route,
      canonicalInvocationHash: invocation.canonicalInvocationHash,
      adapterMode: capability.adapterMode,
      capabilityHash: capability.capabilityHash,
      programmaticSurfaceHash: capability.programmaticSurfaceHash,
      quotas: capability.quotas
    },
    invocationAuthority: {
      capability,
      snapshot,
      permissionMode: input.permissionMode
    },
    assertAuthorityActive: input.deferredDispatch
      ? () => assertProgrammaticToolCapabilityViewCommitted(capability, snapshot)
      : () => assertProgrammaticToolCapabilityViewActive(capability, snapshot)
  })
}
