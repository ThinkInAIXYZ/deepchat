<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        size="sm"
      >
        <ModelIcon
          v-if="activeModel.providerId === 'acp'"
          :model-id="activeModel.id"
          :is-dark="isDark"
          custom-class="w-4 h-4"
        />
        <ModelIcon
          v-else
          :model-id="activeModel.providerId"
          :is-dark="isDark"
          custom-class="w-4 h-4"
        />
        <span
          class="text-xs font-semibold truncate max-w-[140px] text-foreground"
          :title="modelDisplayName"
        >
          {{ modelDisplayName }}
        </span>
        <Badge
          v-for="tag in activeModel.tags"
          :key="tag"
          variant="outline"
          class="py-0 px-1 rounded-lg text-[10px]"
        >
          {{ t(`model.tags.${tag}`) }}
        </Badge>
        <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :portal="false"
      class="w-[720px] border-none bg-transparent p-0 shadow-none"
    >
      <div class="rounded-lg border border-border bg-card shadow-sm">
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border">
          <div class="p-2">
            <ModelChooser
              embedded
              :type="[ModelType.Chat, ModelType.ImageGeneration]"
              @update:model="handleModelUpdate"
            />
          </div>
          <div class="p-2">
            <ScrollArea class="h-72">
              <ChatConfig
                v-model:system-prompt-id="systemPromptIdModel"
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
            </ScrollArea>
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import ModelIcon from '../icons/ModelIcon.vue'
import ModelChooser from '../ModelChooser.vue'
import ChatConfig from '../ChatConfig.vue'
import { ModelType } from '@shared/model'

interface ModelInfo {
  id: string
  providerId: string
  tags?: string[]
}

const props = defineProps<{
  activeModel: ModelInfo
  modelDisplayName: string
  isDark: boolean
  systemPromptId?: string
  temperature: number
  contextLength: number
  maxTokens: number
  artifacts: number
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  contextLengthLimit?: number
  maxTokensLimit?: number
  modelId?: string
  providerId?: string
  modelType?: ModelType
}>()

const emit = defineEmits<{
  'model-update': [model: any]
  'update:systemPromptId': [value: string | undefined]
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

const { t } = useI18n()
const open = ref(false)

const handleModelUpdate = (model: any) => {
  emit('model-update', model)
  open.value = false
}

const systemPromptIdModel = computed({
  get: () => props.systemPromptId,
  set: (value) => emit('update:systemPromptId', value)
})
</script>
