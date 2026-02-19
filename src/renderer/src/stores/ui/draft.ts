import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateSessionInput } from '@shared/types/agent-interface'

// --- Store ---

export const useDraftStore = defineStore('draft', () => {
  // --- State ---
  const providerId = ref<string | undefined>(undefined)
  const modelId = ref<string | undefined>(undefined)
  const projectDir = ref<string | undefined>(undefined)
  const agentId = ref<string>('deepchat')
  const reasoningEffort = ref<string | undefined>(undefined)

  // --- Actions ---

  function toCreateInput(message: string): CreateSessionInput {
    return {
      agentId: agentId.value,
      message,
      projectDir: projectDir.value,
      providerId: providerId.value,
      modelId: modelId.value
    }
  }

  function reset(): void {
    providerId.value = undefined
    modelId.value = undefined
    projectDir.value = undefined
    agentId.value = 'deepchat'
    reasoningEffort.value = undefined
  }

  return {
    providerId,
    modelId,
    projectDir,
    agentId,
    reasoningEffort,
    toCreateInput,
    reset
  }
})
