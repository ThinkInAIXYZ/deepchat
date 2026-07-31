import { createHash } from 'node:crypto'

export function createWorkflowChildLineageSlot(runId: string, callPath: string): string {
  return `workflow-lineage:${hashIdentity([runId, callPath])}`
}

export function createWorkflowChildCorrelationSlot(
  runId: string,
  callPath: string,
  attempt: number
): string {
  return `workflow:${hashIdentity([runId, callPath, attempt])}`
}

function hashIdentity(parts: readonly (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
}
