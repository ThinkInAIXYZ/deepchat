<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-4xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('traceDialog.title') }}</DialogTitle>
      </DialogHeader>

      <div v-if="loading" class="flex items-center justify-center py-8">
        <Spinner class="size-6" />
        <span class="ml-2 text-muted-foreground">{{ t('traceDialog.loading') }}</span>
      </div>

      <div v-else-if="error" class="flex flex-col items-center justify-center py-8">
        <Icon icon="lucide:alert-circle" class="w-12 h-12 text-destructive mb-2" />
        <h3 class="text-lg font-semibold mb-1">{{ t('traceDialog.error') }}</h3>
        <p class="text-sm text-muted-foreground">{{ t('traceDialog.errorDesc') }}</p>
      </div>

      <div v-else-if="notImplemented" class="flex flex-col items-center justify-center py-8">
        <Icon icon="lucide:info" class="w-12 h-12 text-muted-foreground mb-2" />
        <h3 class="text-lg font-semibold mb-1">{{ t('traceDialog.notImplemented') }}</h3>
        <p class="text-sm text-muted-foreground">{{ t('traceDialog.notImplementedDesc') }}</p>
      </div>

      <div v-else-if="previewData" class="flex flex-col flex-1 min-h-0 space-y-4">
        <div
          v-if="previewData.mayNotMatch"
          class="px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md"
        >
          <div class="flex items-start gap-2">
            <Icon
              icon="lucide:alert-triangle"
              class="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5"
            />
            <p class="text-xs text-yellow-700 dark:text-yellow-300">
              {{ t('traceDialog.mayNotMatch') }}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span class="font-semibold">{{ t('traceDialog.provider') }}:</span>
            <span class="ml-2">{{ previewData.providerId }}</span>
          </div>
          <div>
            <span class="font-semibold">{{ t('traceDialog.model') }}:</span>
            <span class="ml-2">{{ previewData.modelId }}</span>
          </div>
          <div>
            <span class="font-semibold">{{ t('traceDialog.endpoint') }}:</span>
            <span class="ml-2 text-xs truncate">{{ previewData.endpoint }}</span>
          </div>
        </div>

        <div class="flex-1 min-h-0 flex flex-col border rounded-lg overflow-hidden">
          <div class="flex items-center justify-between px-4 py-2 bg-muted border-b">
            <span class="text-sm font-semibold">{{ t('traceDialog.body') }}</span>
            <Button variant="ghost" size="sm" @click="copyJson">
              <Icon icon="lucide:copy" class="w-4 h-4 mr-1" />
              {{ copySuccess ? t('traceDialog.copySuccess') : t('traceDialog.copyJson') }}
            </Button>
          </div>
          <div class="flex-1 overflow-auto p-4 bg-muted/30">
            <pre class="text-xs"><code>{{ formattedJson }}</code></pre>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ t('traceDialog.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')

type PreviewData = {
  providerId: string
  modelId: string
  endpoint: string
  headers: Record<string, string>
  body: unknown
  mayNotMatch?: boolean
  notImplemented?: boolean
}

const props = defineProps<{
  messageId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const isOpen = ref(false)
const loading = ref(false)
const error = ref(false)
const notImplemented = ref(false)
const previewData = ref<PreviewData | null>(null)
const copySuccess = ref(false)

const formattedJson = computed(() => {
  if (!previewData.value) return ''
  const fullData = {
    endpoint: previewData.value.endpoint,
    headers: previewData.value.headers,
    body: previewData.value.body
  }
  return JSON.stringify(fullData, null, 2)
})

watch(
  () => props.messageId,
  async (newMessageId) => {
    if (newMessageId) {
      isOpen.value = true
      await loadPreview(newMessageId)
    }
  }
)

const loadPreview = async (messageId: string) => {
  loading.value = true
  error.value = false
  notImplemented.value = false
  previewData.value = null

  try {
    const result = await threadPresenter.getMessageRequestPreview(messageId)
    // Check if result is null or undefined
    if (!result) {
      console.error('getMessageRequestPreview returned null or undefined')
      error.value = true
      return
    }
    // Check if provider has not implemented preview
    if ((result as any).notImplemented === true) {
      notImplemented.value = true
    } else {
      previewData.value = result as PreviewData
    }
  } catch (err) {
    console.error('Failed to load request preview:', err)
    error.value = true
  } finally {
    loading.value = false
  }
}

const copyJson = async () => {
  if (!formattedJson.value) return
  try {
    await window.api.copyText(formattedJson.value)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy JSON:', err)
  }
}

const close = () => {
  isOpen.value = false
  emit('close')
}
</script>
