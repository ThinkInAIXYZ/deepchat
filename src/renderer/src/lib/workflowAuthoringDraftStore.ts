import type { WorkflowSavedDocument } from '@shared/workflow/savedWorkflow'

export const WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES = 8
export const WORKFLOW_AUTHORING_DRAFT_MAX_TOTAL_BYTES = 4 * 1024 * 1024

export interface WorkflowAuthoringDraft {
  selectedName: string
  document: WorkflowSavedDocument | null
  draftName: string
  draftSource: string
  argsText: string
  agentIdsText: string
}

interface StoredWorkflowAuthoringDraft {
  draft: WorkflowAuthoringDraft
  byteLength: number
}

const drafts = new Map<string, StoredWorkflowAuthoringDraft>()
let totalBytes = 0

export function saveWorkflowAuthoringDraft(
  sessionId: string,
  directoryPath: string,
  draft: WorkflowAuthoringDraft
): boolean {
  const key = createDraftKey(sessionId, directoryPath)
  const snapshot = cloneDraft(draft)
  const byteLength = measureDraft(snapshot)
  if (byteLength > WORKFLOW_AUTHORING_DRAFT_MAX_TOTAL_BYTES) {
    deleteWorkflowAuthoringDraft(sessionId, directoryPath)
    return false
  }

  const existing = drafts.get(key)
  if (existing) {
    drafts.delete(key)
    totalBytes -= existing.byteLength
  }
  drafts.set(key, { draft: snapshot, byteLength })
  totalBytes += byteLength
  evictOverflow()
  return drafts.has(key)
}

export function readWorkflowAuthoringDraft(
  sessionId: string,
  directoryPath: string
): WorkflowAuthoringDraft | null {
  const key = createDraftKey(sessionId, directoryPath)
  const stored = drafts.get(key)
  if (!stored) {
    return null
  }
  drafts.delete(key)
  drafts.set(key, stored)
  return cloneDraft(stored.draft)
}

export function deleteWorkflowAuthoringDraft(sessionId: string, directoryPath: string): void {
  const key = createDraftKey(sessionId, directoryPath)
  const stored = drafts.get(key)
  if (!stored) {
    return
  }
  drafts.delete(key)
  totalBytes -= stored.byteLength
}

function evictOverflow(): void {
  while (
    drafts.size > WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES ||
    totalBytes > WORKFLOW_AUTHORING_DRAFT_MAX_TOTAL_BYTES
  ) {
    const oldestKey = drafts.keys().next().value
    if (oldestKey === undefined) {
      totalBytes = 0
      return
    }
    const oldest = drafts.get(oldestKey)
    drafts.delete(oldestKey)
    totalBytes -= oldest?.byteLength ?? 0
  }
}

function createDraftKey(sessionId: string, directoryPath: string): string {
  return JSON.stringify([sessionId, directoryPath])
}

function cloneDraft(draft: WorkflowAuthoringDraft): WorkflowAuthoringDraft {
  return {
    ...draft,
    document: draft.document ? { ...draft.document } : null
  }
}

function measureDraft(draft: WorkflowAuthoringDraft): number {
  const document = draft.document
  return new TextEncoder().encode(
    [
      draft.selectedName,
      draft.draftName,
      draft.draftSource,
      draft.argsText,
      draft.agentIdsText,
      document?.name ?? '',
      document?.relativePath ?? '',
      document?.absolutePath ?? '',
      document?.sourceHash ?? '',
      document?.source ?? ''
    ].join('\0')
  ).byteLength
}
