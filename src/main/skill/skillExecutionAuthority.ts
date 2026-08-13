import type { SkillServicePort } from '@shared/types/skill'
import type {
  DeepChatTapeSkillContextV7,
  DeepChatTapeSkillMaterializationRef,
  DeepChatTapeViewManifestV6,
  DeepChatTapeViewManifestV7
} from '@shared/types/tape-view-manifest'
import type {
  TapeExecutionViewManifestReader,
  TapeIncarnationReader,
  TapeSkillMaterializationReader
} from '@/tape/ports/capabilities'
import {
  buildTapeSkillMaterializationRef,
  type TapeSkillIdentity,
  type TapeSkillMaterializationPayload,
  type TapeSkillMaterializationRef
} from '@/tape/domain/skillMaterialization'
import { canonicalJsonStringifyData } from '@/tape/domain/canonicalJson'
import { verifyTapeViewManifestHash } from '@/tape/domain/viewManifest'

const SHA256 = /^[a-f0-9]{64}$/

export interface SkillExecutionRequestAuthority {
  sessionId: string
  runId: string
  requestSeq: number
  manifestHash: string
  tapeIncarnationId: string
  skillName: string
}

export interface ResolvedSkillExecutionAuthority {
  request: Readonly<SkillExecutionRequestAuthority>
  identity: Readonly<TapeSkillIdentity>
  materializationRef: Readonly<DeepChatTapeSkillMaterializationRef>
  executionPackage: Readonly<TapeSkillMaterializationPayload['executionPackage']>
  environment: Readonly<Record<string, string>>
}

export interface SkillExecutionAuthorityPort {
  resolve(input: SkillExecutionRequestAuthority): Promise<ResolvedSkillExecutionAuthority>
  assertCurrent(authority: ResolvedSkillExecutionAuthority): Promise<void>
}

type AuthorityManifest = DeepChatTapeViewManifestV6 | DeepChatTapeViewManifestV7
type AuthorityTapePort = TapeExecutionViewManifestReader &
  TapeIncarnationReader &
  TapeSkillMaterializationReader
type EnvironmentBindingPort = Pick<SkillServicePort, 'resolveSkillRuntimeEnvironmentBinding'>
type ReadAuthority = {
  manifest: AuthorityManifest
  context: DeepChatTapeSkillContextV7
  ref: DeepChatTapeSkillMaterializationRef
  payloadHash: string
  payload: TapeSkillMaterializationPayload
}

function canonicalId(value: string, field: string): string {
  if (!value || value !== value.trim() || value !== value.normalize('NFC')) {
    throw new TypeError(`${field} must be a canonical non-empty identifier.`)
  }
  return value
}

function validateRequest(input: SkillExecutionRequestAuthority): SkillExecutionRequestAuthority {
  if (!Number.isSafeInteger(input.requestSeq) || input.requestSeq <= 0) {
    throw new TypeError('requestSeq must be a positive safe integer.')
  }
  if (!SHA256.test(input.manifestHash)) {
    throw new TypeError('manifestHash must be a lowercase SHA-256 hash.')
  }
  return {
    sessionId: canonicalId(input.sessionId, 'sessionId'),
    runId: canonicalId(input.runId, 'runId'),
    requestSeq: input.requestSeq,
    manifestHash: input.manifestHash,
    tapeIncarnationId: canonicalId(input.tapeIncarnationId, 'tapeIncarnationId'),
    skillName: canonicalId(input.skillName, 'skillName')
  }
}

function cloneAndFreeze<T>(value: T): T {
  const clone = structuredClone(value)
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return
    for (const nested of Object.values(candidate)) visit(nested)
    Object.freeze(candidate)
  }
  visit(clone)
  return clone
}

function executionRefForContext(
  manifest: AuthorityManifest,
  context: DeepChatTapeSkillContextV7
): DeepChatTapeSkillMaterializationRef {
  if (context.activationScope === 'runtime_view') {
    if (manifest.schemaVersion !== 7 || !('executionRef' in context)) {
      throw new Error('Runtime Skill execution requires a schema-7 execution reference.')
    }
    return context.executionRef
  }
  return context.authoritativeRef
}

function requireMatchingContext(
  manifest: AuthorityManifest,
  skillName: string
): {
  context: DeepChatTapeSkillContextV7
  ref: DeepChatTapeSkillMaterializationRef
} {
  const matches = manifest.skillContexts.filter((context) => context.skillName === skillName)
  if (matches.length !== 1) {
    throw new Error('Skill execution authority is missing or ambiguous in the exact provider view.')
  }
  const context = matches[0] as DeepChatTapeSkillContextV7
  return { context, ref: executionRefForContext(manifest, context) }
}

function assertManifestBinding(
  manifest: AuthorityManifest,
  request: SkillExecutionRequestAuthority
): void {
  if (
    manifest.sessionId !== request.sessionId ||
    manifest.runId !== request.runId ||
    manifest.requestSeq !== request.requestSeq ||
    manifest.tapeIncarnationId !== request.tapeIncarnationId ||
    manifest.hashes.manifestHash !== request.manifestHash ||
    verifyTapeViewManifestHash(manifest) !== 'valid'
  ) {
    throw new Error('Skill execution ViewManifest authority drifted from the provider request.')
  }
}

function assertContextMatchesPayload(
  context: DeepChatTapeSkillContextV7,
  ref: DeepChatTapeSkillMaterializationRef,
  payload: TapeSkillMaterializationPayload
): void {
  if (
    payload.agentId !== context.agentId ||
    payload.sourceType !== context.sourceType ||
    payload.sourceId !== context.sourceId ||
    payload.skillName !== context.skillName ||
    (context.activationScope !== 'runtime_view' &&
      payload.effectiveContentHash !== context.projectedContentHash) ||
    ref.kind !== 'materialization' ||
    ref.tapeIncarnationId !== payload.tapeIncarnationId ||
    ref.agentId !== payload.agentId ||
    ref.sourceType !== payload.sourceType ||
    ref.sourceId !== payload.sourceId ||
    ref.skillName !== payload.skillName ||
    ref.effectiveContentHash !== payload.effectiveContentHash
  ) {
    throw new Error('Skill execution package drifted from its exact ViewManifest context.')
  }
}

function assertReadAuthorityUnchanged(before: ReadAuthority, after: ReadAuthority): void {
  if (
    before.manifest.hashes.manifestHash !== after.manifest.hashes.manifestHash ||
    canonicalJsonStringifyData(before.context) !== canonicalJsonStringifyData(after.context) ||
    canonicalJsonStringifyData(before.ref) !== canonicalJsonStringifyData(after.ref) ||
    before.payloadHash !== after.payloadHash
  ) {
    throw new Error('Skill execution authority changed while it was being resolved.')
  }
}

function assertResolvedAuthorityMatchesRead(
  authority: ResolvedSkillExecutionAuthority,
  read: ReadAuthority
): void {
  const { payload, ref } = read
  if (
    payload.agentId !== authority.identity.agentId ||
    payload.sourceType !== authority.identity.sourceType ||
    payload.sourceId !== authority.identity.sourceId ||
    payload.skillName !== authority.identity.skillName ||
    canonicalJsonStringifyData(ref) !== canonicalJsonStringifyData(authority.materializationRef) ||
    payload.executionPackage.packageHash !== authority.executionPackage.packageHash
  ) {
    throw new Error('Skill execution authority changed before process dispatch.')
  }
}

export class SkillExecutionAuthorityResolver implements SkillExecutionAuthorityPort {
  constructor(
    private readonly dependencies: {
      tape: AuthorityTapePort
      environments: EnvironmentBindingPort
    }
  ) {}

  async resolve(input: SkillExecutionRequestAuthority): Promise<ResolvedSkillExecutionAuthority> {
    const request = validateRequest(input)
    const before = this.readAuthority(request)
    const environment = await this.dependencies.environments.resolveSkillRuntimeEnvironmentBinding(
      before.payload.agentId,
      before.payload.skillName,
      before.payload.executionPackage.environmentBindingId
    )
    const current = this.readAuthority(request)
    assertReadAuthorityUnchanged(before, current)
    const { payload, ref } = current
    return Object.freeze({
      request: cloneAndFreeze(request),
      identity: cloneAndFreeze({
        agentId: payload.agentId,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        skillName: payload.skillName
      }),
      materializationRef: cloneAndFreeze(ref),
      executionPackage: cloneAndFreeze(payload.executionPackage),
      environment: cloneAndFreeze(environment)
    })
  }

  async assertCurrent(authority: ResolvedSkillExecutionAuthority): Promise<void> {
    const request = validateRequest(authority.request)
    const before = this.readAuthority(request)
    assertResolvedAuthorityMatchesRead(authority, before)
    const environment = await this.dependencies.environments.resolveSkillRuntimeEnvironmentBinding(
      before.payload.agentId,
      before.payload.skillName,
      before.payload.executionPackage.environmentBindingId
    )
    if (
      canonicalJsonStringifyData(environment) !== canonicalJsonStringifyData(authority.environment)
    ) {
      throw new Error('Skill execution environment changed before process dispatch.')
    }
    const current = this.readAuthority(request)
    assertReadAuthorityUnchanged(before, current)
    assertResolvedAuthorityMatchesRead(authority, current)
  }

  private readAuthority(request: SkillExecutionRequestAuthority): ReadAuthority {
    this.assertTapeIncarnation(request)
    const record = this.dependencies.tape.getViewManifestByExecutionBinding({
      sessionId: request.sessionId,
      runId: request.runId,
      requestSeq: request.requestSeq
    })
    if (!record || (record.manifest.schemaVersion !== 6 && record.manifest.schemaVersion !== 7)) {
      throw new Error('Exact Skill-bearing provider ViewManifest is unavailable.')
    }
    const manifest = record.manifest
    assertManifestBinding(manifest, request)
    const { context, ref } = requireMatchingContext(manifest, request.skillName)
    const materializationRef: TapeSkillMaterializationRef = {
      sessionId: request.sessionId,
      ...ref
    }
    const receipt = this.dependencies.tape.readSkillMaterialization(materializationRef)
    const canonicalRef = buildTapeSkillMaterializationRef(receipt)
    if (
      canonicalJsonStringifyData(canonicalRef) !== canonicalJsonStringifyData(materializationRef)
    ) {
      throw new Error('Skill execution materialization reference failed strict round-trip.')
    }
    assertContextMatchesPayload(context, ref, receipt.payload)
    return { manifest, context, ref, payloadHash: receipt.payloadHash, payload: receipt.payload }
  }

  private assertTapeIncarnation(request: SkillExecutionRequestAuthority): void {
    if (
      this.dependencies.tape.getTapeIncarnationId(request.sessionId) !== request.tapeIncarnationId
    ) {
      throw new Error('Skill execution authority belongs to another Session Tape incarnation.')
    }
  }
}
