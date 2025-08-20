<template>
  <div class="svg-artifact artifact-dialog-content">
    <!-- Loading state -->
    <div v-if="isLoading" class="loading-message">
      <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
      <p class="text-sm text-muted-foreground mt-2">{{ t('artifacts.sanitizingSvg') }}</p>
    </div>

    <!-- Error state -->
    <div v-else-if="hasError" class="error-message">
      <Icon icon="lucide:alert-triangle" class="w-6 h-6 text-yellow-500" />
      <p class="text-sm text-muted-foreground mt-2">{{ t('artifacts.svgSanitizationFailed') }}</p>
    </div>

    <!-- Success state - render sanitized content -->
    <div class="w-full" v-else-if="sanitizedContent" v-html="sanitizedContent"></div>

    <!-- Empty state -->
    <div v-else class="empty-message">
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

<style>
.svg-artifact {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  min-height: 200px;
}

.svg-artifact svg {
  max-width: 100%;
  height: auto;
}

.loading-message,
.error-message,
.empty-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
}

.loading-message .animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
