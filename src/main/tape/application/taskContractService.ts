import {
  DEEPCHAT_TASK_CONTRACT_REF_SCHEMA_VERSION,
  type DeepChatTaskContract,
  type DeepChatTaskContractRef
} from '@shared/types/task-contract'
import {
  isDeepChatTaskContract,
  isDeepChatTaskContractRef,
  serializeTaskContractRef
} from '../domain/taskContract'
import { canonicalJsonStringifyData } from '../domain/canonicalJson'
import { computeTapeIdentity } from '../domain/tapeIdentity'
import type { DeepChatTapeEntryRow, TapeEventAppendInput } from '../domain/entry'
import type { ContractPersistenceStore } from '../ports/storage'

const TASK_CONTRACT_FACT_SCHEMA_VERSION = 1 as const
const TASK_CONTRACT_FACT_NAME = 'contract/task_frozen' as const
const TASK_CONTRACT_FACT_PROTOCOL_VERSION = 1 as const

type TaskContractFactDelivery = 'parent_frozen' | 'child_inherited' | 'projection_recovery'

type TaskContractFactData = {
  schemaVersion: typeof TASK_CONTRACT_FACT_SCHEMA_VERSION
  delivery: TaskContractFactDelivery
  contract: DeepChatTaskContract
  originRef: DeepChatTaskContractRef | null
  supersedesRef: DeepChatTaskContractRef | null
}

type StrictTaskContractEventInput = Omit<TapeEventAppendInput, 'name'> & {
  name: typeof TASK_CONTRACT_FACT_NAME
  source: NonNullable<TapeEventAppendInput['source']>
  provenanceKey: string
  data: TaskContractFactData
}

export interface FreezeParentTaskContractInput {
  parentSessionId: string
  contract: DeepChatTaskContract
  createdAt?: number
}

export interface EnsureParentTaskContractInput extends FreezeParentTaskContractInput {
  currentRef: DeepChatTaskContractRef
}

export interface EnsureChildTaskContractInput {
  childSessionId: string
  contract: DeepChatTaskContract
  originRef: DeepChatTaskContractRef
  currentRef: DeepChatTaskContractRef | null
  createdAt?: number
}

export interface TaskContractCommitReceipt {
  contract: DeepChatTaskContract
  ref: DeepChatTaskContractRef
  created: boolean
}

export interface ParentTaskContractWriter {
  freezeParentTaskContract(input: FreezeParentTaskContractInput): TaskContractCommitReceipt
}

export interface TaskContractWriter extends ParentTaskContractWriter {
  ensureParentTaskContract(input: EnsureParentTaskContractInput): TaskContractCommitReceipt
  ensureChildTaskContract(input: EnsureChildTaskContractInput): TaskContractCommitReceipt
}

export class TaskContractPersistenceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_contract'
      | 'transaction_required'
      | 'corruption'
      | 'persistence_failed',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'TaskContractPersistenceError'
  }
}

function canonicalJsonEquals(raw: string, expected: unknown): boolean {
  try {
    return canonicalJsonStringifyData(JSON.parse(raw)) === canonicalJsonStringifyData(expected)
  } catch {
    return false
  }
}

function rowMatchesTaskContractFact(
  row: DeepChatTapeEntryRow,
  input: StrictTaskContractEventInput
): boolean {
  return (
    row.session_id === input.sessionId &&
    row.kind === 'event' &&
    row.name === input.name &&
    row.source_type === input.source.type &&
    row.source_id === input.source.id &&
    row.source_seq === (input.source.seq ?? null) &&
    row.provenance_key === input.provenanceKey &&
    canonicalJsonEquals(row.payload_json, { name: input.name, data: input.data }) &&
    canonicalJsonEquals(row.meta_json, input.meta ?? {})
  )
}

function rowContainsReferencedTaskContractFact(
  row: DeepChatTapeEntryRow,
  input: CommitTaskContractInput,
  provenanceKey: string
): boolean {
  if (
    row.session_id !== input.targetSessionId ||
    row.kind !== 'event' ||
    row.name !== TASK_CONTRACT_FACT_NAME ||
    row.source_type !== 'subagent' ||
    row.source_id !== input.contract.taskDescription.turnId ||
    row.source_seq !== input.contract.taskDescription.turnSeq ||
    row.provenance_key !== provenanceKey ||
    !canonicalJsonEquals(row.meta_json, { protocolVersion: TASK_CONTRACT_FACT_PROTOCOL_VERSION })
  ) {
    return false
  }

  try {
    const payload = JSON.parse(row.payload_json) as {
      name?: unknown
      data?: Record<string, unknown>
    }
    const data = payload.data
    if (
      payload.name !== TASK_CONTRACT_FACT_NAME ||
      !data ||
      Object.keys(data).length !== 5 ||
      data.schemaVersion !== TASK_CONTRACT_FACT_SCHEMA_VERSION ||
      canonicalJsonStringifyData(data.contract) !== canonicalJsonStringifyData(input.contract)
    ) {
      return false
    }

    const delivery = data.delivery
    const originRef = data.originRef
    const supersedesRef = data.supersedesRef
    if (input.role === 'parent') {
      if (delivery !== 'parent_frozen' && delivery !== 'projection_recovery') return false
      if (originRef !== null) return false
    } else {
      if (delivery !== 'child_inherited' && delivery !== 'projection_recovery') return false
      if (
        !isDeepChatTaskContractRef(originRef) ||
        originRef.sessionId !== input.contract.taskDescription.parentSessionId ||
        originRef.contractHash !== input.contract.contractHash
      ) {
        return false
      }
    }

    if (delivery === 'projection_recovery') {
      return (
        isDeepChatTaskContractRef(supersedesRef) &&
        supersedesRef.sessionId === input.targetSessionId &&
        supersedesRef.contractHash === input.contract.contractHash &&
        supersedesRef.tapeIdentity !== input.currentRef?.tapeIdentity
      )
    }
    return supersedesRef === null
  } catch {
    return false
  }
}

function buildTaskContractRef(
  row: DeepChatTapeEntryRow,
  tapeIdentity: string,
  contractHash: string
): DeepChatTaskContractRef {
  const ref: DeepChatTaskContractRef = {
    schemaVersion: DEEPCHAT_TASK_CONTRACT_REF_SCHEMA_VERSION,
    sessionId: row.session_id,
    tapeIdentity,
    entryId: row.entry_id,
    contractHash
  }
  serializeTaskContractRef(ref)
  return Object.freeze(ref)
}

type CommitTaskContractInput = {
  targetSessionId: string
  role: 'parent' | 'child'
  contract: DeepChatTaskContract
  originRef: DeepChatTaskContractRef | null
  currentRef: DeepChatTaskContractRef | null
  createdAt?: number
}

export class TaskContractService implements TaskContractWriter {
  constructor(private readonly getStore: () => ContractPersistenceStore) {}

  freezeParentTaskContract(input: FreezeParentTaskContractInput): TaskContractCommitReceipt {
    return this.commitTaskContract({
      targetSessionId: input.parentSessionId,
      role: 'parent',
      contract: input.contract,
      originRef: null,
      currentRef: null,
      createdAt: input.createdAt
    })
  }

  ensureParentTaskContract(input: EnsureParentTaskContractInput): TaskContractCommitReceipt {
    return this.commitTaskContract({
      targetSessionId: input.parentSessionId,
      role: 'parent',
      contract: input.contract,
      originRef: null,
      currentRef: input.currentRef,
      createdAt: input.createdAt
    })
  }

  ensureChildTaskContract(input: EnsureChildTaskContractInput): TaskContractCommitReceipt {
    return this.commitTaskContract({
      targetSessionId: input.childSessionId,
      role: 'child',
      contract: input.contract,
      originRef: input.originRef,
      currentRef: input.currentRef,
      createdAt: input.createdAt
    })
  }

  private commitTaskContract(input: CommitTaskContractInput): TaskContractCommitReceipt {
    if (!isDeepChatTaskContract(input.contract)) {
      throw new TaskContractPersistenceError(
        'Cannot freeze a malformed or non-canonical TaskContract.',
        'invalid_contract'
      )
    }
    const description = input.contract.taskDescription
    if (
      (input.role === 'parent' && input.targetSessionId !== description.parentSessionId) ||
      (input.role === 'child' && input.targetSessionId === description.parentSessionId)
    ) {
      throw new TaskContractPersistenceError(
        'TaskContract Session does not match its persistence role.',
        'invalid_contract'
      )
    }
    if (
      (input.role === 'parent' && input.originRef !== null) ||
      (input.role === 'child' &&
        (!isDeepChatTaskContractRef(input.originRef) ||
          input.originRef.sessionId !== description.parentSessionId ||
          input.originRef.contractHash !== input.contract.contractHash))
    ) {
      throw new TaskContractPersistenceError(
        'TaskContract origin reference is invalid.',
        'invalid_contract'
      )
    }
    if (
      input.currentRef !== null &&
      (!isDeepChatTaskContractRef(input.currentRef) ||
        input.currentRef.sessionId !== input.targetSessionId ||
        input.currentRef.contractHash !== input.contract.contractHash)
    ) {
      throw new TaskContractPersistenceError(
        'TaskContract runtime reference is invalid.',
        'invalid_contract'
      )
    }
    if (
      input.createdAt !== undefined &&
      (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
    ) {
      throw new TaskContractPersistenceError(
        'TaskContract timestamp is invalid.',
        'invalid_contract'
      )
    }

    const store = this.getStore()
    if (!store.isInTransaction()) {
      throw new TaskContractPersistenceError(
        'TaskContract persistence requires the live-delegation host transaction.',
        'transaction_required'
      )
    }

    try {
      store.ensureBootstrapAnchor(input.targetSessionId)
      const firstEntry = store.getFirstEntriesBySessions([input.targetSessionId])[0]
      if (!firstEntry || firstEntry.session_id !== input.targetSessionId) {
        throw new TaskContractPersistenceError(
          `Tape ${input.targetSessionId} has no stable identity.`,
          'persistence_failed'
        )
      }
      const tapeIdentity = computeTapeIdentity(firstEntry)
      const provenanceKey = `contract:task_frozen:v1:${input.role}:${description.turnId}`
      const recovering = input.currentRef !== null && input.currentRef.tapeIdentity !== tapeIdentity
      const delivery: TaskContractFactDelivery = recovering
        ? 'projection_recovery'
        : input.role === 'parent'
          ? 'parent_frozen'
          : 'child_inherited'
      const event: StrictTaskContractEventInput = {
        sessionId: input.targetSessionId,
        name: TASK_CONTRACT_FACT_NAME,
        source: { type: 'subagent', id: description.turnId, seq: description.turnSeq },
        provenanceKey,
        data: {
          schemaVersion: TASK_CONTRACT_FACT_SCHEMA_VERSION,
          delivery,
          contract: input.contract,
          originRef: input.originRef,
          supersedesRef: recovering ? input.currentRef : null
        },
        meta: { protocolVersion: TASK_CONTRACT_FACT_PROTOCOL_VERSION },
        createdAt: input.createdAt
      }

      const existing = store.getByProvenanceKey(input.targetSessionId, provenanceKey)
      if (existing) {
        const currentRefNamesExisting =
          input.currentRef !== null &&
          input.currentRef.tapeIdentity === tapeIdentity &&
          input.currentRef.entryId === existing.entry_id
        if (
          !rowMatchesTaskContractFact(existing, event) &&
          (!currentRefNamesExisting ||
            !rowContainsReferencedTaskContractFact(existing, input, provenanceKey))
        ) {
          throw new TaskContractPersistenceError(
            `Stored TaskContract conflicts with turn ${description.turnId}.`,
            'corruption'
          )
        }
        if (
          input.currentRef !== null &&
          input.currentRef.tapeIdentity === tapeIdentity &&
          input.currentRef.entryId !== existing.entry_id
        ) {
          throw new TaskContractPersistenceError(
            `Stored TaskContract reference conflicts with turn ${description.turnId}.`,
            'corruption'
          )
        }
        return {
          contract: input.contract,
          ref: buildTaskContractRef(existing, tapeIdentity, input.contract.contractHash),
          created: false
        }
      }

      if (input.currentRef !== null && input.currentRef.tapeIdentity === tapeIdentity) {
        throw new TaskContractPersistenceError(
          `Stored TaskContract is missing for turn ${description.turnId}.`,
          'corruption'
        )
      }

      const row = store.appendContractEvent({ ...event, idempotent: false })
      if (!rowMatchesTaskContractFact(row, event)) {
        throw new TaskContractPersistenceError(
          `Contract writer returned a conflicting fact for turn ${description.turnId}.`,
          'corruption'
        )
      }
      return {
        contract: input.contract,
        ref: buildTaskContractRef(row, tapeIdentity, input.contract.contractHash),
        created: true
      }
    } catch (error) {
      if (error instanceof TaskContractPersistenceError) throw error
      throw new TaskContractPersistenceError(
        `Failed to freeze TaskContract for turn ${description.turnId}.`,
        'persistence_failed',
        { cause: error }
      )
    }
  }
}
