import { TAPE_COMPACTION_MODEL_CALL_EVENT_NAME } from './compactionUsage'
import { CONTRACT_TAPE_EVENT_NAMES, isContractTapeReservedName } from './contractFacts'
import type { DeepChatTapeAppendInput, DeepChatTapeEntryKind } from './entry'
import { EXECUTION_JOURNAL_EVENT_NAMES, isExecutionJournalReservedName } from './executionJournal'
import { TAPE_PROVIDER_ATTEMPT_EVENT_NAME } from './providerAttempt'
import { SKILL_MATERIALIZATION_NAME } from './skillMaterialization'
import { TOOL_SURFACE_TAPE_EVENT_NAMES } from './toolSurfaceFacts'

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

/** Everything one strict writer's slice declares about itself. */
interface TapeReservedNamespaceRule {
  /** The exact fact names the strict writer may append. */
  readonly names: readonly string[]
  /** Entry kind the slice is bound to: generic appends of that kind are rejected as a whole. */
  readonly kind?: DeepChatTapeEntryKind
  /** Widens the generic rejection beyond `names`, so unknown sibling names stay reserved. */
  readonly reservesName?: (name: string) => boolean
  /**
   * Whether the slice's event facts are audit evidence, kept out of effective views and ordinary
   * search unless a reader asks for audit events explicitly.
   */
  readonly auditEvents: boolean
  /** Error for a generic append that lands in the slice by name. */
  readonly genericRejection: string
  /** Error for a generic append that lands in the slice by kind alone; defaults to the name error. */
  readonly kindRejection?: string
  /** What the strict writer tried to append when it stepped outside its own facts. */
  readonly strictRejection: string
}

/** Declaration order is the order generic appends are checked in. */
const TAPE_RESERVED_NAMESPACE_RULES: Readonly<
  Record<TapeReservedNamespace, TapeReservedNamespaceRule>
> = {
  execution: {
    names: EXECUTION_JOURNAL_EVENT_NAMES,
    reservesName: isExecutionJournalReservedName,
    auditEvents: true,
    genericRejection:
      'The execution/* namespace is reserved for the strict Execution Journal writer.',
    strictRejection: 'Execution Journal event name'
  },
  contract: {
    names: CONTRACT_TAPE_EVENT_NAMES,
    reservesName: isContractTapeReservedName,
    auditEvents: true,
    genericRejection: 'The contract/* namespace is reserved for the strict Contract writer.',
    strictRejection: 'Contract event name'
  },
  'tool-surface': {
    names: TOOL_SURFACE_TAPE_EVENT_NAMES,
    auditEvents: true,
    genericRejection: 'The View Tool Surface namespace is reserved for its provenance writer.',
    strictRejection: 'View Tool Surface event name'
  },
  'skill-materialized': {
    names: [SKILL_MATERIALIZATION_NAME],
    kind: 'context',
    // `context` rows never reach effective views or search; readers skip the kind itself.
    auditEvents: false,
    genericRejection: 'skill/materialized is reserved for the strict materialization writer.',
    kindRejection: 'The context entry kind is reserved for the strict materialization writer.',
    strictRejection: 'Skill materialization fact'
  },
  'provider-attempt': {
    names: [TAPE_PROVIDER_ATTEMPT_EVENT_NAME],
    // Effective views keep attempt outcomes: the latest one feeds the tape_info cache metrics.
    auditEvents: false,
    genericRejection:
      'provider/attempt_completed is reserved for the strict provider-attempt writer.',
    strictRejection: 'provider-attempt event name'
  },
  'compaction-usage': {
    names: [TAPE_COMPACTION_MODEL_CALL_EVENT_NAME],
    auditEvents: true,
    genericRejection:
      'compaction/model_call_completed is reserved for the strict compaction-usage writer.',
    strictRejection: 'compaction-usage event name'
  }
}

const RULES_IN_ORDER = Object.values(TAPE_RESERVED_NAMESPACE_RULES)

/**
 * Event names every reserved slice marks as audit evidence. Effective views and ordinary search
 * exclude them by default so the strict-writer declarations stay the single place that decides.
 */
export const RESERVED_AUDIT_TAPE_EVENT_NAMES: readonly string[] = RULES_IN_ORDER.filter(
  (rule) => rule.auditEvents
).flatMap((rule) => rule.names)

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
    const rule = TAPE_RESERVED_NAMESPACE_RULES[authorizedNamespace]
    if (!ownsFact(rule, kind, name)) {
      throw new Error(`Unsupported ${rule.strictRejection}: ${name}.`)
    }
    return
  }
  for (const rule of RULES_IN_ORDER) {
    const rejection = genericAppendRejection(rule, kind, name)
    if (rejection) throw new Error(rejection)
  }
}

/** A strict writer may append only its declared names, on its declared kind when it has one. */
function ownsFact(
  rule: TapeReservedNamespaceRule,
  kind: DeepChatTapeEntryKind,
  name: DeepChatTapeAppendInput['name']
): boolean {
  if (typeof name !== 'string' || !rule.names.includes(name)) return false
  return rule.kind === undefined || kind === rule.kind
}

/** Names why a generic append lands in the slice: exact or reserved sibling name first, then kind. */
function genericAppendRejection(
  rule: TapeReservedNamespaceRule,
  kind: DeepChatTapeEntryKind,
  name: DeepChatTapeAppendInput['name']
): string | null {
  if (typeof name === 'string' && (rule.names.includes(name) || rule.reservesName?.(name))) {
    return rule.genericRejection
  }
  if (rule.kind !== undefined && kind === rule.kind) {
    return rule.kindRejection ?? rule.genericRejection
  }
  return null
}
