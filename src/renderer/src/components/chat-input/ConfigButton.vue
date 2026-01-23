<template>
  <ScrollablePopover align="end" content-class="w-80" :enable-scrollable="true">
    <template #trigger>
      <Button
        class="h-7 w-7 rounded-md border border-border/60 hover:border-border dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-white/25 dark:hover:bg-white/15 dark:hover:text-white"
        size="icon"
        variant="outline"
      >
        <Icon icon="lucide:settings-2" class="w-4 h-4" />
      </Button>
    </template>
    <ChatConfig
      v-model:system-prompt-id="systemPromptModel"
      :temperature="temperature"
      :context-length="contextLength"
      :max-tokens="maxTokens"
      :artifacts="artifacts"
      :thinking-budget="thinkingBudget"
      :enable-search="enableSearch"
      :forced-search="forcedSearch"
      :search-strategy="searchStrategy"
      :reasoning-effort="reasoningEffort"
      :verbosity="verbosity"
      :context-length-limit="contextLengthLimit"
      :max-tokens-limit="maxTokensLimit"
      :model-id="modelId"
      :provider-id="providerId"
      :model-type="modelType"
      @update:temperature="$emit('update:temperature', $event)"
      @update:context-length="$emit('update:contextLength', $event)"
      @update:max-tokens="$emit('update:maxTokens', $event)"
      @update:artifacts="$emit('update:artifacts', $event)"
      @update:thinking-budget="$emit('update:thinkingBudget', $event)"
      @update:enable-search="$emit('update:enableSearch', $event)"
      @update:forced-search="$emit('update:forcedSearch', $event)"
      @update:search-strategy="$emit('update:searchStrategy', $event)"
      @update:reasoning-effort="$emit('update:reasoningEffort', $event)"
      @update:verbosity="$emit('update:verbosity', $event)"
    />
  </ScrollablePopover>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import ScrollablePopover from '../ScrollablePopover.vue'
import ChatConfig from '../ChatConfig.vue'
import type { ModelType } from '@shared/model'

const props = defineProps<{
  systemPromptId?: string
  temperature: number
  contextLength: number
  maxTokens: number
  artifacts: number
  thinkingBudget: number | undefined
  enableSearch: boolean
  forcedSearch: boolean
  searchStrategy: 'turbo' | 'max' | undefined
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | undefined
  verbosity: 'low' | 'medium' | 'high' | undefined
  contextLengthLimit: number
  maxTokensLimit: number
  modelId: string
  providerId: string
  modelType: ModelType
}>()

const emit = defineEmits<{
  'update:systemPromptId': [value: string]
  'update:temperature': [value: number]
  'update:contextLength': [value: number]
  'update:maxTokens': [value: number]
  'update:artifacts': [value: number]
  'update:thinkingBudget': [value: number | undefined]
  'update:enableSearch': [value: boolean | undefined]
  'update:forcedSearch': [value: boolean | undefined]
  'update:searchStrategy': [value: 'turbo' | 'max' | undefined]
  'update:reasoningEffort': [value: 'minimal' | 'low' | 'medium' | 'high']
  'update:verbosity': [value: 'low' | 'medium' | 'high']
}>()

// Create computed properties for v-model bindings
const systemPromptModel = computed({
  get: () => props.systemPromptId,
  set: (value: string) => emit('update:systemPromptId', value)
})
</script>
