<template>
  <div
    class="artifact-dialog-content flex h-full min-h-0 w-full items-stretch justify-center overflow-auto p-4"
    data-testid="svg-artifact-root"
  >
    <!-- Loading state -->
    <div
      v-if="isLoading"
      class="flex min-h-full w-full flex-1 flex-col items-center justify-center p-8 text-center"
    >
      <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
      <p class="text-sm text-muted-foreground mt-2">{{ t('artifacts.sanitizingSvg') }}</p>
    </div>

    <!-- Error state -->
    <div
      v-else-if="hasError"
      class="flex min-h-full w-full flex-1 flex-col items-center justify-center p-8 text-center"
    >
      <Icon icon="lucide:alert-triangle" class="w-6 h-6 text-yellow-500" />
      <p class="text-sm text-muted-foreground mt-2">{{ t('artifacts.svgSanitizationFailed') }}</p>
    </div>

    <!-- Success state - render sanitized content -->
    <div
      v-else-if="sanitizedContent"
      class="flex min-h-full w-full flex-1 items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:w-auto"
      data-testid="svg-artifact-content"
      v-html="sanitizedContent"
    ></div>

    <!-- Empty state -->
    <div
      v-else
      class="flex min-h-full w-full flex-1 flex-col items-center justify-center p-8 text-center"
    >
      <Icon icon="lucide:image" class="w-6 h-6 text-gray-400" />
      <p class="text-sm text-muted-foreground mt-2">{{ t('artifacts.noSvgContent') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const devicePresenter = usePresenter('devicePresenter')

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
}>()

const sanitizedContent = ref<string>('')
const isLoading = ref(false)
const hasError = ref(false)

const sanitizeSvgContent = async (content: string) => {
  if (!content) {
    sanitizedContent.value = ''
    return
  }

  isLoading.value = true
  hasError.value = false

  try {
    // Call main process to sanitize SVG content
    const result = await devicePresenter.sanitizeSvgContent(content)
    sanitizedContent.value = result || ''

    if (!result) {
      hasError.value = true
      console.warn('SVG content was rejected by sanitizer')
    }
  } catch (error) {
    console.error('SVG sanitization failed:', error)
    sanitizedContent.value = ''
    hasError.value = true
  } finally {
    isLoading.value = false
  }
}

// Watch for content changes
watch(
  () => props.block.content,
  (newContent) => {
    sanitizeSvgContent(newContent)
  },
  { immediate: true }
)

onMounted(() => {
  if (props.block.content) {
    sanitizeSvgContent(props.block.content)
  }
})
</script>
