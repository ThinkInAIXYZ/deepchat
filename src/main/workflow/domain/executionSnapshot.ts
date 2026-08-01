import {
  WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES,
  WorkflowExecutionSnapshotSchema,
  type WorkflowExecutionSnapshot
} from '@shared/workflow/domain'
import { canonicalizeWorkflowJson } from './json'

export interface CanonicalWorkflowExecutionSnapshot {
  snapshot: WorkflowExecutionSnapshot
  json: string
  sha256: string
  byteLength: number
}

export function canonicalizeWorkflowExecutionSnapshot(
  value: unknown
): CanonicalWorkflowExecutionSnapshot {
  const parsed = WorkflowExecutionSnapshotSchema.parse(value)
  const normalized = omitUndefinedObjectProperties(parsed)
  const canonical = canonicalizeWorkflowJson(normalized, {
    maxBytes: WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES
  })
  return {
    snapshot: WorkflowExecutionSnapshotSchema.parse(canonical.value),
    json: canonical.json,
    sha256: canonical.sha256,
    byteLength: canonical.byteLength
  }
}

function omitUndefinedObjectProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitUndefinedObjectProperties)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, propertyValue]) => propertyValue !== undefined)
      .map(([key, propertyValue]) => [key, omitUndefinedObjectProperties(propertyValue)])
  )
}
