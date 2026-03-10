import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CreateSessionInput,
  PermissionMode,
  SessionGenerationSettings
} from '@shared/types/agent-interface'

// --- Store ---

export const useDraftStore = defineStore('draft', () => {
  // --- State ---
  const providerId = ref<string | undefined>(undefined)
  const modelId = ref<string | undefined>(undefined)
  const projectDir = ref<string | undefined>(undefined)
  const agentId = ref<string>('deepchat')
  const systemPrompt = ref<string | undefined>(undefined)
  const temperature = ref<number | undefined>(undefined)
  const contextLength = ref<number | undefined>(undefined)
  const maxTokens = ref<number | undefined>(undefined)
  const thinkingBudget = ref<number | undefined>(undefined)
  const reasoningEffort = ref<SessionGenerationSettings['reasoningEffort'] | undefined>(undefined)
  const verbosity = ref<SessionGenerationSettings['verbosity'] | undefined>(undefined)
  const permissionMode = ref<PermissionMode>('full_access')

  // --- Actions ---

  function toGenerationSettings(): Partial<SessionGenerationSettings> | undefined {
    const settings: Partial<SessionGenerationSettings> = {}

    if (systemPrompt.value !== undefined) settings.systemPrompt = systemPrompt.value
    if (temperature.value !== undefined) settings.temperature = temperature.value
    if (contextLength.value !== undefined) settings.contextLength = contextLength.value
    if (maxTokens.value !== undefined) settings.maxTokens = maxTokens.value
    if (thinkingBudget.value !== undefined) settings.thinkingBudget = thinkingBudget.value
    if (reasoningEffort.value !== undefined) settings.reasoningEffort = reasoningEffort.value
    if (verbosity.value !== undefined) settings.verbosity = verbosity.value

    return Object.keys(settings).length > 0 ? settings : undefined
  }

  function toCreateInput(message: string): CreateSessionInput {
    return {
      agentId: agentId.value,
      message,
      projectDir: projectDir.value,
      providerId: providerId.value,
      modelId: modelId.value,
      permissionMode: permissionMode.value,
      generationSettings: toGenerationSettings()
    }
  }

  function updateGenerationSettings(settings: Partial<SessionGenerationSettings>): void {
    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      systemPrompt.value = settings.systemPrompt
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'temperature')) {
      temperature.value = settings.temperature
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'contextLength')) {
      contextLength.value = settings.contextLength
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'maxTokens')) {
      maxTokens.value = settings.maxTokens
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'thinkingBudget')) {
      thinkingBudget.value = settings.thinkingBudget
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'reasoningEffort')) {
      reasoningEffort.value = settings.reasoningEffort
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'verbosity')) {
      verbosity.value = settings.verbosity
    }
  }

  function resetGenerationSettings(): void {
    systemPrompt.value = undefined
    temperature.value = undefined
    contextLength.value = undefined
    maxTokens.value = undefined
    thinkingBudget.value = undefined
    reasoningEffort.value = undefined
    verbosity.value = undefined
  }

  function reset(): void {
    providerId.value = undefined
    modelId.value = undefined
    projectDir.value = undefined
    agentId.value = 'deepchat'
    permissionMode.value = 'full_access'
    resetGenerationSettings()
  }

  return {
    providerId,
    modelId,
    projectDir,
    agentId,
    systemPrompt,
    temperature,
    contextLength,
    maxTokens,
    thinkingBudget,
    reasoningEffort,
    verbosity,
    permissionMode,
    toGenerationSettings,
    toCreateInput,
    updateGenerationSettings,
    resetGenerationSettings,
    reset
  }
})
