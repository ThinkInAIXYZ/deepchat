import { hashJsonData } from '@/tape/domain/canonicalJson'
import type {
  AutomaticToolSurfaceRunModeAssignment,
  ToolSurfaceRunModeAssignment
} from './toolSurfaceSelection'

const TOOL_SURFACE_ROLLOUT_BUCKET_COUNT = 10_000
const MAX_TOOL_SURFACE_ROLLOUT_EVIDENCE = 4_096
const MAX_TOOL_SURFACE_ROLLOUT_EVIDENCE_BYTES = 1024 * 1024
const MAX_TOOL_SURFACE_ROLLOUT_FIELD_CODE_UNITS = 1_024
const MAX_TOOL_SURFACE_ROLLOUT_FIELD_BYTES = 4_096

export interface MeasuredToolSurfaceCliCapabilityEvidenceV1 {
  readonly protocolVersion: 'cli-programmatic-v1'
  readonly evidenceVersion: string
  readonly providerId: string
  readonly modelId: string
  readonly outcome: 'proven'
}

export interface ToolSurfaceRolloutPolicyV1 {
  readonly policyVersion: string
  readonly canaryBasisPoints: number
  readonly measuredCliCapabilityEvidence: readonly MeasuredToolSurfaceCliCapabilityEvidenceV1[]
}

/**
 * Production remains on the legacy path until a reviewed policy supplies a non-zero canary. CLI
 * Programmatic additionally requires exact measured provider/model evidence; provider model
 * metadata is deliberately not evidence.
 */
export const TOOL_SURFACE_PRODUCTION_ROLLOUT_POLICY_V1: ToolSurfaceRolloutPolicyV1 = Object.freeze({
  policyVersion: 'tool-surface-production-rollout-v1',
  canaryBasisPoints: 0,
  measuredCliCapabilityEvidence: Object.freeze([])
})

const PROVEN_ASSIGNMENT: AutomaticToolSurfaceRunModeAssignment = Object.freeze({
  mode: 'automatic',
  cliProgrammaticCapability: 'proven'
})
const UNPROVEN_ASSIGNMENT: AutomaticToolSurfaceRunModeAssignment = Object.freeze({
  mode: 'automatic',
  cliProgrammaticCapability: 'unproven'
})

function isBoundedRolloutField(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_TOOL_SURFACE_ROLLOUT_FIELD_CODE_UNITS &&
    value === value.trim() &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= MAX_TOOL_SURFACE_ROLLOUT_FIELD_BYTES
  )
}

function capabilityEvidenceKey(providerId: string, modelId: string): string {
  return hashJsonData({
    domain: 'tool-surface-cli-capability-evidence-v1',
    providerId,
    modelId
  })
}

/**
 * Process-live rollout owner. It hashes scope only for stable local cohort assignment, persists
 * nothing, reads no Tape, and never grants tool-dispatch authority.
 */
export class ToolSurfaceRolloutOwner {
  private readonly policyVersion: string
  private readonly canaryBasisPoints: number
  private readonly provenCapabilityKeys: ReadonlySet<string>

  constructor(policy: ToolSurfaceRolloutPolicyV1) {
    if (
      !isBoundedRolloutField(policy.policyVersion) ||
      !Number.isSafeInteger(policy.canaryBasisPoints) ||
      policy.canaryBasisPoints < 0 ||
      policy.canaryBasisPoints > TOOL_SURFACE_ROLLOUT_BUCKET_COUNT ||
      !Array.isArray(policy.measuredCliCapabilityEvidence) ||
      policy.measuredCliCapabilityEvidence.length > MAX_TOOL_SURFACE_ROLLOUT_EVIDENCE
    ) {
      throw new Error('Tool Surface rollout policy is invalid.')
    }

    const provenCapabilityKeys = new Set<string>()
    let retainedEvidenceBytes = 0
    for (const evidence of policy.measuredCliCapabilityEvidence) {
      if (
        evidence.protocolVersion !== 'cli-programmatic-v1' ||
        evidence.outcome !== 'proven' ||
        !isBoundedRolloutField(evidence.evidenceVersion) ||
        !isBoundedRolloutField(evidence.providerId) ||
        !isBoundedRolloutField(evidence.modelId)
      ) {
        throw new Error('Tool Surface CLI capability evidence is invalid.')
      }
      retainedEvidenceBytes += Buffer.byteLength(
        `${evidence.protocolVersion}\0${evidence.evidenceVersion}\0${evidence.providerId}\0${evidence.modelId}\0${evidence.outcome}`,
        'utf8'
      )
      if (retainedEvidenceBytes > MAX_TOOL_SURFACE_ROLLOUT_EVIDENCE_BYTES) {
        throw new Error('Tool Surface CLI capability evidence exceeds its aggregate byte limit.')
      }
      const key = capabilityEvidenceKey(evidence.providerId, evidence.modelId)
      if (provenCapabilityKeys.has(key)) {
        throw new Error('Tool Surface CLI capability evidence contains a duplicate model scope.')
      }
      provenCapabilityKeys.add(key)
    }

    this.policyVersion = policy.policyVersion
    this.canaryBasisPoints = policy.canaryBasisPoints
    this.provenCapabilityKeys = provenCapabilityKeys
  }

  resolve(input: {
    readonly sessionId: string
    readonly providerId: string
    readonly modelId: string
  }): ToolSurfaceRunModeAssignment {
    if (this.canaryBasisPoints === 0) return 'legacy'
    try {
      if (
        !isBoundedRolloutField(input.sessionId) ||
        !isBoundedRolloutField(input.providerId) ||
        !isBoundedRolloutField(input.modelId)
      ) {
        return 'legacy'
      }
      const digest = hashJsonData({
        domain: 'tool-surface-rollout-bucket-v1',
        policyVersion: this.policyVersion,
        sessionId: input.sessionId,
        providerId: input.providerId,
        modelId: input.modelId
      })
      const bucket = Number.parseInt(digest.slice(0, 8), 16) % TOOL_SURFACE_ROLLOUT_BUCKET_COUNT
      if (!Number.isSafeInteger(bucket) || bucket >= this.canaryBasisPoints) return 'legacy'

      return this.provenCapabilityKeys.has(
        capabilityEvidenceKey(input.providerId, input.modelId)
      )
        ? PROVEN_ASSIGNMENT
        : UNPROVEN_ASSIGNMENT
    } catch {
      return 'legacy'
    }
  }
}
