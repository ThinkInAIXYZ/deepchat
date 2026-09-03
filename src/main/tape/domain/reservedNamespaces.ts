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

type ReservedAppendInput = Pick<DeepChatTapeAppendInput, 'kind' | 'name'>

const includesName = (names: readonly string[], name: string | null | undefined) =>
  typeof name === 'string' && names.includes(name)

/** What each strict writer is allowed to append, and how an off-namespace name is reported. */
const STRICT_WRITER_FACTS: Record<
  TapeReservedNamespace,
  { accepts: (input: ReservedAppendInput) => boolean; label: string }
> = {
  execution: {
    accepts: ({ name }) => includesName(EXECUTION_JOURNAL_EVENT_NAMES, name),
    label: 'Execution Journal event name'
  },
  contract: {
    accepts: ({ name }) => includesName(CONTRACT_TAPE_EVENT_NAMES, name),
    label: 'Contract event name'
  },
  'tool-surface': {
    accepts: ({ name }) => isToolSurfaceTapeReservedName(name),
    label: 'View Tool Surface event name'
  },
  'skill-materialized': {
    accepts: ({ kind, name }) => kind === 'context' && name === SKILL_MATERIALIZATION_NAME,
    label: 'Skill materialization fact'
  },
  'provider-attempt': {
    accepts: ({ name }) => name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
    label: 'provider-attempt event name'
  },
  'compaction-usage': {
    accepts: ({ name }) => name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME,
    label: 'compaction-usage event name'
  }
}

/**
 * Rejects an append that crosses a namespace boundary. Every Tape store implementation,
 * including test doubles, runs this before persisting a row so the reserved set and the
 * strict-writer name sets have a single source of truth.
 */
export function assertTapeAppendAuthorized(
  input: ReservedAppendInput,
  authorizedNamespace: TapeReservedNamespace | null
): void {
  if (authorizedNamespace) {
    const writer = STRICT_WRITER_FACTS[authorizedNamespace]
    if (!writer.accepts(input)) {
      throw new Error(`Unsupported ${writer.label}: ${input.name}.`)
    }
    return
  }
  if (isExecutionJournalReservedName(input.name)) {
    throw new Error(
      'The execution/* namespace is reserved for the strict Execution Journal writer.'
    )
  }
  if (isContractTapeReservedName(input.name)) {
    throw new Error('The contract/* namespace is reserved for the strict Contract writer.')
  }
  if (isToolSurfaceTapeReservedName(input.name)) {
    throw new Error('The View Tool Surface namespace is reserved for its provenance writer.')
  }
  if (input.name === SKILL_MATERIALIZATION_NAME) {
    throw new Error('skill/materialized is reserved for the strict materialization writer.')
  }
  if (input.kind === 'context') {
    throw new Error('The context entry kind is reserved for the strict materialization writer.')
  }
  if (input.name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME) {
    throw new Error(
      'provider/attempt_completed is reserved for the strict provider-attempt writer.'
    )
  }
  if (input.name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME) {
    throw new Error(
      'compaction/model_call_completed is reserved for the strict compaction-usage writer.'
    )
  }
}
