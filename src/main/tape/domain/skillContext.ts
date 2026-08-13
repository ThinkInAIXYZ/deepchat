import type {
  DeepChatTapeSkillContext,
  DeepChatTapeSkillContextV7,
  DeepChatTapeSkillMaterializationRef
} from '@shared/types/tape-view-manifest'
import { isSkillSourceType } from '@shared/types/skillManagement'
import { SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES } from '@shared/types/skill'
import type { DeepChatTapeEntryRow } from './entry'
import type { TapeSkillIdentity } from './skillMaterialization'
import {
  buildExecutionOperationKey,
  buildToolOutcomeData,
  normalizeExecutionOperationIdentity,
  parseExecutionJournalFact,
  type ExecutionOperationIdentity
} from './executionJournal'
import { hashJsonData } from './canonicalJson'
import { isBoundedSkillTapeIdentity } from './skillIdentity'

const HASH = /^[a-f0-9]{64}$/
const MAX_SOURCE_REFS = 64
export const MAX_SKILL_CONTEXTS_PER_VIEW = 64
export const MAX_SKILL_VIEW_RESULT_FACT_BYTES = SKILL_RUNTIME_VIEW_RESULT_MAX_BYTES

export interface TapeSkillViewResultFactInput {
  sessionId: string
  expectedTapeIncarnationId: string
  messageId: string
  orderSeq: number
  blockIndex: number
  toolCallId: string
  toolName: 'skill_view'
  responseText: string
  timestamp: number
  identity: TapeSkillIdentity
  operation: ExecutionOperationIdentity
  outcomeEntryId: number
}

export interface TapeSkillViewResultFactReceipt {
  sessionId: string
  entryId: number
  tapeIncarnationId: string
  contentHash: string
}

export interface TapeRuntimeSkillViewProjection {
  toolCallId: string
  responseText: string
  blockIndex: number
  timestamp: number
}

export interface TapeRuntimeSkillViewRecoveryInput {
  sessionId: string
  messageId: string
  messageOrderSeq: number
  expectedTapeIncarnationId: string
  projections: readonly TapeRuntimeSkillViewProjection[]
}

export interface TapeRuntimeSkillViewContextReceipt {
  identity: TapeSkillIdentity
  toolCallId: string
  entryId: number
  tapeIncarnationId: string
  contentHash: string
  executionRef: DeepChatTapeSkillMaterializationRef
}

export interface TapeSkillContextEvidence {
  schemaVersion: 1
  identity: TapeSkillIdentity
  operation: ExecutionOperationIdentity
  outcomeEntryId: number
}

export type TapeSkillContextEvidenceInput = Omit<TapeSkillContextEvidence, 'schemaVersion'>

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function readSkillContentIdentity(value: unknown): TapeSkillIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Skill content identity is invalid.')
  }
  const identity = value as Record<string, unknown>
  if (
    Object.keys(identity).sort().join('\0') !==
      ['agentId', 'skillName', 'sourceId', 'sourceType'].sort().join('\0') ||
    !isBoundedSkillTapeIdentity(identity.agentId) ||
    !isSkillSourceType(identity.sourceType) ||
    !isBoundedSkillTapeIdentity(identity.sourceId) ||
    !isBoundedSkillTapeIdentity(identity.skillName)
  ) {
    throw new TypeError('Skill content identity is invalid.')
  }
  return {
    agentId: identity.agentId,
    sourceType: identity.sourceType,
    sourceId: identity.sourceId,
    skillName: identity.skillName
  }
}

export function readSkillContextEvidence(value: unknown): TapeSkillContextEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Skill context evidence is invalid.')
  }
  const evidence = value as Record<string, unknown>
  if (
    Object.keys(evidence).sort().join('\0') !==
      ['identity', 'operation', 'outcomeEntryId', 'schemaVersion'].sort().join('\0') ||
    evidence.schemaVersion !== 1 ||
    !positive(evidence.outcomeEntryId)
  ) {
    throw new TypeError('Skill context evidence is invalid.')
  }
  return {
    schemaVersion: 1,
    identity: readSkillContentIdentity(evidence.identity),
    operation: normalizeExecutionOperationIdentity(
      evidence.operation as ExecutionOperationIdentity
    ),
    outcomeEntryId: evidence.outcomeEntryId
  }
}

export function validateRuntimeSkillJournalChain(input: {
  sessionId: string
  messageId: string
  toolCallId: string
  responseText: string
  evidence: unknown
  dispatchRow: DeepChatTapeEntryRow
  outcomeRow: DeepChatTapeEntryRow
}): TapeSkillContextEvidence {
  const evidence = readSkillContextEvidence(input.evidence)
  if (evidence.operation.providerToolCallId !== input.toolCallId) {
    throw new Error('Runtime Skill-view Journal operation does not match its tool result.')
  }
  let result: Record<string, unknown>
  try {
    const parsed = JSON.parse(input.responseText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    result = parsed as Record<string, unknown>
  } catch {
    throw new Error('Runtime Skill-view result envelope is invalid.')
  }
  if (
    result.success !== true ||
    typeof result.name !== 'string' ||
    result.name !== evidence.identity.skillName ||
    typeof result.content !== 'string' ||
    !result.content ||
    result.activatedForMessage !== true ||
    result.activationScope !== 'message' ||
    result.activationEvidenceVersion !== 1
  ) {
    throw new Error('Runtime Skill-view result does not match its activation identity.')
  }
  const dispatch = parseExecutionJournalFact(input.dispatchRow)
  const outcome = parseExecutionJournalFact(input.outcomeRow)
  const expected = buildToolOutcomeData({
    sessionId: input.sessionId,
    messageId: input.messageId,
    operation: evidence.operation,
    responseText: input.responseText,
    isError: false
  })
  if (
    dispatch.type !== 'execution/dispatch_committed' ||
    dispatch.sessionId !== input.sessionId ||
    dispatch.messageId !== input.messageId ||
    buildExecutionOperationKey(dispatch.operation) !==
      buildExecutionOperationKey(expected.operation) ||
    dispatch.toolName !== 'skill_view' ||
    dispatch.toolSource !== 'agent' ||
    dispatch.target.serverName !== 'agent-skills' ||
    dispatch.target.originalName !== 'skill_view' ||
    dispatch.argumentsHash !== hashJsonData({ name: evidence.identity.skillName }) ||
    dispatch.entryId >= outcome.entryId ||
    outcome.type !== 'execution/tool_outcome' ||
    outcome.entryId !== evidence.outcomeEntryId ||
    outcome.sessionId !== input.sessionId ||
    outcome.messageId !== input.messageId ||
    buildExecutionOperationKey(outcome.operation) !==
      buildExecutionOperationKey(expected.operation) ||
    outcome.responseHash !== expected.responseHash ||
    outcome.isError
  ) {
    throw new Error('Runtime Skill-view Journal chain does not match its exact result.')
  }
  return evidence
}

function validateMaterializationRef(
  ref: DeepChatTapeSkillMaterializationRef,
  context: Pick<DeepChatTapeSkillContext, 'agentId' | 'sourceType' | 'sourceId' | 'skillName'>,
  projectedContentHash?: string
): void {
  const refKeys = [
    'agentId',
    'effectiveContentHash',
    'entryId',
    'kind',
    'skillName',
    'sourceId',
    'sourceType',
    'tapeIncarnationId'
  ]
  if (
    Object.keys(ref).sort().join('\0') !== refKeys.sort().join('\0') ||
    ref.kind !== 'materialization' ||
    !positive(ref.entryId) ||
    !isBoundedSkillTapeIdentity(ref.tapeIncarnationId) ||
    !isBoundedSkillTapeIdentity(ref.agentId) ||
    !isSkillSourceType(ref.sourceType) ||
    !isBoundedSkillTapeIdentity(ref.sourceId) ||
    !isBoundedSkillTapeIdentity(ref.skillName) ||
    !HASH.test(ref.effectiveContentHash) ||
    (projectedContentHash !== undefined && projectedContentHash !== ref.effectiveContentHash) ||
    ref.agentId !== context.agentId ||
    ref.sourceType !== context.sourceType ||
    ref.sourceId !== context.sourceId ||
    ref.skillName !== context.skillName
  ) {
    throw new TypeError('Invalid Skill materialization reference.')
  }
}

function validateSkillContexts(
  value: unknown,
  schemaVersion: 6 | 7
): DeepChatTapeSkillContext[] | DeepChatTapeSkillContextV7[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKILL_CONTEXTS_PER_VIEW) {
    throw new TypeError(
      `Schema-${schemaVersion} Skill contexts must contain between 1 and 64 entries.`
    )
  }
  const identities = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new TypeError('Invalid Skill context.')
    const context = item as unknown as DeepChatTapeSkillContext
    const ref = context.authoritativeRef
    const contextKeys = [
      'activationScope',
      'agentId',
      'authoritativeRef',
      'deduplicationSource',
      'projectedContentHash',
      'projectionVersion',
      'providerRole',
      'skillName',
      'sourceEntryIds',
      'sourceId',
      'sourceType'
    ]
    if (schemaVersion === 7 && context.activationScope === 'runtime_view') {
      contextKeys.push('executionRef')
    }
    if (
      Object.keys(item).sort().join('\0') !== contextKeys.sort().join('\0') ||
      !isBoundedSkillTapeIdentity(context.agentId) ||
      !isSkillSourceType(context.sourceType) ||
      !isBoundedSkillTapeIdentity(context.sourceId) ||
      !isBoundedSkillTapeIdentity(context.skillName) ||
      !ref ||
      !positive(ref.entryId) ||
      typeof context.projectedContentHash !== 'string' ||
      !HASH.test(context.projectedContentHash) ||
      !positive(context.projectionVersion) ||
      !Array.isArray(context.sourceEntryIds) ||
      context.sourceEntryIds.length > MAX_SOURCE_REFS ||
      !context.sourceEntryIds.every(positive) ||
      new Set(context.sourceEntryIds).size !== context.sourceEntryIds.length
    )
      throw new TypeError('Invalid Skill context identity, hash, or source refs.')
    const identity = [
      context.agentId,
      context.sourceType,
      context.sourceId,
      context.skillName
    ].join('\0')
    if (identities.has(identity)) throw new TypeError('Duplicate canonical Skill context identity.')
    identities.add(identity)
    if (context.activationScope === 'runtime_view') {
      const runtimeContext = context as DeepChatTapeSkillContextV7 & {
        executionRef?: DeepChatTapeSkillMaterializationRef
      }
      const refKeys = ['contentHash', 'entryId', 'kind']
      if (
        Object.keys(ref).sort().join('\0') !== refKeys.sort().join('\0') ||
        context.providerRole !== 'tool' ||
        ref.kind !== 'tool_result' ||
        typeof ref.contentHash !== 'string' ||
        !HASH.test(ref.contentHash) ||
        context.projectedContentHash !== ref.contentHash ||
        context.deduplicationSource !== 'runtime_view'
      )
        throw new TypeError('Invalid runtime-view Skill context.')
      if (schemaVersion === 7) {
        if (!runtimeContext.executionRef) {
          throw new TypeError('Schema-7 runtime-view Skill context requires execution authority.')
        }
        validateMaterializationRef(runtimeContext.executionRef, context)
      }
    } else if (context.activationScope === 'message' || context.activationScope === 'session') {
      const expectedRole = context.activationScope === 'message' ? 'user' : 'system'
      if (
        context.providerRole !== expectedRole ||
        ref.kind !== 'materialization' ||
        context.deduplicationSource !== context.activationScope ||
        (context.activationScope === 'message'
          ? context.sourceEntryIds.length !== 1
          : context.sourceEntryIds.length !== 0)
      ) {
        throw new TypeError('Invalid materialized Skill context.')
      }
      validateMaterializationRef(ref, context, context.projectedContentHash)
    } else throw new TypeError('Invalid Skill activation scope.')
    return context
  })
}

export function validateSchema6SkillContexts(value: unknown): DeepChatTapeSkillContext[] {
  return validateSkillContexts(value, 6) as DeepChatTapeSkillContext[]
}

export function validateSchema7SkillContexts(value: unknown): DeepChatTapeSkillContextV7[] {
  const contexts = validateSkillContexts(value, 7) as DeepChatTapeSkillContextV7[]
  if (!contexts.some((context) => context.activationScope === 'runtime_view')) {
    throw new TypeError('Schema-7 Skill contexts require executable runtime-view authority.')
  }
  return contexts
}
