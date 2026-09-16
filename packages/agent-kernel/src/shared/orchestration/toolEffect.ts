import { z } from 'zod'

export const ORCHESTRATION_EFFECT_STATES = ['none', 'read', 'unknown', 'write'] as const
export const OrchestrationEffectStateSchema = z.enum(ORCHESTRATION_EFFECT_STATES)

export const OrchestrationEffectEvidenceSchema = z
  .object({
    toolId: z.string().trim().min(1).max(256),
    toolCallId: z.string().trim().min(1).max(256).optional(),
    source: z.enum(['builtin', 'mcp', 'plugin', 'shell', 'unknown']),
    basis: z.enum(['reviewed_contract', 'conservative_fallback']),
    classification: z.enum(['read', 'unknown', 'write']),
    reason: z.string().trim().min(1).max(1_024)
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.classification === 'read' &&
      (evidence.source !== 'builtin' || evidence.basis !== 'reviewed_contract')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Read-only recovery requires a reviewed built-in tool contract'
      })
    }
    if (evidence.source === 'shell' && evidence.classification !== 'write') {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Shell execution must be conservatively classified as write'
      })
    }
  })

export type OrchestrationEffectState = z.infer<typeof OrchestrationEffectStateSchema>
export type OrchestrationEffectEvidence = z.infer<typeof OrchestrationEffectEvidenceSchema>
