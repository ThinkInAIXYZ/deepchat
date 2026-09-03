import { TAPE_COMPACTION_MODEL_CALL_EVENT_NAME } from './compactionUsage'
import { CONTRACT_TAPE_EVENT_NAMES, isContractTapeReservedName } from './contractFacts'
import type { DeepChatTapeAppendInput } from './entry'
import { EXECUTION_JOURNAL_EVENT_NAMES, isExecutionJournalReservedName } from './executionJournal'
import { TAPE_PROVIDER_ATTEMPT_EVENT_NAME } from './providerAttempt'
import { SKILL_MATERIALIZATION_NAME } from './skillMaterialization'
import { isToolSurfaceTapeReservedName } from './toolSurfaceFacts'

/**
 * Strict writers that own a slice of the Tape namespace. A generic append may not produce a
 * fact that belongs to one of them, and each strict writer may only produce its own facts.
 */
export type TapeReservedNamespace =
  | 'execution'
  | 'contract'
  | 'tool-surface'
  | 'skill-materialized'
  | 'provider-attempt'
  | 'compaction-usage'

/**
 * Rejects an append that crosses a namespace boundary. Every Tape store implementation,
 * including test doubles, runs this before persisting a row so the reserved set and the
 * strict-writer name sets have a single source of truth.
 */
export function assertTapeAppendAuthorized(
  { kind, name }: Pick<DeepChatTapeAppendInput, 'kind' | 'name'>,
  authorizedNamespace: TapeReservedNamespace | null
): void {
  if (authorizedNamespace) {
    const rejected = strictWriterRejection(authorizedNamespace, kind, name)
    if (rejected) throw new Error(`Unsupported ${rejected}: ${name}.`)
    return
  }
  if (isExecutionJournalReservedName(name)) {
    throw new Error(
      'The execution/* namespace is reserved for the strict Execution Journal writer.'
    )
  }
  if (isContractTapeReservedName(name)) {
    throw new Error('The contract/* namespace is reserved for the strict Contract writer.')
  }
  if (isToolSurfaceTapeReservedName(name)) {
    throw new Error('The View Tool Surface namespace is reserved for its provenance writer.')
  }
  if (name === SKILL_MATERIALIZATION_NAME) {
    throw new Error('skill/materialized is reserved for the strict materialization writer.')
  }
  if (kind === 'context') {
    throw new Error('The context entry kind is reserved for the strict materialization writer.')
  }
  if (name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME) {
    throw new Error(
      'provider/attempt_completed is reserved for the strict provider-attempt writer.'
    )
  }
  if (name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME) {
    throw new Error(
      'compaction/model_call_completed is reserved for the strict compaction-usage writer.'
    )
  }
}

/** Names the rejected fact when a strict writer steps outside its own facts; null when allowed. */
function strictWriterRejection(
  namespace: TapeReservedNamespace,
  kind: DeepChatTapeAppendInput['kind'],
  name: DeepChatTapeAppendInput['name']
): string | null {
  switch (namespace) {
    case 'execution':
      return (EXECUTION_JOURNAL_EVENT_NAMES as readonly string[]).includes(name ?? '')
        ? null
        : 'Execution Journal event name'
    case 'contract':
      return (CONTRACT_TAPE_EVENT_NAMES as readonly string[]).includes(name ?? '')
        ? null
        : 'Contract event name'
    case 'tool-surface':
      return isToolSurfaceTapeReservedName(name) ? null : 'View Tool Surface event name'
    case 'skill-materialized':
      return kind === 'context' && name === SKILL_MATERIALIZATION_NAME
        ? null
        : 'Skill materialization fact'
    case 'provider-attempt':
      return name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME ? null : 'provider-attempt event name'
    case 'compaction-usage':
      return name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME ? null : 'compaction-usage event name'
  }
}
