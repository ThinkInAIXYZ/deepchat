import type {
  DeepChatExecutionContract
} from '@shared/types/execution-contract'
import type {
  TapeExecutionViewManifestReader,
  TapeViewManifestReader
} from '@/tape/ports/capabilities'
import {
  ExecutionContractDispatchError,
  executionContractMatchesBinding,
  parseExecutionContractBinding,
  restoreExecutionContract
} from '@/tape/domain/executionContract'
import { verifyTapeViewManifestHash } from '@/tape/domain/viewManifest'

export interface DeferredExecutionContractResolutionInput {
  sessionId: string
  messageId: string
  rawBinding: unknown
  runtimeContract?: DeepChatExecutionContract
  viewManifests: Pick<TapeViewManifestReader, 'listViewManifestsByMessage'> &
    TapeExecutionViewManifestReader
}

export function resolveDeferredExecutionContract(
  input: DeferredExecutionContractResolutionInput
): DeepChatExecutionContract | undefined {
  const { sessionId, messageId, rawBinding, runtimeContract, viewManifests } = input
  if (rawBinding === undefined) {
    if (runtimeContract) {
      throw new ExecutionContractDispatchError(
        'Paused tool dispatch is missing its durable ExecutionContract binding.',
        'invalid_contract'
      )
    }
    return undefined
  }
  const binding = parseExecutionContractBinding(rawBinding)
  if (!binding) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch has an invalid ExecutionContract binding.',
      'invalid_contract'
    )
  }

  if (binding.request.sessionId !== sessionId || binding.request.messageId !== messageId) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch does not match its provider View identity.',
      'identity_mismatch'
    )
  }
  if (runtimeContract) {
    if (!executionContractMatchesBinding(runtimeContract, binding)) {
      throw new ExecutionContractDispatchError(
        'Paused tool dispatch does not match its runtime ExecutionContract projection.',
        'invalid_contract'
      )
    }
    return runtimeContract
  }

  let records
  try {
    const skillManifestRecord = viewManifests.getViewManifestByExecutionBinding({
      sessionId,
      runId: binding.request.runId,
      requestSeq: binding.request.requestSeq
    })
    records = skillManifestRecord
      ? [skillManifestRecord]
      : viewManifests
          .listViewManifestsByMessage(sessionId, messageId)
          .filter(
            (record) =>
              record.requestSeq === binding.request.requestSeq &&
              record.manifest.schemaVersion === 5
          )
  } catch (error) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch could not recover its ExecutionContract View.',
      'invalid_contract',
      { cause: error }
    )
  }
  if (records.length !== 1) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch requires exactly one matching ExecutionContract View.',
      'invalid_contract'
    )
  }

  const manifest = records[0].manifest
  if (
    (manifest.schemaVersion !== 5 &&
      manifest.schemaVersion !== 6 &&
      manifest.schemaVersion !== 7) ||
    !manifest.executionContract ||
    (manifest.schemaVersion !== 5 && manifest.runId !== binding.request.runId) ||
    verifyTapeViewManifestHash(manifest) !== 'valid'
  ) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch ExecutionContract View failed integrity validation.',
      'invalid_contract'
    )
  }
  const recoveredContract = restoreExecutionContract(manifest.executionContract)
  if (!recoveredContract || !executionContractMatchesBinding(recoveredContract, binding)) {
    throw new ExecutionContractDispatchError(
      'Paused tool dispatch ExecutionContract does not match its durable View binding.',
      'invalid_contract'
    )
  }
  return recoveredContract
}
