import type { JsonValue } from '@shared/contracts/common'
import { WORKFLOW_SAVED_MAX_ARGS_BYTES } from '@shared/workflow/savedWorkflow'
import { canonicalizeWorkflowJson } from './domain/json'

export function parseWorkflowSavedArgs(argsText: string): JsonValue {
  if (Buffer.byteLength(argsText, 'utf8') > WORKFLOW_SAVED_MAX_ARGS_BYTES) {
    throw new Error(`Workflow args exceed the ${WORKFLOW_SAVED_MAX_ARGS_BYTES}-byte limit.`)
  }
  const normalized = argsText.trim()
  if (!normalized) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch (error) {
    throw new Error('Workflow args must be valid JSON.', { cause: error })
  }
  return canonicalizeWorkflowJson(parsed, {
    maxBytes: WORKFLOW_SAVED_MAX_ARGS_BYTES
  }).value
}
