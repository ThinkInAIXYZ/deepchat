import type { SkillServicePort, EffectiveSkillContentResolution } from '@shared/types/skill'
import type {
  DeepChatTapeMaterializedSkillContext,
  DeepChatTapeSkillContext,
  DeepChatTapeSkillContextV7,
  DeepChatTapeSkillMaterializationRef,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import { renderSessionSkillBody } from '../resources/systemPromptBuilder'
import type {
  TapeEffectiveUserMessageSourceReader,
  TapeIncarnationReader,
  TapeRunViewManifestReader,
  TapeSkillMaterializationReader,
  TapeSkillMaterializationWriter
} from '@/tape/ports/capabilities'
import {
  buildTapeSkillMaterializationPayloadHash,
  buildTapeSkillMaterializationProvenanceKey,
  buildTapeSkillMaterializationRef,
  canonicalSkillMaterializationPayload,
  MAX_SKILL_MATERIALIZATION_BATCH_COUNT,
  validateTapeSkillMaterializationBatch,
  type TapeSkillMaterializationInput,
  type TapeSkillMaterializationPayload,
  type TapeSkillMaterializationReceipt,
  type TapeSkillMaterializationRef
} from '@/tape/domain/skillMaterialization'
import {
  validateSchema6SkillContexts,
  validateSchema7SkillContexts
} from '@/tape/domain/skillContext'
import { canonicalJsonStringifyData } from '@/tape/domain/canonicalJson'

export type MaterializedSkillScope = 'message' | 'session'

export interface PreparedSkillContext {
  readonly scope: MaterializedSkillScope
  readonly materializationInput: TapeSkillMaterializationInput
}

export interface PreparedSkillContextBatch {
  readonly sessionId: string
  readonly agentId: string
  readonly items: readonly PreparedSkillContext[]
}

export interface MaterializedSkillProjection {
  readonly scope: MaterializedSkillScope
  readonly effectiveContent: string
  readonly completeBodyFragment: string
  readonly context: DeepChatTapeMaterializedSkillContext
  readonly ref: TapeSkillMaterializationRef
}

export interface SkillProjectionBodies {
  readonly sessionSkillBodies: readonly Readonly<{ name: string; content: string }>[]
  readonly messageActiveTurnContext: string | null
}

export interface RuntimeSkillExecutionMaterializer {
  materializeRuntimeView(input: {
    sessionId: string
    expectedTapeIncarnationId: string
    resolution: EffectiveSkillContentResolution
    abortSignal: AbortSignal
  }): Promise<DeepChatTapeSkillMaterializationRef>
}

export interface RecoveredSkillContextBatch {
  readonly foundSkillManifest: boolean
  readonly projections: readonly MaterializedSkillProjection[]
}

type SkillResolver = Pick<SkillServicePort, 'resolveFreshEffectiveSkillContents'>
type FreshTapePort = TapeIncarnationReader
type MaterializationTapePort = TapeSkillMaterializationWriter &
  TapeSkillMaterializationReader &
  TapeEffectiveUserMessageSourceReader
type RecoveryTapePort = TapeSkillMaterializationReader &
  TapeRunViewManifestReader
type SkillContextTapePort = FreshTapePort & MaterializationTapePort & RecoveryTapePort

function canonicalName(name: string, field: string): string {
  if (typeof name !== 'string' || !name || name !== name.trim() || name !== name.normalize('NFC')) {
    throw new TypeError(`${field} must contain canonical non-empty Skill names.`)
  }
  return name
}

function validateNames(names: readonly string[], field: string): string[] {
  const result = names.map((name) => canonicalName(name, field))
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${field} must not contain duplicate Skill names.`)
  }
  return result
}

function requireId(value: string, field: string): string {
  if (!value || value !== value.trim() || value !== value.normalize('NFC')) {
    throw new TypeError(`${field} must be a canonical non-empty identifier.`)
  }
  return value
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

function assertResolution(
  resolution: EffectiveSkillContentResolution,
  agentId: string,
  name: string
): void {
  if (
    resolution.identity.agentId !== agentId ||
    resolution.identity.skillName !== name ||
    typeof resolution.effectiveContent !== 'string' ||
    !resolution.effectiveContent
  ) {
    throw new Error('Fresh Skill resolution identity, order, or content did not match the request.')
  }
}

function payloadMatches(
  left: TapeSkillMaterializationPayload,
  right: TapeSkillMaterializationPayload
): boolean {
  return canonicalSkillMaterializationPayload(left) === canonicalSkillMaterializationPayload(right)
}

function assertReceiptMatches(
  receipt: TapeSkillMaterializationReceipt,
  ref: TapeSkillMaterializationRef,
  expectedPayload?: TapeSkillMaterializationPayload
): void {
  if (
    receipt.sessionId !== ref.sessionId ||
    receipt.entryId !== ref.entryId ||
    receipt.tapeIncarnationId !== ref.tapeIncarnationId ||
    receipt.provenanceKey !==
      buildTapeSkillMaterializationProvenanceKey(receipt.sessionId, receipt.payload) ||
    receipt.payloadHash !== buildTapeSkillMaterializationPayloadHash(receipt.payload) ||
    canonicalJsonStringifyData(buildTapeSkillMaterializationRef(receipt)) !==
      canonicalJsonStringifyData(ref) ||
    (expectedPayload !== undefined && !payloadMatches(receipt.payload, expectedPayload))
  ) {
    throw new Error('Skill materialization receipt, reference, or payload drifted.')
  }
}

function freezeProjection(projection: MaterializedSkillProjection): MaterializedSkillProjection {
  Object.freeze(projection.context.sourceEntryIds)
  Object.freeze(projection.context.authoritativeRef)
  Object.freeze(projection.context)
  Object.freeze(projection.ref)
  return Object.freeze(projection)
}

export function renderMessageActiveTurnSkillBody(
  skill: Readonly<{ name: string; content: string }>
): string {
  if (!skill.name || skill.name !== skill.name.trim() || !skill.content) {
    throw new Error('Message Skill body projection is invalid.')
  }
  return [`### ${skill.name}`, skill.content].join('\n')
}

export function renderMessageActiveTurnSkillContext(
  skills: readonly Readonly<{ name: string; content: string }>[]
): string | null {
  if (skills.length === 0) return null
  return [
    '## Skills Selected for This Turn',
    'These Skill instructions apply only to this user turn. Follow them when relevant.',
    '',
    skills.map(renderMessageActiveTurnSkillBody).join('\n\n')
  ].join('\n')
}

function freezeProjectionBodies(
  items: readonly Readonly<{
    scope: MaterializedSkillScope
    name: string
    content: string
  }>[]
): SkillProjectionBodies {
  const sessionSkillBodies = items
    .filter(({ scope }) => scope === 'session')
    .map(({ name, content }) => Object.freeze({ name, content }))
  const messageSkills = items
    .filter(({ scope }) => scope === 'message')
    .map(({ name, content }) => ({ name, content }))
  return Object.freeze({
    sessionSkillBodies: Object.freeze(sessionSkillBodies),
    messageActiveTurnContext: renderMessageActiveTurnSkillContext(messageSkills)
  })
}

function project(
  scope: MaterializedSkillScope,
  payload: TapeSkillMaterializationPayload,
  ref: TapeSkillMaterializationRef,
  sourceEntryIds: number[]
): MaterializedSkillProjection {
  const { sessionId: _sessionId, ...manifestRef } = ref
  const context: DeepChatTapeMaterializedSkillContext = {
    activationScope: scope,
    agentId: payload.agentId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    skillName: payload.skillName,
    authoritativeRef: manifestRef,
    providerRole: scope === 'message' ? 'user' : 'system',
    sourceEntryIds,
    projectedContentHash: payload.effectiveContentHash,
    projectionVersion: 1,
    deduplicationSource: scope
  }
  return freezeProjection({
    scope,
    effectiveContent: payload.effectiveContent,
    completeBodyFragment:
      scope === 'message'
        ? renderMessageActiveTurnSkillBody({
            name: payload.skillName,
            content: payload.effectiveContent
          })
        : renderSessionSkillBody({ name: payload.skillName, content: payload.effectiveContent }),
    context,
    ref
  })
}

export class SkillContextMaterializer {
  private readonly preparedBatches = new WeakSet<PreparedSkillContextBatch>()

  constructor(
    private readonly dependencies: {
      skills: SkillResolver
      tape: SkillContextTapePort
    }
  ) {}

  async prepareFresh(input: {
    sessionId: string
    agentId: string
    messageSkillNames: readonly string[]
    sessionSkillNames: readonly string[]
  }): Promise<PreparedSkillContextBatch> {
    // This branch deliberately precedes all validation and collaborator calls: the overwhelmingly
    // common no-Skill path is constant work and cannot touch source or Tape state.
    if (input.messageSkillNames.length === 0 && input.sessionSkillNames.length === 0) {
      const empty = Object.freeze({
        sessionId: input.sessionId,
        agentId: input.agentId,
        items: Object.freeze([])
      })
      this.preparedBatches.add(empty)
      return empty
    }
    const sessionId = requireId(input.sessionId, 'sessionId')
    const agentId = requireId(input.agentId, 'agentId')
    const sessionNames = validateNames(input.sessionSkillNames, 'sessionSkillNames')
    const messageNames = validateNames(input.messageSkillNames, 'messageSkillNames')
    const sessionSet = new Set(sessionNames)
    const ordered = [
      ...sessionNames.map((name) => ({ name, scope: 'session' as const })),
      ...messageNames
        .filter((name) => !sessionSet.has(name))
        .map((name) => ({ name, scope: 'message' as const }))
    ]
    if (ordered.length > MAX_SKILL_MATERIALIZATION_BATCH_COUNT) {
      throw new RangeError(
        `Skill materialization batch exceeds ${MAX_SKILL_MATERIALIZATION_BATCH_COUNT} bodies.`
      )
    }
    const resolutions = await this.dependencies.skills.resolveFreshEffectiveSkillContents(
      agentId,
      ordered.map(({ name }) => name)
    )
    if (resolutions.length !== ordered.length) {
      throw new Error('Fresh Skill resolution count did not match the request.')
    }
    resolutions.forEach((resolution, index) =>
      assertResolution(resolution, agentId, ordered[index].name)
    )
    const expectedTapeIncarnationId = this.dependencies.tape.getTapeIncarnationId(sessionId)
    const inputs = resolutions.map((resolution): TapeSkillMaterializationInput => ({
      sessionId,
      expectedTapeIncarnationId,
      ...resolution.identity,
      effectiveContent: resolution.effectiveContent,
      builderVersion: resolution.builderVersion,
      renderedManifestHash: resolution.renderedManifestHash,
      scriptInventoryHash: resolution.scriptInventoryHash,
      executionPackage: resolution.executionPackage
    }))
    validateTapeSkillMaterializationBatch(inputs)
    const items = inputs.map((materializationInput, index) => {
      return Object.freeze({
        scope: ordered[index].scope,
        materializationInput: cloneAndFreeze(materializationInput)
      })
    })
    const prepared = Object.freeze({ sessionId, agentId, items: Object.freeze(items) })
    this.preparedBatches.add(prepared)
    return prepared
  }

  preview(prepared: PreparedSkillContextBatch): SkillProjectionBodies {
    if (!this.preparedBatches.has(prepared)) {
      throw new Error('Skill context batch was not prepared by this materializer.')
    }
    return freezeProjectionBodies(
      prepared.items.map(({ scope, materializationInput }) => ({
        scope,
        name: materializationInput.skillName,
        content: materializationInput.effectiveContent
      }))
    )
  }

  projectBodies(
    projections: readonly MaterializedSkillProjection[]
  ): SkillProjectionBodies {
    for (const projection of projections) {
      const expectedFragment =
        projection.scope === 'message'
          ? renderMessageActiveTurnSkillBody({
              name: projection.context.skillName,
              content: projection.effectiveContent
            })
          : renderSessionSkillBody({
              name: projection.context.skillName,
              content: projection.effectiveContent
            })
      if (
        projection.context.activationScope !== projection.scope ||
        projection.completeBodyFragment !== expectedFragment
      ) {
        throw new Error('Materialized Skill projection cannot be rendered because it drifted.')
      }
    }
    return freezeProjectionBodies(
      projections.map((projection) => ({
        scope: projection.scope,
        name: projection.context.skillName,
        content: projection.effectiveContent
      }))
    )
  }

  async materializeRuntimeView(input: {
    sessionId: string
    expectedTapeIncarnationId: string
    resolution: EffectiveSkillContentResolution
    abortSignal: AbortSignal
  }): Promise<DeepChatTapeSkillMaterializationRef> {
    input.abortSignal.throwIfAborted()
    const sessionId = requireId(input.sessionId, 'sessionId')
    const expectedTapeIncarnationId = requireId(
      input.expectedTapeIncarnationId,
      'expectedTapeIncarnationId'
    )
    const resolution = cloneAndFreeze(input.resolution)
    const agentId = requireId(resolution.identity.agentId, 'resolution.identity.agentId')
    const skillName = canonicalName(
      resolution.identity.skillName,
      'resolution.identity.skillName'
    )
    if (!resolution.identity.sourceType || !resolution.identity.sourceId.trim()) {
      throw new Error('Runtime Skill materialization identity is invalid.')
    }
    assertResolution(resolution, agentId, skillName)
    if (this.dependencies.tape.getTapeIncarnationId(sessionId) !== expectedTapeIncarnationId) {
      throw new Error('Runtime Skill materialization belongs to another Session Tape incarnation.')
    }

    const materializationInput: TapeSkillMaterializationInput = {
      sessionId,
      expectedTapeIncarnationId,
      ...resolution.identity,
      effectiveContent: resolution.effectiveContent,
      builderVersion: resolution.builderVersion,
      renderedManifestHash: resolution.renderedManifestHash,
      scriptInventoryHash: resolution.scriptInventoryHash,
      executionPackage: resolution.executionPackage
    }
    const [expectedPayload] = validateTapeSkillMaterializationBatch([materializationInput])
    input.abortSignal.throwIfAborted()
    const receipts = this.dependencies.tape.materializeSkillContexts([materializationInput])
    if (receipts.length !== 1) {
      throw new Error('Runtime Skill materialization receipt count did not match the request.')
    }
    const receipt = receipts[0]
    const ref = buildTapeSkillMaterializationRef(receipt)
    assertReceiptMatches(receipt, ref, expectedPayload)
    const roundTrip = this.dependencies.tape.readSkillMaterialization(ref)
    if (
      roundTrip.sessionId !== sessionId ||
      roundTrip.tapeIncarnationId !== expectedTapeIncarnationId ||
      !payloadMatches(roundTrip.payload, expectedPayload)
    ) {
      throw new Error('Runtime Skill materialization strict round-trip did not match its package.')
    }
    assertReceiptMatches(roundTrip, ref, expectedPayload)
    const { sessionId: refSessionId, ...manifestRef } = ref
    if (refSessionId !== sessionId) {
      throw new Error('Runtime Skill materialization reference belongs to another Session.')
    }
    return Object.freeze(manifestRef)
  }

  materialize(
    prepared: PreparedSkillContextBatch,
    triggeringUserMessageId: string
  ): readonly MaterializedSkillProjection[] {
    if (!this.preparedBatches.has(prepared)) {
      throw new Error('Skill context batch was not prepared by this materializer.')
    }
    if (prepared.items.length === 0) return Object.freeze([])
    const expectedPayloads = validateTapeSkillMaterializationBatch(
      prepared.items.map(({ materializationInput }) => materializationInput)
    )
    if (
      prepared.items.some(
        (item) =>
          item.materializationInput.sessionId !== prepared.sessionId ||
          item.materializationInput.agentId !== prepared.agentId ||
          (item.scope !== 'message' && item.scope !== 'session')
      )
    ) {
      throw new Error('Prepared Skill context batch no longer matches its validated payloads.')
    }
    const messageItems = prepared.items.filter(({ scope }) => scope === 'message')
    let messageEntryId: number | null = null
    if (messageItems.length > 0) {
      messageEntryId = this.dependencies.tape.getEffectiveUserMessageSourceEntryId(
        prepared.sessionId,
        triggeringUserMessageId
      )
      if (messageEntryId === null) {
        throw new Error('Triggering user message Tape source fact is missing.')
      }
    }
    const receipts = this.dependencies.tape.materializeSkillContexts(
      prepared.items.map(({ materializationInput }) => materializationInput)
    )
    if (receipts.length !== prepared.items.length) {
      throw new Error('Skill materialization receipt count did not match the request.')
    }
    const projections = receipts.map((receipt, index) => {
      const expected = prepared.items[index]
      const expectedPayload = expectedPayloads[index]
      const ref = buildTapeSkillMaterializationRef(receipt)
      assertReceiptMatches(receipt, ref, expectedPayload)
      const roundTrip = this.dependencies.tape.readSkillMaterialization(ref)
      if (
        roundTrip.sessionId !== prepared.sessionId ||
        roundTrip.tapeIncarnationId !== expectedPayload.tapeIncarnationId ||
        !payloadMatches(roundTrip.payload, expectedPayload)
      ) {
        throw new Error(
          'Skill materialization strict round-trip did not match its prepared payload.'
        )
      }
      assertReceiptMatches(roundTrip, ref, expectedPayload)
      return project(
        expected.scope,
        roundTrip.payload,
        ref,
        expected.scope === 'message' ? [messageEntryId!] : []
      )
    })
    validateSchema6SkillContexts(projections.map(({ context }) => context))
    return Object.freeze(projections)
  }

  recoverResume(input: {
    sessionId: string
    previousRunId: string
    assistantMessageId: string
  }): RecoveredSkillContextBatch {
    const sessionId = requireId(input.sessionId, 'sessionId')
    const previousRunId = requireId(input.previousRunId, 'previousRunId')
    const assistantMessageId = requireId(input.assistantMessageId, 'assistantMessageId')
    const exact = this.dependencies.tape.getLatestViewManifestByRunBinding({
      sessionId,
      messageId: assistantMessageId,
      runId: previousRunId
    })
    if (!exact) {
      return Object.freeze({ foundSkillManifest: false, projections: Object.freeze([]) })
    }
    if (exact.messageId !== assistantMessageId) {
      throw new Error('Exact prior-run Skill ViewManifest could not be recovered.')
    }
    return Object.freeze({
      foundSkillManifest: true,
      projections: this.recoverManifestMaterializations(exact)
    })
  }

  private recoverManifestMaterializations(
    record: DeepChatTapeViewManifestRecord
  ): readonly MaterializedSkillProjection[] {
    const manifest = record.manifest
    if (manifest.schemaVersion !== 6 && manifest.schemaVersion !== 7) return Object.freeze([])
    const contexts: DeepChatTapeSkillContext[] | DeepChatTapeSkillContextV7[] =
      manifest.schemaVersion === 6
        ? validateSchema6SkillContexts(manifest.skillContexts)
        : validateSchema7SkillContexts(manifest.skillContexts)
    const materializedContexts = contexts.filter(
      (context): context is DeepChatTapeMaterializedSkillContext =>
        context.activationScope === 'message' || context.activationScope === 'session'
    )
    if (materializedContexts.length === 0) return Object.freeze([])
    const projections = materializedContexts.map((context) => {
      const ref: TapeSkillMaterializationRef = {
        sessionId: manifest.sessionId,
        ...context.authoritativeRef
      }
      const receipt = this.dependencies.tape.readSkillMaterialization(ref)
      assertReceiptMatches(receipt, ref)
      if (
        receipt.tapeIncarnationId !== manifest.tapeIncarnationId ||
        receipt.payload.agentId !== context.agentId ||
        receipt.payload.sourceType !== context.sourceType ||
        receipt.payload.sourceId !== context.sourceId ||
        receipt.payload.skillName !== context.skillName ||
        receipt.payload.effectiveContentHash !== context.projectedContentHash
      ) {
        throw new Error('Recovered Skill materialization drifted from its exact ViewManifest.')
      }
      const projection = project(
        context.activationScope,
        receipt.payload,
        ref,
        [...context.sourceEntryIds]
      )
      if (
        canonicalJsonStringifyData(projection.context) !== canonicalJsonStringifyData(context)
      ) {
        throw new Error('Recovered Skill projection semantics are unsupported or drifted.')
      }
      return projection
    })
    validateSchema6SkillContexts(projections.map(({ context }) => context))
    return Object.freeze(projections)
  }
}
