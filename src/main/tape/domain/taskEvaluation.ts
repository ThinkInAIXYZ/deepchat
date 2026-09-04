import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  DEEPCHAT_EVALUATION_REF_SCHEMA_VERSION,
  DEEPCHAT_TASK_EVALUATION_REASON_CODES,
  DEEPCHAT_TASK_EVALUATION_HASH_VERSION,
  DEEPCHAT_TASK_EVALUATION_SCHEMA_VERSION,
  DEEPCHAT_TASK_EVALUATOR_VERSION,
  DeepChatLegacyTaskEvaluationProjectionSchema,
  DeepChatTaskEvaluationProjectionSchema,
  MAX_TASK_EVALUATION_BYTES,
  MAX_TASK_EVALUATION_CANDIDATE_BYTES,
  MAX_TASK_EVALUATION_PARENT_EVIDENCE,
  MAX_TASK_EVALUATION_RECORDS,
  type DeepChatEvaluationRef,
  type DeepChatLegacyTaskEvaluation,
  type DeepChatLegacyTaskEvaluationReasonCode,
  type DeepChatLegacyTaskEvaluationRecord,
  type DeepChatStoredTaskEvaluation,
  type DeepChatTaskContract,
  type DeepChatTaskEvaluation,
  type DeepChatTaskEvaluationExecutionStatus,
  type DeepChatTaskEvaluationReasonCode,
  type DeepChatTaskEvaluationRecord,
  type DeepChatTaskEvaluationSummary
} from '@shared/types/task-contract'
import { indexMarkdownLevelTwoSections } from '@shared/orchestration/liveDelegationMarkdown'
import { canonicalJsonStringifyData, hashJsonData } from './canonicalJson'
import { compareUtf16, deepFreeze, SHA256_HEX_PATTERN } from './primitives'
import { isDeepChatTaskContract } from './taskContract'

const SUCCESS_REASON_CODES = new Set<DeepChatTaskEvaluationReasonCode>([
  'required_sections_present'
])
const LEGACY_SUCCESS_REASON_CODES = new Set<DeepChatLegacyTaskEvaluationReasonCode>([
  'required_sections_present',
  'result_schema_valid'
])
const CURRENT_REASON_CODES = new Set<string>(DEEPCHAT_TASK_EVALUATION_REASON_CODES)

export interface BuildTaskEvaluationInput {
  contract: DeepChatTaskContract
  executionStatus: DeepChatTaskEvaluationExecutionStatus
  candidateResult: string | null
}

export class TaskEvaluationError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_input' | 'limit_exceeded',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'TaskEvaluationError'
  }
}

export function buildTaskEvaluation(input: BuildTaskEvaluationInput): DeepChatTaskEvaluation {
  if (!isDeepChatTaskContract(input.contract)) {
    throw new TaskEvaluationError(
      'Task evaluation requires a canonical TaskContract.',
      'invalid_input'
    )
  }
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(input.executionStatus)) {
    throw new TaskEvaluationError('Task evaluation execution status is invalid.', 'invalid_input')
  }
  if (input.candidateResult !== null && typeof input.candidateResult !== 'string') {
    throw new TaskEvaluationError('Task evaluation candidate is invalid.', 'invalid_input')
  }

  const candidateResult = input.candidateResult?.trim() || null
  const candidate = candidateResult
    ? {
        kind: 'answer' as const,
        sha256: createHash('sha256').update(candidateResult, 'utf8').digest('hex'),
        utf8Bytes: Buffer.byteLength(candidateResult, 'utf8')
      }
    : ({ kind: 'absent' } as const)
  let records: DeepChatTaskEvaluationRecord[]

  if (input.executionStatus === 'cancelled' || input.executionStatus === 'interrupted') {
    records = [
      evaluationRecord({
        outcome: 'indeterminate',
        code:
          input.executionStatus === 'cancelled' ? 'execution_cancelled' : 'execution_interrupted'
      })
    ]
  } else if (!candidateResult) {
    records = [evaluationRecord({ outcome: 'indeterminate', code: 'candidate_missing' })]
  } else if (
    candidate.kind === 'answer' &&
    candidate.utf8Bytes > MAX_TASK_EVALUATION_CANDIDATE_BYTES
  ) {
    records = [evaluationRecord({ outcome: 'indeterminate', code: 'candidate_too_large' })]
  } else {
    records = evaluateRequirements(input.contract, candidateResult)
  }

  const formatStatus = records.some((record) => record.outcome === 'invalid')
    ? 'invalid'
    : records.some((record) => record.outcome === 'indeterminate')
      ? 'indeterminate'
      : 'valid'
  const reasonCodes = [
    ...new Set(records.filter((record) => record.outcome !== 'valid').map((record) => record.code))
  ].sort(compareUtf16)

  return finalizeEvaluation({
    schemaVersion: DEEPCHAT_TASK_EVALUATION_SCHEMA_VERSION,
    hashVersion: DEEPCHAT_TASK_EVALUATION_HASH_VERSION,
    evaluatorVersion: DEEPCHAT_TASK_EVALUATOR_VERSION,
    evaluationKind: 'handoff_format',
    turnId: input.contract.taskDescription.turnId,
    taskContractHash: input.contract.contractHash,
    candidate,
    executionStatus: input.executionStatus,
    formatStatus,
    reasonCodes,
    records,
    omittedRecordCount: 0
  })
}

export function restoreTaskEvaluation(value: unknown): DeepChatTaskEvaluation | null {
  const parsed = DeepChatTaskEvaluationProjectionSchema.safeParse(value)
  if (!parsed.success) return null
  const evaluation = parsed.data
  if (
    Buffer.byteLength(canonicalJsonStringifyData(evaluation), 'utf8') > MAX_TASK_EVALUATION_BYTES
  ) {
    return null
  }
  const { evaluationHash, ...draft } = evaluation
  if (hashJsonData(draft) !== evaluationHash) return null
  if (!isCanonicalEvaluation(evaluation)) return null
  return deepFreeze(evaluation)
}

export function restoreStoredTaskEvaluation(value: unknown): DeepChatStoredTaskEvaluation | null {
  const current = restoreTaskEvaluation(value)
  if (current) return current

  const parsed = DeepChatLegacyTaskEvaluationProjectionSchema.safeParse(value)
  if (!parsed.success) return null
  const evaluation = parsed.data
  if (
    Buffer.byteLength(canonicalJsonStringifyData(evaluation), 'utf8') > MAX_TASK_EVALUATION_BYTES
  ) {
    return null
  }
  const { evaluationHash, ...draft } = evaluation
  if (hashJsonData(draft) !== evaluationHash) return null
  if (!isCanonicalLegacyEvaluation(evaluation) || !isProjectableLegacyEvaluation(evaluation)) {
    return null
  }
  return deepFreeze(evaluation)
}

export function isDeepChatTaskEvaluation(value: unknown): value is DeepChatTaskEvaluation {
  return restoreTaskEvaluation(value) !== null
}

export function serializeTaskEvaluation(evaluation: DeepChatTaskEvaluation): string {
  const restored = restoreTaskEvaluation(evaluation)
  if (!restored) throw new TaskEvaluationError('Task evaluation is invalid.', 'invalid_input')
  return canonicalJsonStringifyData(restored)
}

export function isDeepChatEvaluationRef(value: unknown): value is DeepChatEvaluationRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return (
    Object.keys(ref).length === 5 &&
    ref.schemaVersion === DEEPCHAT_EVALUATION_REF_SCHEMA_VERSION &&
    typeof ref.sessionId === 'string' &&
    ref.sessionId.trim() === ref.sessionId &&
    ref.sessionId.length > 0 &&
    ref.sessionId.length <= 256 &&
    typeof ref.tapeIdentity === 'string' &&
    SHA256_HEX_PATTERN.test(ref.tapeIdentity) &&
    Number.isSafeInteger(ref.entryId) &&
    (ref.entryId as number) > 0 &&
    typeof ref.evaluationHash === 'string' &&
    SHA256_HEX_PATTERN.test(ref.evaluationHash)
  )
}

export function restoreEvaluationRef(value: unknown): DeepChatEvaluationRef | null {
  return isDeepChatEvaluationRef(value) ? Object.freeze({ ...value }) : null
}

export function serializeEvaluationRef(ref: DeepChatEvaluationRef): string {
  if (!isDeepChatEvaluationRef(ref)) {
    throw new TaskEvaluationError('Task evaluation reference is invalid.', 'invalid_input')
  }
  return canonicalJsonStringifyData(ref)
}

export function projectTaskEvaluationSummary(
  evaluation: DeepChatStoredTaskEvaluation,
  evaluationRef: DeepChatEvaluationRef,
  maxEvidenceRecords = MAX_TASK_EVALUATION_PARENT_EVIDENCE
): DeepChatTaskEvaluationSummary {
  const canonicalEvaluation = restoreStoredTaskEvaluation(evaluation)
  const canonicalRef = restoreEvaluationRef(evaluationRef)
  if (
    !canonicalEvaluation ||
    !canonicalRef ||
    canonicalRef.evaluationHash !== canonicalEvaluation.evaluationHash
  ) {
    throw new TaskEvaluationError('Task evaluation summary inputs conflict.', 'invalid_input')
  }
  if (!Number.isSafeInteger(maxEvidenceRecords) || maxEvidenceRecords < 0) {
    throw new TaskEvaluationError('Task evaluation evidence limit is invalid.', 'invalid_input')
  }
  const evidenceLimit = Math.min(maxEvidenceRecords, MAX_TASK_EVALUATION_PARENT_EVIDENCE)
  const projected =
    canonicalEvaluation.schemaVersion === DEEPCHAT_TASK_EVALUATION_SCHEMA_VERSION
      ? {
          formatStatus: canonicalEvaluation.formatStatus,
          reasonCodes: canonicalEvaluation.reasonCodes,
          records: canonicalEvaluation.records
        }
      : projectLegacyEvaluation(canonicalEvaluation)
  const relevant = projected.records.filter((record) => record.outcome !== 'valid')
  const evidence = relevant.slice(0, evidenceLimit)
  return deepFreeze({
    evaluationKind: 'handoff_format',
    formatStatus: projected.formatStatus,
    reasonCodes: [...projected.reasonCodes],
    candidate: canonicalEvaluation.candidate,
    evidence,
    evaluationRef: canonicalRef,
    omittedEvidenceCount:
      canonicalEvaluation.omittedRecordCount + Math.max(0, relevant.length - evidence.length)
  })
}

function projectLegacyEvaluation(evaluation: DeepChatLegacyTaskEvaluation): {
  formatStatus: DeepChatTaskEvaluation['formatStatus']
  reasonCodes: readonly DeepChatTaskEvaluationReasonCode[]
  records: readonly DeepChatTaskEvaluationRecord[]
} {
  const records = evaluation.records.map(
    (record): DeepChatTaskEvaluationRecord => ({
      requirementId: record.requirementId,
      requirementKind: record.requirementKind as 'required_sections' | null,
      outcome:
        record.outcome === 'passed'
          ? 'valid'
          : record.outcome === 'failed'
            ? 'invalid'
            : 'indeterminate',
      code: record.code as DeepChatTaskEvaluationReasonCode,
      section: record.section,
      additionalEvidenceCount: record.additionalEvidenceCount
    })
  )
  const formatStatus = records.some((record) => record.outcome === 'invalid')
    ? 'invalid'
    : records.some((record) => record.outcome === 'indeterminate')
      ? 'indeterminate'
      : 'valid'
  return {
    formatStatus,
    reasonCodes: evaluation.reasonCodes as readonly DeepChatTaskEvaluationReasonCode[],
    records
  }
}

function evaluateRequirements(
  contract: DeepChatTaskContract,
  candidateResult: string
): DeepChatTaskEvaluationRecord[] {
  const sections = indexMarkdownLevelTwoSections(candidateResult)

  return contract.taskHarness.acceptance.map((requirement) => {
    const missing = requirement.sections.filter(
      (section) => !(sections.get(section.toLowerCase())?.body.trim() ?? '')
    )
    return evaluationRecord({
      requirementId: requirement.id,
      requirementKind: requirement.kind,
      outcome: missing.length === 0 ? 'valid' : 'invalid',
      code: missing.length === 0 ? 'required_sections_present' : 'required_sections_missing',
      section: missing[0] ?? null,
      additionalEvidenceCount: Math.max(0, missing.length - 1)
    })
  })
}

function evaluationRecord(
  input: Partial<DeepChatTaskEvaluationRecord> &
    Pick<DeepChatTaskEvaluationRecord, 'outcome' | 'code'>
): DeepChatTaskEvaluationRecord {
  return {
    requirementId: input.requirementId ?? null,
    requirementKind: input.requirementKind ?? null,
    outcome: input.outcome,
    code: input.code,
    section: input.section ?? null,
    additionalEvidenceCount: input.additionalEvidenceCount ?? 0
  }
}

function finalizeEvaluation(
  input: Omit<DeepChatTaskEvaluation, 'evaluationHash'>
): DeepChatTaskEvaluation {
  const records = [...input.records].slice(0, MAX_TASK_EVALUATION_RECORDS)
  let omittedRecordCount =
    input.omittedRecordCount + Math.max(0, input.records.length - records.length)

  while (true) {
    const draft: Omit<DeepChatTaskEvaluation, 'evaluationHash'> = {
      ...input,
      records,
      omittedRecordCount
    }
    const evaluation: DeepChatTaskEvaluation = {
      ...draft,
      evaluationHash: hashJsonData(draft)
    }
    const serialized = canonicalJsonStringifyData(evaluation)
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_TASK_EVALUATION_BYTES) {
      const restored = restoreTaskEvaluation(evaluation)
      if (!restored) {
        throw new TaskEvaluationError('Task evaluation is not canonical.', 'invalid_input')
      }
      return restored
    }
    if (records.length === 0) {
      throw new TaskEvaluationError(
        `Task evaluation exceeds ${MAX_TASK_EVALUATION_BYTES} UTF-8 bytes.`,
        'limit_exceeded'
      )
    }
    records.pop()
    omittedRecordCount += 1
  }
}

function isCanonicalEvaluation(evaluation: DeepChatTaskEvaluation): boolean {
  if (evaluation.reasonCodes.some((code) => SUCCESS_REASON_CODES.has(code))) return false
  if (
    canonicalJsonStringifyData(evaluation.reasonCodes) !==
    canonicalJsonStringifyData([...new Set(evaluation.reasonCodes)].sort(compareUtf16))
  ) {
    return false
  }
  const recordedReasonCodes = [
    ...new Set(
      evaluation.records.filter((record) => record.outcome !== 'valid').map((record) => record.code)
    )
  ].sort(compareUtf16)
  if (
    evaluation.omittedRecordCount === 0 &&
    canonicalJsonStringifyData(evaluation.reasonCodes) !==
      canonicalJsonStringifyData(recordedReasonCodes)
  ) {
    return false
  }
  const reasonOutcomes = evaluation.reasonCodes.map(reasonCodeOutcome)
  const expectedFormatStatus = reasonOutcomes.includes('invalid')
    ? 'invalid'
    : reasonOutcomes.includes('indeterminate')
      ? 'indeterminate'
      : 'valid'
  if (evaluation.formatStatus !== expectedFormatStatus) return false
  return evaluation.records.every(
    (record) =>
      recordMatchesReasonCode(record) &&
      (record.outcome === 'valid' || evaluation.reasonCodes.includes(record.code))
  )
}

function isCanonicalLegacyEvaluation(evaluation: DeepChatLegacyTaskEvaluation): boolean {
  if ((evaluation.verdict === 'passed') !== (evaluation.disposition === 'accepted')) return false
  if (evaluation.reasonCodes.some((code) => LEGACY_SUCCESS_REASON_CODES.has(code))) return false
  if (
    canonicalJsonStringifyData(evaluation.reasonCodes) !==
    canonicalJsonStringifyData([...new Set(evaluation.reasonCodes)].sort(compareUtf16))
  ) {
    return false
  }
  const recordedReasonCodes = [
    ...new Set(
      evaluation.records
        .filter((record) => record.outcome !== 'passed')
        .map((record) => record.code)
    )
  ].sort(compareUtf16)
  if (
    evaluation.omittedRecordCount === 0 &&
    canonicalJsonStringifyData(evaluation.reasonCodes) !==
      canonicalJsonStringifyData(recordedReasonCodes)
  ) {
    return false
  }
  const reasonOutcomes = evaluation.reasonCodes.map(legacyReasonCodeOutcome)
  const expectedVerdict = reasonOutcomes.includes('failed')
    ? 'failed'
    : reasonOutcomes.includes('indeterminate')
      ? 'indeterminate'
      : 'passed'
  if (evaluation.verdict !== expectedVerdict) return false
  return evaluation.records.every(
    (record) =>
      legacyRecordMatchesReasonCode(record) &&
      (record.outcome === 'passed' || evaluation.reasonCodes.includes(record.code))
  )
}

function isProjectableLegacyEvaluation(evaluation: DeepChatLegacyTaskEvaluation): boolean {
  return (
    evaluation.omittedRecordCount === 0 &&
    evaluation.reasonCodes.every((code) => CURRENT_REASON_CODES.has(code)) &&
    evaluation.records.every(
      (record) =>
        record.requirementKind !== 'result_schema' &&
        CURRENT_REASON_CODES.has(record.code) &&
        record.instancePath === null &&
        record.keyword === null
    ) &&
    legacyEvaluationMatchesWriterState(evaluation)
  )
}

function legacyEvaluationMatchesWriterState(evaluation: DeepChatLegacyTaskEvaluation): boolean {
  if (evaluation.candidate.kind === 'answer' && evaluation.candidate.utf8Bytes === 0) return false
  if (evaluation.executionStatus === 'cancelled') {
    return hasOnlyLegacyStateRecord(evaluation.records, 'execution_cancelled')
  }
  if (evaluation.executionStatus === 'interrupted') {
    return hasOnlyLegacyStateRecord(evaluation.records, 'execution_interrupted')
  }
  if (evaluation.candidate.kind === 'absent') {
    return hasOnlyLegacyStateRecord(evaluation.records, 'candidate_missing')
  }
  if (evaluation.candidate.utf8Bytes > MAX_TASK_EVALUATION_CANDIDATE_BYTES) {
    return hasOnlyLegacyStateRecord(evaluation.records, 'candidate_too_large')
  }

  const requirementIds = new Set<string>()
  let previousRequirementId: string | null = null
  return evaluation.records.every((record) => {
    if (
      record.requirementId === null ||
      record.requirementKind !== 'required_sections' ||
      requirementIds.has(record.requirementId) ||
      (previousRequirementId !== null &&
        compareUtf16(previousRequirementId, record.requirementId) >= 0)
    ) {
      return false
    }
    requirementIds.add(record.requirementId)
    previousRequirementId = record.requirementId
    return record.code === 'required_sections_present'
      ? record.outcome === 'passed' &&
          record.section === null &&
          record.additionalEvidenceCount === 0
      : record.code === 'required_sections_missing' &&
          record.outcome === 'failed' &&
          record.section !== null
  })
}

function hasOnlyLegacyStateRecord(
  records: readonly DeepChatLegacyTaskEvaluationRecord[],
  code:
    | 'candidate_missing'
    | 'candidate_too_large'
    | 'execution_cancelled'
    | 'execution_interrupted'
): boolean {
  if (records.length !== 1) return false
  const [record] = records
  return (
    record.requirementId === null &&
    record.requirementKind === null &&
    record.outcome === 'indeterminate' &&
    record.code === code &&
    record.section === null &&
    record.instancePath === null &&
    record.keyword === null &&
    record.additionalEvidenceCount === 0
  )
}

function legacyRecordMatchesReasonCode(record: DeepChatLegacyTaskEvaluationRecord): boolean {
  const expectedOutcome = legacyReasonCodeOutcome(record.code)
  if (record.outcome !== expectedOutcome) return false
  const requirementCode =
    record.code.startsWith('required_sections_') ||
    record.code.startsWith('result_') ||
    record.code === 'candidate_too_complex' ||
    record.code === 'evaluator_error'
  return requirementCode
    ? record.requirementId !== null && record.requirementKind !== null
    : record.requirementId === null && record.requirementKind === null
}

function legacyReasonCodeOutcome(
  code: DeepChatLegacyTaskEvaluationReasonCode
): DeepChatLegacyTaskEvaluationRecord['outcome'] {
  if (LEGACY_SUCCESS_REASON_CODES.has(code)) return 'passed'
  if (
    code === 'required_sections_missing' ||
    code === 'result_section_missing' ||
    code === 'result_json_invalid' ||
    code === 'result_schema_mismatch'
  ) {
    return 'failed'
  }
  return 'indeterminate'
}

function recordMatchesReasonCode(record: DeepChatTaskEvaluationRecord): boolean {
  const expectedOutcome = reasonCodeOutcome(record.code)
  if (record.outcome !== expectedOutcome) return false
  const requirementCode = record.code.startsWith('required_sections_')
  return requirementCode
    ? record.requirementId !== null && record.requirementKind !== null
    : record.requirementId === null && record.requirementKind === null
}

function reasonCodeOutcome(
  code: DeepChatTaskEvaluationReasonCode
): DeepChatTaskEvaluationRecord['outcome'] {
  if (SUCCESS_REASON_CODES.has(code)) return 'valid'
  if (code === 'required_sections_missing') return 'invalid'
  return 'indeterminate'
}
