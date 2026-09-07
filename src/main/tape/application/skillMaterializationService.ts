import {
  buildTapeSkillMaterializationPayloadHash,
  buildTapeSkillMaterializationProvenanceKey,
  canonicalSkillMaterializationPayload,
  readTapeSkillMaterializationRef,
  readTapeSkillMaterializationRow,
  validateTapeSkillMaterializationBatch,
  type TapeSkillMaterializationInput,
  type TapeSkillMaterializationPayload,
  type TapeSkillMaterializationRef,
  type TapeSkillMaterializationReceipt
} from '../domain/skillMaterialization'
import type {
  TapeSkillMaterializationReader,
  TapeSkillMaterializationWriter
} from '../ports/capabilities'
import type { TapeApplicationProviders } from '../ports/application'

type Providers = Pick<TapeApplicationProviders, 'getSkillMaterializationStore'>

function assertStoredPayload(
  receipt: TapeSkillMaterializationReceipt,
  expected: TapeSkillMaterializationPayload
): TapeSkillMaterializationReceipt {
  if (
    canonicalSkillMaterializationPayload(receipt.payload) !==
    canonicalSkillMaterializationPayload(expected)
  ) {
    throw new Error(
      'Stored Skill materialization canonical payload conflicts with the requested payload.'
    )
  }
  return receipt
}

export class TapeSkillMaterializationService
  implements TapeSkillMaterializationWriter, TapeSkillMaterializationReader
{
  constructor(private readonly providers: Providers) {}

  materializeSkillContexts(
    inputs: readonly TapeSkillMaterializationInput[]
  ): TapeSkillMaterializationReceipt[] {
    const payloads = validateTapeSkillMaterializationBatch(inputs)
    if (inputs.length === 0) return []
    const sessionId = inputs[0].sessionId
    if (!inputs.every((input) => input.sessionId === sessionId))
      throw new Error('A materialization batch must use one Session.')
    const table = this.providers.getSkillMaterializationStore()
    return table.runInTransaction(() => {
      table.ensureBootstrapAnchor(sessionId)
      const incarnation = table.getBootstrapIncarnation(sessionId)
      if (!incarnation) throw new Error('Session Tape bootstrap is missing or invalid.')
      return inputs.map((input, index) => {
        if (input.expectedTapeIncarnationId !== incarnation)
          throw new Error('Session Tape incarnation changed.')
        const payload = payloads[index]
        const provenanceKey = buildTapeSkillMaterializationProvenanceKey(sessionId, payload)
        const existing = table.getByProvenanceKey(sessionId, provenanceKey)
        if (existing) {
          return assertStoredPayload(readTapeSkillMaterializationRow(existing), payload)
        }
        const row = table.appendSkillMaterialization({
          sessionId,
          sourceId: payload.sourceId,
          provenanceKey,
          payload,
          payloadHash: buildTapeSkillMaterializationPayloadHash(payload)
        })
        return assertStoredPayload(readTapeSkillMaterializationRow(row), payload)
      })
    })
  }

  readSkillMaterialization(ref: TapeSkillMaterializationRef): TapeSkillMaterializationReceipt {
    const table = this.providers.getSkillMaterializationStore()
    return table.runInTransaction(() => {
      const incarnation = table.getBootstrapIncarnation(ref.sessionId)
      if (incarnation !== ref.tapeIncarnationId) {
        throw new Error('Session Tape incarnation changed.')
      }
      const row = table.getByEntryId(ref.sessionId, ref.entryId)
      if (!row) throw new Error('Skill materialization reference is missing.')
      return readTapeSkillMaterializationRef(row, ref)
    })
  }
}
