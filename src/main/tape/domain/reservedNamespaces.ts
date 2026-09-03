import { TAPE_COMPACTION_MODEL_CALL_EVENT_NAME } from './compactionUsage'
import { isContractTapeReservedName } from './contractFacts'
import type { DeepChatTapeEntryKind } from './entry'
import { isExecutionJournalReservedName } from './executionJournal'
import { TAPE_PROVIDER_ATTEMPT_EVENT_NAME } from './providerAttempt'
import { SKILL_MATERIALIZATION_NAME } from './skillMaterialization'
import { isToolSurfaceTapeReservedName } from './toolSurfaceFacts'

/**
 * Strict writers that own a slice of the Tape namespace. A generic append may not
 * produce a fact that belongs to one of them; each writer passes its own namespace
 * when it appends.
 */
export type TapeReservedNamespace =
  | 'execution'
  | 'contract'
  | 'tool-surface'
  | 'skill-materialized'
  | 'provider-attempt'
  | 'compaction-usage'

export interface TapeReservedAppendInput {
  kind: DeepChatTapeEntryKind
  name?: string | null
}

interface TapeReservedAppendRule {
  namespace: TapeReservedNamespace
  matches: (input: TapeReservedAppendInput) => boolean
  message: string
}

const RESERVED_APPEND_RULES: readonly TapeReservedAppendRule[] = [
  {
    namespace: 'execution',
    matches: ({ name }) => isExecutionJournalReservedName(name),
    message: 'The execution/* namespace is reserved for the strict Execution Journal writer.'
  },
  {
    namespace: 'contract',
    matches: ({ name }) => isContractTapeReservedName(name),
    message: 'The contract/* namespace is reserved for the strict Contract writer.'
  },
  {
    namespace: 'tool-surface',
    matches: ({ name }) => isToolSurfaceTapeReservedName(name),
    message: 'The View Tool Surface namespace is reserved for its provenance writer.'
  },
  {
    namespace: 'skill-materialized',
    matches: ({ name }) => name === SKILL_MATERIALIZATION_NAME,
    message: 'skill/materialized is reserved for the strict materialization writer.'
  },
  {
    namespace: 'skill-materialized',
    matches: ({ kind }) => kind === 'context',
    message: 'The context entry kind is reserved for the strict materialization writer.'
  },
  {
    namespace: 'provider-attempt',
    matches: ({ name }) => name === TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
    message: 'provider/attempt_completed is reserved for the strict provider-attempt writer.'
  },
  {
    namespace: 'compaction-usage',
    matches: ({ name }) => name === TAPE_COMPACTION_MODEL_CALL_EVENT_NAME,
    message: 'compaction/model_call_completed is reserved for the strict compaction-usage writer.'
  }
]

/**
 * Rejects an append that targets a reserved namespace unless the caller is that
 * namespace's strict writer. Every Tape store implementation, including test
 * doubles, must run this before persisting a row so that the reserved set has a
 * single source of truth.
 */
export function assertTapeAppendAuthorized(
  input: TapeReservedAppendInput,
  authorizedNamespace: TapeReservedNamespace | null
): void {
  for (const rule of RESERVED_APPEND_RULES) {
    if (rule.namespace !== authorizedNamespace && rule.matches(input)) {
      throw new Error(rule.message)
    }
  }
}
