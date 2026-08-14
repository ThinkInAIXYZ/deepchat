import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import type { ToolExecutionContract } from '@shared/types/core/mcp'
import { canonicalJsonStringifyData } from '@/tape/domain/canonicalJson'
import {
  getTapeViewManifestExecutionContract,
  verifyTapeViewManifestHash
} from '@/tape/domain/viewManifest'
import type {
  ExecutionJournalRecoveryReader,
  TapeToolSurfaceViewReader,
  TapeViewManifestReader
} from '@/tape/ports/capabilities'
import {
  claimToolSurfaceDeferredDispatch,
  getToolSurfaceDeferredDispatch,
  issueRecoveredToolSurfaceDeferredDispatch,
  parseToolSurfaceDeferredDispatchBinding,
  type ToolSurfaceDeferredDispatch,
  type ToolSurfaceDeferredDispatchBindingV1
} from './toolSurface'

export type DeferredToolSurfaceErrorCode =
  | 'invalid_binding'
  | 'identity_mismatch'
  | 'missing_surface'
  | 'spent_dispatch'
  | 'corruption'

export class DeferredToolSurfaceError extends Error {
  constructor(
    message: string,
    readonly code: DeferredToolSurfaceErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DeferredToolSurfaceError'
  }
}

export interface DeferredToolSurfaceResolutionInput {
  readonly sessionId: string
  readonly messageId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly rawBinding: unknown
  readonly executionContract?: DeepChatExecutionContract
  readonly executionJournal: Pick<
    ExecutionJournalRecoveryReader,
    'hasAnyCommittedDispatchForMessageToolCall'
  >
  readonly viewManifests: Pick<TapeViewManifestReader, 'listViewManifestsByMessageRequest'>
  readonly toolSurfaces: Pick<
    TapeToolSurfaceViewReader,
    'listToolSurfaceFactsByMessage' | 'listToolSurfaceFactsByMessageRequest'
  >
}

function sameRequest(
  left: ToolSurfaceDeferredDispatchBindingV1['request'],
  right: ToolSurfaceDeferredDispatchBindingV1['request']
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.runId === right.runId &&
    left.requestSeq === right.requestSeq
  )
}

function assertBindingIdentity(
  binding: ToolSurfaceDeferredDispatchBindingV1,
  input: DeferredToolSurfaceResolutionInput
): void {
  if (
    binding.request.sessionId !== input.sessionId ||
    binding.request.messageId !== input.messageId ||
    binding.toolCallId !== input.toolCallId ||
    binding.toolName !== input.toolName
  ) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch does not match its durable Tool Surface identity.',
      'identity_mismatch'
    )
  }
  const contract = input.executionContract
  if (binding.contractBearing !== Boolean(contract)) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch Tool Surface contract mode does not match its provider View.',
      'invalid_binding'
    )
  }
  if (contract && !sameRequest(binding.request, contract.request)) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch Tool Surface does not match its ExecutionContract request.',
      'identity_mismatch'
    )
  }
}

function recoverDurableToolSurface(
  binding: ToolSurfaceDeferredDispatchBindingV1,
  input: DeferredToolSurfaceResolutionInput,
  surfaceRecords: ReturnType<TapeToolSurfaceViewReader['listToolSurfaceFactsByMessageRequest']>
): ToolExecutionContract {
  let manifestRecords
  try {
    manifestRecords = input.viewManifests.listViewManifestsByMessageRequest(
      input.sessionId,
      input.messageId,
      binding.request.requestSeq
    )
  } catch (error) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch could not recover its durable Tool Surface View.',
      'corruption',
      { cause: error }
    )
  }
  if (surfaceRecords.length !== 1 || manifestRecords.length !== 1) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch requires exactly one durable Tool Surface View.',
      'missing_surface'
    )
  }

  const fact = surfaceRecords[0].fact
  const manifest = manifestRecords[0].manifest
  const manifestExecutionContract = getTapeViewManifestExecutionContract(manifest)
  if (
    fact.contractBearing !== binding.contractBearing ||
    !sameRequest(fact.request, binding.request) ||
    manifestRecords[0].entryId >= surfaceRecords[0].entryId ||
    verifyTapeViewManifestHash(manifest) !== 'valid' ||
    fact.manifestHash !== manifest.hashes.manifestHash ||
    manifest.sessionId !== binding.request.sessionId ||
    manifest.messageId !== binding.request.messageId ||
    manifest.requestSeq !== binding.request.requestSeq ||
    (manifest.schemaVersion !== 4 &&
      manifest.schemaVersion !== 5 &&
      manifest.schemaVersion !== 6 &&
      manifest.schemaVersion !== 7) ||
    Boolean(manifestExecutionContract) !== binding.contractBearing ||
    ((manifest.schemaVersion === 6 || manifest.schemaVersion === 7) &&
      manifest.runId !== binding.request.runId) ||
    (manifestExecutionContract !== undefined &&
      !sameRequest(manifestExecutionContract.request, binding.request))
  ) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch durable Tool Surface View failed integrity validation.',
      'corruption'
    )
  }
  const activeEntries = fact.activeEntries.filter(
    (entry) => entry.stableTargetKey === binding.stableTargetKey
  )
  if (
    activeEntries.length !== 1 ||
    activeEntries[0].target.providerVisibleName !== binding.toolName ||
    activeEntries[0].canonicalToolDefinitionHash !== binding.canonicalToolDefinitionHash
  ) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch target is not proven by its durable Tool Surface View.',
      'corruption'
    )
  }
  return activeEntries[0].execution
}

function readMessageSurfaceRecords(
  input: DeferredToolSurfaceResolutionInput
): ReturnType<TapeToolSurfaceViewReader['listToolSurfaceFactsByMessage']> {
  try {
    return input.toolSurfaces.listToolSurfaceFactsByMessage(input.sessionId, input.messageId)
  } catch (error) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch could not inspect its durable Tool Surface Views.',
      'corruption',
      { cause: error }
    )
  }
}

function readRequestSurfaceRecords(
  binding: ToolSurfaceDeferredDispatchBindingV1,
  input: DeferredToolSurfaceResolutionInput
): ReturnType<TapeToolSurfaceViewReader['listToolSurfaceFactsByMessageRequest']> {
  try {
    return input.toolSurfaces.listToolSurfaceFactsByMessageRequest(
      input.sessionId,
      input.messageId,
      binding.request.requestSeq
    )
  } catch (error) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch could not recover its durable Tool Surface View.',
      'corruption',
      { cause: error }
    )
  }
}

export function resolveDeferredToolSurfaceDispatch(
  input: DeferredToolSurfaceResolutionInput
): ToolSurfaceDeferredDispatch | undefined {
  if (input.rawBinding === undefined) {
    if (readMessageSurfaceRecords(input).length > 0) {
      throw new DeferredToolSurfaceError(
        'Paused Tool Surface dispatch is missing its durable binding.',
        'invalid_binding'
      )
    }
    // Historical and legacy-adapter pauses predate Tool Surface bindings.
    return undefined
  }
  const binding = parseToolSurfaceDeferredDispatchBinding(input.rawBinding)
  if (!binding) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch has an invalid durable Tool Surface binding.',
      'invalid_binding'
    )
  }
  assertBindingIdentity(binding, input)

  const expectedCapabilityIdentity = {
    sessionId: input.sessionId,
    messageId: input.messageId,
    toolCallId: input.toolCallId,
    toolName: input.toolName
  }
  const processLive = getToolSurfaceDeferredDispatch(
    input.sessionId,
    input.messageId,
    input.toolCallId
  )
  if (processLive) {
    if (
      canonicalJsonStringifyData(processLive.binding) !== canonicalJsonStringifyData(binding)
    ) {
      throw new DeferredToolSurfaceError(
        'Paused tool dispatch active authority conflicts with its durable binding.',
        'corruption'
      )
    }
    try {
      claimToolSurfaceDeferredDispatch(processLive, expectedCapabilityIdentity)
    } catch (error) {
      throw new DeferredToolSurfaceError(
        'Paused tool dispatch active authority is already claimed.',
        'corruption',
        { cause: error }
      )
    }
    return processLive
  }

  if (
    input.executionJournal.hasAnyCommittedDispatchForMessageToolCall(
      input.sessionId,
      input.messageId,
      input.toolCallId
    )
  ) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch already crossed its durable dispatch boundary.',
      'spent_dispatch'
    )
  }

  const expectedExecution = recoverDurableToolSurface(
    binding,
    input,
    readRequestSurfaceRecords(binding, input)
  )
  try {
    return issueRecoveredToolSurfaceDeferredDispatch(binding, expectedExecution)
  } catch (error) {
    throw new DeferredToolSurfaceError(
      'Paused tool dispatch durable authority could not be claimed.',
      'corruption',
      { cause: error }
    )
  }
}
