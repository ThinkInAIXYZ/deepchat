<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuItem @select="handleCopy">
        <Icon icon="lucide:copy" class="h-4 w-4" />
        {{ t('thread.toolbar.copyImage') }}
      </ContextMenuItem>
      <ContextMenuItem @select="handleSave">
        <Icon icon="lucide:download" class="h-4 w-4" />
        {{ t('image.saveAs') }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
import { useImageActions } from '@/composables/useImageActions'

const props = defineProps<{
  source: string
  mimeType?: string
  suggestedName?: string
}>()

const { t } = useI18n()
const { copyImage, saveImage } = useImageActions()

const getImageActionSource = () => ({
  source: props.source,
  mimeType: props.mimeType,
  suggestedName: props.suggestedName
})

const handleCopy = () => {
  void copyImage(getImageActionSource())
}

const handleSave = () => {
  void saveImage(getImageActionSource())
}
</script>
