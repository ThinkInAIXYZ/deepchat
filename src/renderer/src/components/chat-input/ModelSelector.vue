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
    <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
      <ModelChooser
        :type="[ModelType.Chat, ModelType.ImageGeneration]"
        @update:model="handleModelUpdate"
      />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelIcon from '../icons/ModelIcon.vue'
import ModelChooser from '../ModelChooser.vue'
import { ModelType } from '@shared/model'

interface ModelInfo {
  id: string
  providerId: string
  tags?: string[]
}

defineProps<{
  activeModel: ModelInfo
  modelDisplayName: string
  isDark: boolean
}>()

const emit = defineEmits<{
  'model-update': [model: any]
}>()

const { t } = useI18n()
const open = ref(false)

const handleModelUpdate = (model: any) => {
  emit('model-update', model)
  open.value = false
}
</script>
