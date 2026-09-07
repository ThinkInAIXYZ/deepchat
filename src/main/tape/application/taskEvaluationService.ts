import {
  DEEPCHAT_EVALUATION_REF_SCHEMA_VERSION,
  type DeepChatEvaluationRef,
  type DeepChatTaskContractRef,
  type DeepChatTaskEvaluation
} from '@shared/types/task-contract'
import { canonicalJsonStringifyData } from '../domain/canonicalJson'
import { computeTapeIdentity } from '../domain/tapeIdentity'
import type { DeepChatTapeEntryRow, TapeEventAppendInput } from '../domain/entry'
import { isDeepChatTaskEvaluation, serializeEvaluationRef } from '../domain/taskEvaluation'
import { isDeepChatTaskContract, isDeepChatTaskContractRef } from '../domain/taskContract'
import type { ContractPersistenceStore } from '../ports/storage'

const TASK_CONTRACT_FACT_NAME = 'contract/task_frozen' as const
const TASK_EVALUATION_FACT_SCHEMA_VERSION = 1 as const
const TASK_EVALUATION_FACT_NAME = 'contract/evaluated' as const
const TASK_EVALUATION_FACT_PROTOCOL_VERSION = 1 as const

type TaskEvaluationFactData = {
  schemaVersion: typeof TASK_EVALUATION_FACT_SCHEMA_VERSION
  evaluation: DeepChatTaskEvaluation
  taskContractRef: DeepChatTaskContractRef
}

type StrictTaskEvaluationEventInput = Omit<TapeEventAppendInput, 'name'> & {
  name: typeof TASK_EVALUATION_FACT_NAME
  source: NonNullable<TapeEventAppendInput['source']>
  provenanceKey: string
  data: TaskEvaluationFactData
}

export interface CommitTaskEvaluationInput {
  parentSessionId: string
  turnSeq: number
  evaluation: DeepChatTaskEvaluation
  taskContractRef: DeepChatTaskContractRef
  createdAt?: number
}

export interface TaskEvaluationCommitReceipt {
  evaluation: DeepChatTaskEvaluation
  ref: DeepChatEvaluationRef
  created: boolean
}

export interface TaskEvaluationWriter {
  commitTaskEvaluation(input: CommitTaskEvaluationInput): TaskEvaluationCommitReceipt
}

export class TaskEvaluationPersistenceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_evaluation'
      | 'transaction_required'
      | 'corruption'
      | 'persistence_failed',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'TaskEvaluationPersistenceError'
  }
}

export class TaskEvaluationService implements TaskEvaluationWriter {
  constructor(private readonly getStore: () => ContractPersistenceStore) {}

  commitTaskEvaluation(input: CommitTaskEvaluationInput): TaskEvaluationCommitReceipt {
    if (!isDeepChatTaskEvaluation(input.evaluation)) {
      throw new TaskEvaluationPersistenceError(
        'Cannot persist a malformed Task evaluation.',
        'invalid_evaluation'
      )
    }
    if (
      !isDeepChatTaskContractRef(input.taskContractRef) ||
      input.taskContractRef.sessionId !== input.parentSessionId ||
      input.taskContractRef.contractHash !== input.evaluation.taskContractHash
    ) {
      throw new TaskEvaluationPersistenceError(
        'Task evaluation does not match its parent TaskContract reference.',
        'invalid_evaluation'
      )
    }
    if (!Number.isSafeInteger(input.turnSeq) || input.turnSeq <= 0) {
      throw new TaskEvaluationPersistenceError(
        'Task evaluation turn sequence is invalid.',
        'invalid_evaluation'
      )
    }
    if (
      input.createdAt !== undefined &&
      (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
    ) {
      throw new TaskEvaluationPersistenceError(
        'Task evaluation timestamp is invalid.',
        'invalid_evaluation'
      )
    }

    const store = this.getStore()
    if (!store.isInTransaction()) {
      throw new TaskEvaluationPersistenceError(
        'Task evaluation persistence requires the live-delegation host transaction.',
        'transaction_required'
      )
    }

    try {
      store.ensureBootstrapAnchor(input.parentSessionId)
      const firstEntry = store.getFirstEntriesBySessions([input.parentSessionId])[0]
      if (!firstEntry || firstEntry.session_id !== input.parentSessionId) {
        throw new TaskEvaluationPersistenceError(
          `Parent Tape ${input.parentSessionId} has no stable identity.`,
          'persistence_failed'
        )
      }
      const tapeIdentity = computeTapeIdentity(firstEntry)
      if (tapeIdentity !== input.taskContractRef.tapeIdentity) {
        throw new TaskEvaluationPersistenceError(
          'Task evaluation and TaskContract reference name different parent Tape incarnations.',
          'corruption'
        )
      }
      const taskContractProvenanceKey = `contract:task_frozen:v1:parent:${input.evaluation.turnId}`
      const taskContractFact = store.getByProvenanceKey(
        input.parentSessionId,
        taskContractProvenanceKey
      )
      if (
        !taskContractFact ||
        !rowMatchesTaskContractReference(
          taskContractFact,
          input.taskContractRef,
          input.evaluation,
          input.turnSeq,
          taskContractProvenanceKey
        )
      ) {
        throw new TaskEvaluationPersistenceError(
          `TaskContract reference does not resolve for turn ${input.evaluation.turnId}.`,
          'corruption'
        )
      }

      const provenanceKey = `contract:evaluated:v1:${input.evaluation.turnId}`
      const event: StrictTaskEvaluationEventInput = {
        sessionId: input.parentSessionId,
        name: TASK_EVALUATION_FACT_NAME,
        source: {
          type: 'subagent',
          id: input.evaluation.turnId,
          seq: input.turnSeq
        },
        provenanceKey,
        data: {
          schemaVersion: TASK_EVALUATION_FACT_SCHEMA_VERSION,
          evaluation: input.evaluation,
          taskContractRef: input.taskContractRef
        },
        meta: { protocolVersion: TASK_EVALUATION_FACT_PROTOCOL_VERSION },
        createdAt: input.createdAt
      }

      const existing = store.getByProvenanceKey(input.parentSessionId, provenanceKey)
      if (existing) {
        if (!rowMatchesTaskEvaluationFact(existing, event)) {
          throw new TaskEvaluationPersistenceError(
            `Stored Task evaluation conflicts with turn ${input.evaluation.turnId}.`,
            'corruption'
          )
        }
        return {
          evaluation: input.evaluation,
          ref: buildEvaluationRef(existing, tapeIdentity, input.evaluation.evaluationHash),
          created: false
        }
      }

      const row = store.appendContractEvent({ ...event, idempotent: false })
      if (!rowMatchesTaskEvaluationFact(row, event)) {
        throw new TaskEvaluationPersistenceError(
          `Contract writer returned a conflicting evaluation for turn ${input.evaluation.turnId}.`,
          'corruption'
        )
      }
      return {
        evaluation: input.evaluation,
        ref: buildEvaluationRef(row, tapeIdentity, input.evaluation.evaluationHash),
        created: true
      }
    } catch (error) {
      if (error instanceof TaskEvaluationPersistenceError) throw error
      throw new TaskEvaluationPersistenceError(
        `Failed to persist Task evaluation for turn ${input.evaluation.turnId}.`,
        'persistence_failed',
        { cause: error }
      )
    }
  }
}

function rowMatchesTaskContractReference(
  row: DeepChatTapeEntryRow,
  ref: DeepChatTaskContractRef,
  evaluation: DeepChatTaskEvaluation,
  turnSeq: number,
  provenanceKey: string
): boolean {
  if (
    row.session_id !== ref.sessionId ||
    row.entry_id !== ref.entryId ||
    row.kind !== 'event' ||
    row.name !== TASK_CONTRACT_FACT_NAME ||
    row.source_type !== 'subagent' ||
    row.source_id !== evaluation.turnId ||
    row.source_seq !== turnSeq ||
    row.provenance_key !== provenanceKey
  ) {
    return false
  }

  try {
    const payload = JSON.parse(row.payload_json) as {
      name?: unknown
      data?: { contract?: unknown }
    }
    return (
      payload.name === TASK_CONTRACT_FACT_NAME &&
      isDeepChatTaskContract(payload.data?.contract) &&
      payload.data.contract.contractHash === ref.contractHash &&
      payload.data.contract.taskDescription.turnId === evaluation.turnId &&
      payload.data.contract.taskDescription.turnSeq === turnSeq &&
      payload.data.contract.taskDescription.parentSessionId === ref.sessionId
    )
  } catch {
    return false
  }
}

function rowMatchesTaskEvaluationFact(
  row: DeepChatTapeEntryRow,
  input: StrictTaskEvaluationEventInput
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

function buildEvaluationRef(
  row: DeepChatTapeEntryRow,
  tapeIdentity: string,
  evaluationHash: string
): DeepChatEvaluationRef {
  const ref: DeepChatEvaluationRef = {
    schemaVersion: DEEPCHAT_EVALUATION_REF_SCHEMA_VERSION,
    sessionId: row.session_id,
    tapeIdentity,
    entryId: row.entry_id,
    evaluationHash
  }
  serializeEvaluationRef(ref)
  return Object.freeze(ref)
}

function canonicalJsonEquals(raw: string, expected: unknown): boolean {
  try {
    return canonicalJsonStringifyData(JSON.parse(raw)) === canonicalJsonStringifyData(expected)
  } catch {
    return false
  }
}
