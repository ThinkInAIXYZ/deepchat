import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '../shared/contracts/localControl.js'
import type { LocalControlScope } from '../shared/contracts/localControl.js'
import {
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute
} from '../shared/contracts/routes/tools.routes.js'
import type { PermissionMode } from '../shared/types/agent-interface.js'
import { hashJsonData } from '../tape/domain/canonicalJson.js'
import type { ExecutionJournalCommitReceipt } from '../tape/domain/executionJournal.js'
import { MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES } from '../tape/domain/toolSurfaceFacts.js'
import type { ProgrammaticToolCapabilityV1 } from '../runtime/programmaticToolSurface.js'
import type { ToolSurfaceSnapshot } from '../runtime/toolSurface.js'
import { parseBoundedJsonBytes } from './localControlProtocol.js'

const PROGRAMMATIC_TOOL_SAFE_SCALAR_PATTERN = /^[\p{L}\p{N}_.:@/,+-]+$/u
const PROGRAMMATIC_TOOL_SAFE_QUERY_PATTERN = /^[\p{L}\p{N}_.:@/,+-]+(?: [\p{L}\p{N}_.:@/,+-]+)*$/u
const PROGRAMMATIC_TOOL_CANONICAL_LIMIT_PATTERN = /^[1-9][0-9]*$/

export const AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION = 1 as const

export type AgentCliProgrammaticToolVerb = 'search' | 'describe' | 'call' | 'batch'

export type AgentCliProgrammaticInvocation = Readonly<{
  command: Readonly<{
    domain: 'tool'
    verb: AgentCliProgrammaticToolVerb
  }>
  route: `tool.${AgentCliProgrammaticToolVerb}`
  canonicalInvocationHash: string
}>

export type AgentCliProgrammaticOperationIdentity = Readonly<{
  sessionId: string
  messageId: string
  runId: string
  requestSeq: number
  providerToolCallId: string
}>

export type AgentCliProgrammaticGrantQuotas = Readonly<{
  maxChildren: number
  maxBatchSteps: number
  maxInputBytes: number
  maxOutputBytes: number
  maxDurationMs: number
}>

export type AgentCliProgrammaticOperationBinding = Readonly<{
  schemaVersion: typeof AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION
  surfaceVersion: typeof LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION
  operation: AgentCliProgrammaticOperationIdentity
  command: Readonly<{
    domain: 'tool'
    verb: AgentCliProgrammaticToolVerb
  }>
  route: AgentCliProgrammaticInvocation['route']
  canonicalInvocationHash: string
  adapterMode: 'cli-programmatic'
  capabilityHash: string
  programmaticSurfaceHash: string
  quotas: AgentCliProgrammaticGrantQuotas
}>

export type AgentCliOuterDispatchReceipt = Readonly<{
  sessionId: string
  entryId: number
  created: boolean
  preparedTokenId: string
  operation: AgentCliProgrammaticOperationIdentity
}>

export type AgentCliProgrammaticOperationGrant = AgentCliProgrammaticOperationBinding &
  Readonly<{
    outerDispatchReceipt: Readonly<{
      sessionId: string
      entryId: number
    }>
  }>

export type AgentCliTokenClaims = Readonly<{
  tokenId: string
  conversationId: string
  expiresAt: number
  scopes: readonly LocalControlScope[]
  programmaticOperation?: AgentCliProgrammaticOperationGrant
}>

export type IssuedAgentCliToken = AgentCliTokenClaims &
  Readonly<{
    token: string
    maxCalls: number
    maxBytes: number
  }>

export type ArmedAgentCliProgrammaticToken = IssuedAgentCliToken &
  Readonly<{
    programmaticOperation: AgentCliProgrammaticOperationGrant
  }>

export type PreparedAgentCliProgrammaticGrant = Readonly<{
  tokenId: string
  conversationId: string
  expiresAt: number
  operation: AgentCliProgrammaticOperationIdentity
  binding: AgentCliProgrammaticOperationBinding
  arm(receipt: AgentCliOuterDispatchReceipt): ArmedAgentCliProgrammaticToken
  revoke(): void
}>

export type ProgrammaticCompletedInvocationResult = Readonly<{
  responseText: string
  isError: boolean
}>

export type ProgrammaticToolInvocationAuthority = Readonly<{
  capability: ProgrammaticToolCapabilityV1
  snapshot: ToolSurfaceSnapshot
  permissionMode: PermissionMode
  assertAuthorityActive(): void
}>

export type ProgrammaticToolParentRunIdentity = Readonly<{
  sessionId: string
  runId: string
}>

export type ProgrammaticToolParentRegistration = Readonly<{
  operation: AgentCliProgrammaticOperationIdentity
  armOuterDispatch(
    receipt: ExecutionJournalCommitReceipt & { operation: AgentCliProgrammaticOperationIdentity }
  ): void
  takeArmedToken(): ArmedAgentCliProgrammaticToken
  takeCompletedInvocationResult(): ProgrammaticCompletedInvocationResult
  cancelBeforeOuterDispatch(): void
  settleProcessFailure(input: { responseText: string }): Readonly<{
    result: ProgrammaticCompletedInvocationResult
    receipt: ExecutionJournalCommitReceipt
  }>
  settleOuterOutcome(input: {
    responseText: string
    isError: boolean
  }): ExecutionJournalCommitReceipt
}>

/**
 * Process-live parent authority the built-in kernel drives during programmatic exec dispatch and
 * run settlement. The host registry implements it.
 */
export interface ProgrammaticToolAuthorityPort {
  prepare(input: {
    binding: AgentCliProgrammaticOperationBinding
    assertAuthorityActive: () => void
    invocationAuthority?: Omit<ProgrammaticToolInvocationAuthority, 'assertAuthorityActive'>
  }): ProgrammaticToolParentRegistration
  commitRunTerminal(
    run: ProgrammaticToolParentRunIdentity,
    commit: () => ExecutionJournalCommitReceipt
  ): ExecutionJournalCommitReceipt
  releaseSession(sessionId: string): void
}

/**
 * Local-control grant authority the built-in kernel needs for Run-scoped revocation. The host CLI
 * token authority implements it.
 */
export interface ProgrammaticGrantAuthorityPort {
  prepareProgrammaticOperation(
    input: Readonly<{
      binding: AgentCliProgrammaticOperationBinding
      ttlMs?: number
      assertAuthorityActive: () => void
    }>
  ): PreparedAgentCliProgrammaticGrant
  revokeConversation(conversationId: string): void
}

function parseCanonicalProgrammaticSearchCommand(
  command: string
): Readonly<{ query: string; limit?: number }> | null {
  const prefix = 'deepchat tool search --query '
  if (!command.startsWith(prefix)) return null
  const argumentsText = command.slice(prefix.length)
  let query: string
  let remainder: string
  if (argumentsText.startsWith('"')) {
    const closingQuote = argumentsText.indexOf('"', 1)
    if (closingQuote < 0) return null
    query = argumentsText.slice(1, closingQuote)
    remainder = argumentsText.slice(closingQuote + 1)
  } else {
    const separator = argumentsText.indexOf(' ')
    query = separator < 0 ? argumentsText : argumentsText.slice(0, separator)
    remainder = separator < 0 ? '' : argumentsText.slice(separator)
  }
  if (!PROGRAMMATIC_TOOL_SAFE_QUERY_PATTERN.test(query) || query.startsWith('-')) return null
  if (!remainder) return Object.freeze({ query })
  const limitMatch = /^ --limit ([1-9][0-9]*)$/.exec(remainder)
  if (!limitMatch || !PROGRAMMATIC_TOOL_CANONICAL_LIMIT_PATTERN.test(limitMatch[1])) return null
  return Object.freeze({ query, limit: Number(limitMatch[1]) })
}

function parseCanonicalProgrammaticDescribeCommand(command: string): string | null {
  const prefix = 'deepchat tool describe --target '
  if (!command.startsWith(prefix)) return null
  const argumentText = command.slice(prefix.length)
  let target = argumentText
  if (argumentText.startsWith('"')) {
    if (argumentText.length < 3 || !argumentText.endsWith('"')) return null
    target = argumentText.slice(1, -1)
  }
  if (!PROGRAMMATIC_TOOL_SAFE_SCALAR_PATTERN.test(target) || target.startsWith('-')) return null
  return target
}

export function buildAgentCliProgrammaticInvocationHash(input: {
  command: Readonly<{ domain: 'tool'; verb: AgentCliProgrammaticToolVerb }>
  route: `tool.${AgentCliProgrammaticToolVerb}`
  params: Readonly<Record<string, unknown>>
}): string {
  if (input.route !== `tool.${input.command.verb}`) {
    throw new Error('Programmatic Tool invocation route does not match its command')
  }
  return hashJsonData({
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    command: input.command,
    route: input.route,
    params: input.params
  })
}

/**
 * Parses a canonical programmatic exec invocation (the `deepchat tool …` command a model supplies
 * to the exec tool). Pure; lives in kernel contracts so the exec parent can validate invocations
 * without importing the CLI token authority host module.
 */
export function parseAgentCliProgrammaticExecInvocation(input: {
  command: string
  stdin?: string
}): AgentCliProgrammaticInvocation {
  const command = input.command
  const tokens = command.split(' ')
  if (
    tokens.some((token) => token.length === 0) ||
    tokens[0] !== 'deepchat' ||
    tokens[1] !== 'tool'
  ) {
    throw new Error('Programmatic Tool exec requires one canonical DeepChat Tool command')
  }

  const verb = tokens[2]
  let parsed: Readonly<Record<string, unknown>>
  if (verb === 'search') {
    const search = parseCanonicalProgrammaticSearchCommand(command)
    if (input.stdin !== undefined || !search) {
      throw new Error('Programmatic Tool search requires canonical bounded scalar arguments')
    }
    parsed = toolSearchRoute.input.parse(search)
  } else if (verb === 'describe') {
    const target = parseCanonicalProgrammaticDescribeCommand(command)
    if (input.stdin !== undefined || !target) {
      throw new Error(
        'Programmatic Tool describe requires one unquoted or exact double-quoted safe target'
      )
    }
    parsed = toolDescribeRoute.input.parse({ target })
  } else if (verb === 'call' || verb === 'batch') {
    if (tokens.length !== 3 || input.stdin === undefined) {
      throw new Error('Programmatic Tool call and batch require an exact command and owned stdin')
    }
    const stdinBytes = Buffer.from(input.stdin, 'utf8')
    if (stdinBytes.length > MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES) {
      throw new Error('Programmatic Tool stdin exceeds its supported byte limit')
    }
    const parsedBody = parseBoundedJsonBytes(stdinBytes)
    parsed = (verb === 'call' ? toolCallRoute : toolBatchRoute).input.parse(parsedBody)
  } else {
    throw new Error('Programmatic Tool exec command is unsupported')
  }

  const invocationCommand = Object.freeze({
    domain: 'tool' as const,
    verb: verb as AgentCliProgrammaticToolVerb
  })
  const route = `tool.${verb}` as const
  return Object.freeze({
    command: invocationCommand,
    route,
    canonicalInvocationHash: buildAgentCliProgrammaticInvocationHash({
      command: invocationCommand,
      route,
      params: parsed
    })
  })
}
