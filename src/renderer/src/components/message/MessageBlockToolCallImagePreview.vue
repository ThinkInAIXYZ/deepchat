<template>
  <div data-testid="tool-call-image-preview" class="space-y-2 flex-1 min-w-0">
    <div class="flex items-center justify-between gap-2">
      <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
        <Icon icon="lucide:image" class="w-4 h-4 text-foreground" />
        {{ t('toolCall.imagePreview') }}
      </h5>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
      <ImageActionContextMenu
        v-for="(preview, index) in previews"
        :key="preview.id || index"
        :source="resolveImageSrc(preview)"
        :mime-type="preview.mimeType === 'deepchat/image-url' ? undefined : preview.mimeType"
      >
        <button
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
      </ImageActionContextMenu>
    </div>

    <Dialog :open="selectedPreview !== null" @update:open="handleDialogOpenChange">
      <DialogContent
        class="sm:max-w-[800px] p-3 bg-background border-0 shadow-none focus:outline-none"
        @open-auto-focus="handleImageDialogOpenAutoFocus"
      >
        <DialogHeader>
          <DialogTitle>
            <div class="flex items-center justify-between gap-2 pr-8">
              <span>{{ selectedPreview?.title || t('toolCall.imagePreview') }}</span>
              <Tooltip v-if="selectedPreview">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    @click="handleSaveSelectedPreview"
                  >
                    <Icon icon="lucide:download" class="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t('image.save') }}</TooltipContent>
              </Tooltip>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-center">
          <ImageActionContextMenu
            v-if="selectedPreview"
            :source="selectedPreviewSrc"
            :mime-type="selectedPreviewMimeType"
          >
            <img
              :src="selectedPreviewSrc"
              :alt="selectedPreview.title || t('toolCall.imagePreview')"
              class="rounded-md max-h-[80vh] max-w-full object-contain"
            />
          </ImageActionContextMenu>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import ImageActionContextMenu from './ImageActionContextMenu.vue'
import { useImageActions } from '@/composables/useImageActions'

const { t } = useI18n()

const props = defineProps<{
  previews: ToolCallImagePreview[]
}>()

const { saveImage } = useImageActions()
const selectedIndex = ref<number | null>(null)
const failedImages = ref(new Set<string>())

const selectedPreview = computed(() =>
  selectedIndex.value === null ? null : (props.previews[selectedIndex.value] ?? null)
)

const selectedPreviewSrc = computed(() =>
  selectedPreview.value ? resolveImageSrc(selectedPreview.value) : ''
)

const selectedPreviewMimeType = computed(() => {
  const mimeType = selectedPreview.value?.mimeType
  return mimeType === 'deepchat/image-url' ? undefined : mimeType
})

const resolveImageSrc = (preview: ToolCallImagePreview): string => {
  const data = preview.data?.trim() ?? ''
  const hasSafeScheme =
    data.startsWith('data:image/') ||
    data.startsWith('imgcache://') ||
    data.startsWith('http://') ||
    data.startsWith('https://')

  if (hasSafeScheme) {
    return data
  }

  if (preview.mimeType === 'deepchat/image-url') {
    return ''
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

const handleImageDialogOpenAutoFocus = (event: Event) => {
  event.preventDefault()
  const target = event.target as HTMLElement | null
  target?.focus()
}

const handleSaveSelectedPreview = () => {
  if (!selectedPreview.value || !selectedPreviewSrc.value) {
    return
  }

  void saveImage({
    source: selectedPreviewSrc.value,
    mimeType: selectedPreviewMimeType.value
  })
}
</script>
