import { describe, expect, it } from 'vitest'
import { WorkflowUsageSchema } from '@shared/workflow/serviceContracts'

describe('Workflow service contracts', () => {
  it('accepts extensible usage metrics without prototype-sensitive keys', () => {
    expect(
      WorkflowUsageSchema.parse({
        inputTokens: 7,
        providerCacheHits: 2
      })
    ).toEqual({
      inputTokens: 7,
      providerCacheHits: 2
    })
    expect(WorkflowUsageSchema.safeParse({ toString: 1 }).success).toBe(false)
    expect(WorkflowUsageSchema.safeParse({ constructor: 1 }).success).toBe(false)
  })
})
