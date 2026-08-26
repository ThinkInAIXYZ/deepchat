<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogTrigger as-child>
      <DcButton
        data-testid="provider-custom-headers-trigger"
        type="button"
        variant="outline"
        class="h-auto w-full justify-between gap-3 px-3 py-2.5 text-left"
        :disabled="disabled"
      >
        <span class="min-w-0">
          <span class="block text-sm font-medium">
            {{ t('settings.provider.customHeaders.title') }}
          </span>
          <span class="block text-xs font-normal text-muted-foreground">
            {{ statusLabel }}
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5 text-xs">
          <Icon icon="lucide:pencil" class="size-3.5" />
          {{ t('common.edit') }}
        </span>
      </DcButton>
    </DialogTrigger>

    <DialogContent
      class="flex max-h-[85vh] flex-col sm:max-w-2xl"
      :hide-close="saving"
      :inert="saving || undefined"
      @open-auto-focus="handleOpenAutoFocus"
    >
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.customHeaders.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.customHeaders.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 overflow-y-auto">
        <div class="overflow-hidden rounded-md border bg-background">
          <div class="flex items-center justify-end border-b bg-muted/40 px-2 py-1">
            <DcButton
              data-testid="provider-custom-headers-format"
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              :disabled="saving || !draft.trim()"
              @click="formatDraft"
            >
              <Icon icon="lucide:align-left" class="size-3.5" />
              {{ t('common.format') }}
            </DcButton>
          </div>
          <div
            :id="editorId"
            ref="editorHost"
            data-testid="provider-custom-headers-editor"
            class="h-72 min-h-72 w-full"
            :aria-invalid="Boolean(validationError || submitError) || undefined"
            :aria-describedby="validationError || submitError ? errorId : undefined"
          ></div>
        </div>
        <DcInlineError
          v-if="validationError || submitError"
          :id="errorId"
          :error="validationError || submitError"
        />
      </div>

      <DialogFooter>
        <DcButton
          data-testid="provider-custom-headers-cancel"
          type="button"
          variant="outline"
          :disabled="saving"
          @click="open = false"
        >
          {{ t('common.cancel') }}
        </DcButton>
        <DcButton
          data-testid="provider-custom-headers-save"
          type="button"
          :disabled="saveDisabled"
          @click="handleSave"
        >
          <Spinner v-if="saving" class="size-4" data-icon="inline-start" />
          {{ t('common.save') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useMonaco } from 'stream-monaco'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { Spinner } from '@shadcn/components/ui/spinner'
import { DcButton } from '@dc-ui/components/button'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import {
  canonicalizeProviderCustomHeaders,
  validateProviderCustomHeaders,
  type ProviderCustomHeaders
} from '@shared/providerCustomHeaders'

type SaveResult = { isOk: boolean; errorMsg: string | null }

const props = defineProps<{
  providerId: string
  modelValue?: ProviderCustomHeaders
  disabled?: boolean
  save: (headers?: ProviderCustomHeaders) => Promise<SaveResult>
}>()

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()
const open = ref(false)
const draft = ref('{}')
const saving = ref(false)
const submitError = ref('')
const editorHost = ref<HTMLElement | null>(null)
const editorId = computed(() => `${props.providerId}-custom-headers-editor`)
const errorId = computed(() => `${editorId.value}-error`)
let editorCreated = false
let editorTask: Promise<void> | null = null
let editorGeneration = 0

const { createEditor, updateCode, getEditorView, cleanupEditor } = useMonaco({
  readOnly: false,
  automaticLayout: true,
  wordWrap: 'on',
  wrappingIndent: 'same',
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: 'on',
  ariaLabel: t('settings.provider.customHeaders.title')
})

const configuredCount = computed(() => Object.keys(props.modelValue ?? {}).length)
const statusLabel = computed(() =>
  configuredCount.value > 0
    ? `${configuredCount.value} ${t('settings.provider.sidebar.configured')}`
    : t('settings.toolchains.sources.unconfigured')
)

const parsedDraft = computed(() => {
  try {
    const parsed = JSON.parse(draft.value) as unknown
    const result = validateProviderCustomHeaders(parsed)
    return result.ok ? result.value : null
  } catch {
    return null
  }
})

const validationError = computed(() => {
  if (parsedDraft.value) return ''
  try {
    JSON.parse(draft.value)
    return t('settings.provider.customHeaders.description')
  } catch {
    return t('settings.provider.customHeaders.parseError')
  }
})

const isUnchanged = computed(
  () =>
    parsedDraft.value !== null &&
    canonicalizeProviderCustomHeaders(parsedDraft.value) ===
      canonicalizeProviderCustomHeaders(props.modelValue)
)

const saveDisabled = computed(() => saving.value || parsedDraft.value === null || isUnchanged.value)

const resetDraft = () => {
  draft.value = JSON.stringify(props.modelValue ?? {}, null, 2)
  submitError.value = ''
}

const ensureEditor = async () => {
  if (editorCreated || editorTask || !editorHost.value) {
    if (editorTask) await editorTask
    return
  }

  const generation = editorGeneration
  const host = editorHost.value
  editorTask = (async () => {
    try {
      await createEditor(host, draft.value, 'json')
      if (generation !== editorGeneration || !open.value) {
        cleanupEditor()
        return
      }

      const editor = getEditorView()
      editor?.onDidChangeModelContent(() => {
        draft.value = editor.getValue()
        submitError.value = ''
      })
      editorCreated = true
    } catch (error) {
      if (generation !== editorGeneration || !open.value) return
      console.error('[ProviderCustomHeadersEditor] Failed to initialize Monaco:', error)
      submitError.value = t('common.error.operationFailed')
    }
  })()

  try {
    await editorTask
  } finally {
    editorTask = null
  }
}

const disposeEditor = () => {
  editorGeneration += 1
  cleanupEditor()
  editorCreated = false
}

const formatDraft = () => {
  try {
    draft.value = JSON.stringify(JSON.parse(draft.value) as unknown, null, 2)
    submitError.value = ''
    if (editorCreated) updateCode(draft.value, 'json')
    getEditorView()?.focus()
  } catch {
    // The existing inline validation explains malformed JSON.
  }
}

const handleOpenChange = (nextOpen: boolean) => {
  if (saving.value && !nextOpen) return
  if (nextOpen) resetDraft()
  open.value = nextOpen
}

const handleOpenAutoFocus = (event: Event) => {
  event.preventDefault()
  void nextTick(async () => {
    await ensureEditor()
    if (open.value && !editorCreated) await ensureEditor()
    getEditorView()?.focus()
  })
}

const handleSave = async () => {
  if (!parsedDraft.value || saveDisabled.value) return

  saving.value = true
  submitError.value = ''
  let saved = false
  try {
    const headers = Object.keys(parsedDraft.value).length > 0 ? parsedDraft.value : undefined
    const result = await props.save(headers)
    saved = result.isOk
    if (!result.isOk) {
      submitError.value = result.errorMsg || t('settings.provider.stagedUpdate.failedDescription')
    }
  } catch (error) {
    submitError.value =
      error instanceof Error ? error.message : t('settings.provider.stagedUpdate.failedDescription')
  } finally {
    saving.value = false
  }

  if (saved) open.value = false
}

watch(
  open,
  async (isOpen) => {
    if (!isOpen) {
      disposeEditor()
      return
    }

    await nextTick()
    await ensureEditor()
    if (open.value && !editorCreated) await ensureEditor()
  },
  { flush: 'post' }
)

onBeforeUnmount(disposeEditor)
</script>
