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

        <div class="space-y-3 text-sm">
          <div>
            <span class="font-semibold">{{ t('traceDialog.endpoint') }}:</span>
            <div class="mt-1 px-2 py-1 bg-muted rounded break-all">
              <span class="text-xs">{{ previewData.endpoint }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.provider') }}:</span>
              <span class="ml-2 break-words">{{ previewData.providerId }}</span>
            </div>
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.model') }}:</span>
              <span class="ml-2 break-words">{{ previewData.modelId }}</span>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 flex flex-col border rounded-lg overflow-hidden min-h-[300px]">
          <div class="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-muted border-b">
            <span class="text-sm font-semibold">{{ t('traceDialog.body') }}</span>
            <Button variant="ghost" size="sm" @click="copyJson">
              <Icon icon="lucide:copy" class="w-4 h-4 mr-1" />
              {{ copySuccess ? t('traceDialog.copySuccess') : t('traceDialog.copyJson') }}
            </Button>
          </div>
          <div class="flex-1 min-h-0 bg-muted/30 relative">
            <div
              ref="jsonEditor"
              class="absolute inset-0"
              :class="{ 'opacity-0': !editorInitialized }"
            ></div>
            <!-- Fallback: show raw JSON while Monaco Editor is initializing -->
            <div
              v-if="formattedJson && !editorInitialized"
              class="absolute inset-0 p-4 overflow-auto"
            >
              <pre
                class="text-xs whitespace-pre-wrap break-words"
              ><code>{{ formattedJson }}</code></pre>
            </div>
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
import { ref, computed, watch, onBeforeUnmount, onMounted, nextTick } from 'vue'
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
import { useMonaco } from 'stream-monaco'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')
const uiSettingsStore = useUiSettingsStore()

// Monaco Editor setup
const jsonEditor = ref<HTMLElement | null>(null)
const { createEditor, updateCode, cleanupEditor, getEditorView } = useMonaco({
  readOnly: true,
  wordWrap: 'off',
  wrappingIndent: 'same',
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  minimap: { enabled: false },
  scrollBeyondLastLine: true,
  fontSize: 12,
  lineNumbers: 'on',
  folding: true,
  automaticLayout: true,
  scrollbar: {
    horizontal: 'visible',
    vertical: 'visible',
    horizontalScrollbarSize: 10,
    verticalScrollbarSize: 10
  }
})

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
const requestId = ref(0)

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
    } else {
      // Reset state when messageId becomes null
      isOpen.value = false
      resetState()
    }
  }
)

// Watch isOpen to handle external close (click outside)
watch(isOpen, (newValue) => {
  if (!newValue) {
    // Dialog was closed (by clicking outside or ESC)
    resetState()
    emit('close')
  }
})

// Track if editor is initialized
const editorInitialized = ref(false)
const applyFontFamily = (fontFamily: string) => {
  const editor = getEditorView()
  if (editor) {
    editor.updateOptions({ fontFamily })
  }
}

// Initialize Monaco Editor when dialog opens and data is ready
watch(
  [isOpen, () => previewData.value, formattedJson, jsonEditor],
  async ([open, data, json, editorEl]) => {
    if (open && data && json && editorEl) {
      await nextTick()
      // Wait for DOM to be ready
      await nextTick()
      const hasEditor = editorEl.querySelector('.monaco-editor')
      if (!hasEditor && !editorInitialized.value) {
        try {
          createEditor(editorEl, json, 'json')
          editorInitialized.value = true
          applyFontFamily(uiSettingsStore.formattedCodeFontFamily)
        } catch (err) {
          console.error('Failed to create Monaco Editor:', err)
        }
      } else if (hasEditor && editorInitialized.value) {
        updateCode(json, 'json')
      }
    }
  },
  { flush: 'post' }
)

// Also try to initialize on mount if data is already available
onMounted(async () => {
  if (isOpen.value && previewData.value && formattedJson.value && jsonEditor.value) {
    await nextTick()
    await nextTick()
    if (!jsonEditor.value.querySelector('.monaco-editor') && !editorInitialized.value) {
      try {
        createEditor(jsonEditor.value, formattedJson.value, 'json')
        editorInitialized.value = true
        applyFontFamily(uiSettingsStore.formattedCodeFontFamily)
      } catch (err) {
        console.error('Failed to create Monaco Editor on mount:', err)
      }
    }
  }
})

watch(
  () => uiSettingsStore.formattedCodeFontFamily,
  (font) => {
    applyFontFamily(font)
  }
)

onBeforeUnmount(() => {
  cleanupEditor()
  editorInitialized.value = false
})

const loadPreview = async (messageId: string) => {
  // Increment request ID and capture it for this request
  requestId.value += 1
  const currentRequestId = requestId.value

  loading.value = true
  error.value = false
  notImplemented.value = false
  previewData.value = null

  try {
    const result = await threadPresenter.getMessageRequestPreview(messageId)
    // Only update state if this is still the latest request
    if (currentRequestId !== requestId.value) {
      return
    }
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
    // Only update state if this is still the latest request
    if (currentRequestId === requestId.value) {
      console.error('Failed to load request preview:', err)
      error.value = true
    }
  } finally {
    // Only update state if this is still the latest request
    if (currentRequestId === requestId.value) {
      loading.value = false
    }
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

const resetState = () => {
  loading.value = false
  error.value = false
  notImplemented.value = false
  previewData.value = null
  copySuccess.value = false
  // Clean up Monaco Editor when resetting state
  cleanupEditor()
  editorInitialized.value = false
}

const close = () => {
  isOpen.value = false
  resetState()
  emit('close')
}
</script>
