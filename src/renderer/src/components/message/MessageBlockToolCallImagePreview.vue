<template>
  <div data-testid="tool-call-image-preview" class="space-y-2 flex-1 min-w-0">
    <div class="flex items-center justify-between gap-2">
      <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
        <Icon icon="lucide:image" class="w-4 h-4 text-foreground" />
        {{ t('toolCall.imagePreview') }}
      </h5>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
      <button
        v-for="(preview, index) in previews"
        :key="preview.id || index"
        type="button"
        data-testid="tool-call-image-preview-item"
        class="group overflow-hidden rounded-lg border bg-background text-left transition-shadow hover:shadow-md"
        @click="openPreview(index)"
      >
        <div class="flex aspect-video items-center justify-center bg-muted/40">
          <img
            :src="resolveImageSrc(preview)"
            :alt="preview.title || t('toolCall.imagePreview')"
            class="max-h-full max-w-full object-contain"
            @error="handleImageError(preview.id || String(index))"
          />
        </div>
        <div
          v-if="preview.title"
          class="truncate border-t px-2 py-1.5 text-[11px] text-muted-foreground"
          :title="preview.title"
        >
          {{ preview.title }}
        </div>
      </button>
    </div>

    <Dialog :open="selectedPreview !== null" @update:open="handleDialogOpenChange">
      <DialogContent class="sm:max-w-[800px] p-3 bg-background border-0 shadow-none">
        <DialogHeader>
          <DialogTitle>
            <div class="flex items-center justify-between">
              {{ selectedPreview?.title || t('toolCall.imagePreview') }}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-center">
          <img
            v-if="selectedPreview"
            :src="resolveImageSrc(selectedPreview)"
            :alt="selectedPreview.title || t('toolCall.imagePreview')"
            class="rounded-md max-h-[80vh] max-w-full object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'

const { t } = useI18n()

const props = defineProps<{
  previews: ToolCallImagePreview[]
}>()

const selectedIndex = ref<number | null>(null)
const failedImages = ref(new Set<string>())

const selectedPreview = computed(() =>
  selectedIndex.value === null ? null : (props.previews[selectedIndex.value] ?? null)
)

const resolveImageSrc = (preview: ToolCallImagePreview): string => {
  const data = preview.data.trim()
  if (
    preview.mimeType === 'deepchat/image-url' ||
    data.startsWith('data:image/') ||
    data.startsWith('imgcache://') ||
    data.startsWith('http://') ||
    data.startsWith('https://')
  ) {
    return data
  }
  return `data:${preview.mimeType || 'image/png'};base64,${data}`
}

const openPreview = (index: number) => {
  const preview = props.previews[index]
  if (!preview || failedImages.value.has(preview.id || String(index))) {
    return
  }
  selectedIndex.value = index
}

const handleDialogOpenChange = (open: boolean) => {
  if (!open) {
    selectedIndex.value = null
  }
}

const handleImageError = (id: string) => {
  const next = new Set(failedImages.value)
  next.add(id)
  failedImages.value = next
}
</script>
