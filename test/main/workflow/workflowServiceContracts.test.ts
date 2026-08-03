import { describe, expect, it } from 'vitest'
import { WorkflowUsageSchema } from '@shared/workflow/serviceContracts'
import {
  WORKFLOW_SAVED_MAX_ARGS_BYTES,
  WORKFLOW_SAVED_MAX_SOURCE_BYTES,
  WorkflowSavedArgsTextSchema,
  WorkflowSavedDocumentSchema
} from '@shared/workflow/savedWorkflow'

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

  it('applies saved Workflow limits to UTF-8 bytes', () => {
    const oversizedSource = '界'.repeat(Math.floor(WORKFLOW_SAVED_MAX_SOURCE_BYTES / 3) + 1)
    const oversizedArgs = '界'.repeat(Math.floor(WORKFLOW_SAVED_MAX_ARGS_BYTES / 3) + 1)

    expect(
      WorkflowSavedDocumentSchema.safeParse({
        name: 'review',
        relativePath: '.deepchat/workflows/review.js',
        absolutePath: '/repo/.deepchat/workflows/review.js',
        sourceHash: 'a'.repeat(64),
        source: oversizedSource,
        byteLength: WORKFLOW_SAVED_MAX_SOURCE_BYTES,
        updatedAt: 1
      }).success
    ).toBe(false)
    expect(WorkflowSavedArgsTextSchema.safeParse(oversizedArgs).success).toBe(false)
  })
})
