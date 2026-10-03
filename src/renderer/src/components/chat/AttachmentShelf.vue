<template>
  <div
    v-if="files.length"
    data-testid="attachment-shelf"
    class="border-t border-border/50 px-3 py-2"
  >
    <div class="overflow-y-auto overscroll-contain" :class="expanded ? 'max-h-48' : 'max-h-16'">
      <div ref="itemsElement" class="flex flex-wrap gap-1.5">
        <ChatAttachmentItem
          v-for="(file, index) in files"
          :key="file.path || `${file.name}-${index}`"
          :file="file"
          :editable="editable"
          :removable="editable"
          @click="emit('file-click', file.path || file.name)"
          @remove="emit('remove', index)"
          @update:representation="emit('update:representation', index, $event)"
          @switch-vision-model="emit('switch-vision-model')"
        />
      </div>
    </div>
    <button
      v-if="isOverflowing"
      type="button"
      data-testid="attachment-shelf-toggle"
      class="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('common.collapse') : t('common.expand') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import type { MessageFile } from '@shared/types/agent-interface'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'
import ChatAttachmentItem from './ChatAttachmentItem.vue'

withDefaults(
  defineProps<{
    files: MessageFile[]
    editable?: boolean
  }>(),
  { editable: false }
)

const emit = defineEmits<{
  'file-click': [filePath: string]
  remove: [index: number]
  'update:representation': [index: number, preference: AttachmentRepresentationPreference]
  'switch-vision-model': []
}>()

const { t } = useI18n()
const expanded = ref(false)
const itemsElement = ref<HTMLElement | null>(null)
const isOverflowing = ref(false)
useResizeObserver(itemsElement, ([entry]) => {
  isOverflowing.value = entry.contentRect.height > 64
})
</script>
