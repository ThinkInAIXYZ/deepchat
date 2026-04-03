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

      <div v-else-if="selectedTrace" class="flex flex-col flex-1 min-h-0 space-y-4">
        <div v-if="traceList.length > 1" class="flex flex-wrap gap-2">
          <Button
            v-for="trace in traceList"
            :key="trace.id"
            size="sm"
            :variant="trace.id === selectedTrace.id ? 'default' : 'outline'"
            @click="selectedTraceId = trace.id"
          >
            #{{ trace.requestSeq }}
          </Button>
        </div>

        <div class="space-y-3 text-sm">
          <div>
            <span class="font-semibold">{{ t('traceDialog.endpoint') }}:</span>
            <div class="mt-1 px-2 py-1 bg-muted rounded break-all">
              <span class="text-xs">{{ selectedTrace.endpoint }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.provider') }}:</span>
              <span class="ml-2 break-words">{{ selectedTrace.providerId }}</span>
            </div>
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.model') }}:</span>
              <span class="ml-2 break-words">{{ selectedTrace.modelId }}</span>
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
import type { MessageTraceRecord } from '@shared/types/agent-interface'

const { t } = useI18n()
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const uiSettingsStore = useUiSettingsStore()

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

const props = defineProps<{
  messageId: string | null
  agentId?: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const isOpen = ref(false)
const loading = ref(false)
const error = ref(false)
const copySuccess = ref(false)
const requestId = ref(0)
const traceList = ref<MessageTraceRecord[]>([])
const selectedTraceId = ref<string | null>(null)

const selectedTrace = computed(() => {
  if (!traceList.value.length) {
    return null
  }

  if (selectedTraceId.value) {
    const matched = traceList.value.find((item) => item.id === selectedTraceId.value)
    if (matched) {
      return matched
    }
  }

  return traceList.value[0] ?? null
})

const parsedHeaders = computed(() => {
  if (!selectedTrace.value) return {}
  try {
    return JSON.parse(selectedTrace.value.headersJson)
  } catch {
    return selectedTrace.value.headersJson
  }
})

const parsedBody = computed(() => {
  if (!selectedTrace.value) return {}
  try {
    return JSON.parse(selectedTrace.value.bodyJson)
  } catch {
    return selectedTrace.value.bodyJson
  }
})

const formattedJson = computed(() => {
  if (!selectedTrace.value) return ''
  const fullData = {
    endpoint: selectedTrace.value.endpoint,
    headers: parsedHeaders.value,
    body: parsedBody.value,
    truncated: selectedTrace.value.truncated,
    requestSeq: selectedTrace.value.requestSeq
  }
  return JSON.stringify(fullData, null, 2)
})

watch(
  () => props.messageId,
  async (newMessageId) => {
    if (newMessageId) {
      isOpen.value = true
      await loadTraces(newMessageId)
    } else {
      isOpen.value = false
      resetState()
    }
  }
)

watch(isOpen, (newValue) => {
  if (!newValue) {
    resetState()
    emit('close')
  }
})

const editorInitialized = ref(false)
const applyFontFamily = (fontFamily: string) => {
  const editor = getEditorView()
  if (editor) {
    editor.updateOptions({ fontFamily })
  }
}

watch(
  [isOpen, selectedTrace, formattedJson, jsonEditor],
  async ([open, trace, json, editorEl]) => {
    if (open && trace && json && editorEl) {
      await nextTick()
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

onMounted(async () => {
  if (isOpen.value && selectedTrace.value && formattedJson.value && jsonEditor.value) {
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

const loadTraces = async (messageId: string) => {
  requestId.value += 1
  const currentRequestId = requestId.value

  loading.value = true
  error.value = false
  traceList.value = []
  selectedTraceId.value = null

  try {
    const result = await agentSessionPresenter.listMessageTraces(messageId)
    if (currentRequestId !== requestId.value) {
      return
    }

    if (!Array.isArray(result) || result.length === 0) {
      error.value = true
      return
    }

    traceList.value = result
    selectedTraceId.value = result[0].id
  } catch (err) {
    if (currentRequestId === requestId.value) {
      console.error('Failed to load message traces:', err)
      error.value = true
    }
  } finally {
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
  copySuccess.value = false
  traceList.value = []
  selectedTraceId.value = null
  cleanupEditor()
  editorInitialized.value = false
}

const close = () => {
  isOpen.value = false
  resetState()
  emit('close')
}
</script>
