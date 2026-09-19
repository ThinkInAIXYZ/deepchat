import { defineStore } from 'pinia'
import type { AttachmentPreparationSummary, SendMessageInput } from '@shared/types/agent-interface'

export interface InitialAttachmentDraftRecovery {
  sessionId: string
  input: SendMessageInput
  summary: AttachmentPreparationSummary
}

function copyInput(input: SendMessageInput): SendMessageInput {
  return {
    ...input,
    text: input.text,
    ...(input.files
      ? {
          files: input.files.map((file) => ({
            ...file,
            ...(file.metadata ? { metadata: { ...file.metadata } } : {})
          }))
        }
      : {}),
    ...(input.activeSkills ? { activeSkills: [...input.activeSkills] } : {}),
    ...(input.inlineItems ? { inlineItems: input.inlineItems.map((item) => ({ ...item })) } : {})
  }
}

/** Session-scoped renderer handoff for initial turns rejected after their sessions were created. */
export const useAttachmentPreparationStore = defineStore('attachmentPreparation', () => {
  const initialDraftRecoveries = new Map<string, InitialAttachmentDraftRecovery>()

  function stageInitialDraftRecovery(recovery: InitialAttachmentDraftRecovery): void {
    initialDraftRecoveries.set(recovery.sessionId, {
      sessionId: recovery.sessionId,
      input: copyInput(recovery.input),
      summary: {
        status: recovery.summary.status,
        issues: recovery.summary.issues.map((issue) => ({ ...issue })),
        suggestedActions: [...recovery.summary.suggestedActions]
      }
    })
  }

  function consumeInitialDraftRecovery(sessionId: string): InitialAttachmentDraftRecovery | null {
    const recovery = initialDraftRecoveries.get(sessionId)
    if (!recovery) return null
    initialDraftRecoveries.delete(sessionId)
    return recovery
  }

  function clear(sessionId?: string): void {
    if (sessionId) {
      initialDraftRecoveries.delete(sessionId)
      return
    }
    initialDraftRecoveries.clear()
  }

  return {
    stageInitialDraftRecovery,
    consumeInitialDraftRecovery,
    clear
  }
})
