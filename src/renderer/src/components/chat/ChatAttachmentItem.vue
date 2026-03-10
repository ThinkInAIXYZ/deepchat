<template>
  <div
    class="group inline-flex max-w-full items-center gap-2 rounded-full border bg-background/70 px-2.5 py-1 text-xs text-foreground shadow-sm transition-colors hover:bg-accent"
    @click="$emit('click')"
  >
    <img
      v-if="thumbnail"
      :src="thumbnail"
      class="h-5 w-5 shrink-0 rounded-full border object-cover"
      alt="attachment"
    />
    <Icon
      v-else
      :icon="fileIcon"
      class="h-4 w-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <span class="max-w-[180px] truncate">{{ file.name }}</span>
    <button
      v-if="removable"
      type="button"
      class="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click.stop.prevent="$emit('remove')"
    >
      <Icon icon="lucide:x" class="h-3.5 w-3.5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { MessageFile } from '@shared/chat'
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import { getMimeTypeIcon } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    file: MessageFile
    removable?: boolean
  }>(),
  {
    removable: false
  }
)

defineEmits<{
  click: []
  remove: []
}>()

const mimeType = computed(() => props.file.mimeType || 'application/octet-stream')
const thumbnail = computed(() => props.file.thumbnail || '')
const fileIcon = computed(() => getMimeTypeIcon(mimeType.value))
</script>
