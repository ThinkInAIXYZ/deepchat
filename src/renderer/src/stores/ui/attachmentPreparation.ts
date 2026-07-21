import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AttachmentPreparationSummary, SendMessageInput } from '@shared/types/agent-interface'

export interface InitialAttachmentDraftRecovery {
  sessionId: string
  input: SendMessageInput
  summary: AttachmentPreparationSummary
}

function copyInput(input: SendMessageInput): SendMessageInput {
  return {
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

/** One-shot renderer handoff for an initial turn rejected after its session was created. */
export const useAttachmentPreparationStore = defineStore('attachmentPreparation', () => {
  const initialDraftRecovery = shallowRef<InitialAttachmentDraftRecovery | null>(null)

  function stageInitialDraftRecovery(recovery: InitialAttachmentDraftRecovery): void {
    initialDraftRecovery.value = {
      sessionId: recovery.sessionId,
      input: copyInput(recovery.input),
      summary: {
        status: recovery.summary.status,
        issues: recovery.summary.issues.map((issue) => ({ ...issue })),
        suggestedActions: [...recovery.summary.suggestedActions]
      }
    }
  }

  function consumeInitialDraftRecovery(sessionId: string): InitialAttachmentDraftRecovery | null {
    const recovery = initialDraftRecovery.value
    if (!recovery || recovery.sessionId !== sessionId) {
      return null
    }

    initialDraftRecovery.value = null
    return recovery
  }

  function clear(): void {
    initialDraftRecovery.value = null
  }

  return {
    initialDraftRecovery,
    stageInitialDraftRecovery,
    consumeInitialDraftRecovery,
    clear
  }
})
