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
  const canonical = canonicalizeWorkflowJson(parsed, {
    maxBytes: WORKFLOW_EXECUTION_SNAPSHOT_MAX_BYTES
  })
  return {
    snapshot: WorkflowExecutionSnapshotSchema.parse(canonical.value),
    json: canonical.json,
    sha256: canonical.sha256,
    byteLength: canonical.byteLength
  }
}
