<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="h-7 rounded-md px-2 gap-1 text-xs font-medium"
        :class="['flex items-center']"
      >
        <ModelIcon :model-id="model.providerId" :is-dark="themeStore.isDark" class="w-4 h-4" />
        <span class="truncate max-w-[160px]">{{ model.name }}</span>
        <Icon icon="lucide:chevron-right" class="w-4 h-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="p-0 w-80">
      <ModelSelect :type="[ModelType.Chat, ModelType.ImageGeneration]" @update:model="handleModelUpdate" />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import ModelSelect from '@/components/ModelSelect.vue'
import { useChatStore } from '@/stores/chat'
import { useThemeStore } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { usePresenter } from '@/composables/usePresenter'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META as MODEL_META } from '@shared/presenter'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const configPresenter = usePresenter('configPresenter')
const open = ref(false)

const model = computed(() => {
  const modelId = chatStore.chatConfig.modelId
  const providerId = chatStore.chatConfig.providerId
  const matched = settingsStore.findModelByIdOrName(modelId)
  if (matched && matched.providerId === providerId) {
    return { name: matched.model.name, id: matched.model.id, providerId, tags: [] as string[] }
  }
  return { name: modelId, id: modelId, providerId, tags: [] as string[] }
})

const handleModelUpdate = (m: MODEL_META, providerId: string) => {
  chatStore.updateChatConfig({ modelId: m.id, providerId })
  configPresenter.setSetting('preferredModel', { modelId: m.id, providerId })
  open.value = false
}
</script>

