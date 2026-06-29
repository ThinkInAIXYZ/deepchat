<template>
  <Dialog v-model:open="isOpen">
    <DialogContent
      :class="[
        'max-w-4xl max-h-[80vh] flex flex-col overflow-hidden',
        hasDiagnostics ? 'h-[80vh]' : ''
      ]"
    >
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

      <div
        v-else-if="hasDiagnostics"
        class="flex flex-col flex-1 min-h-0 space-y-4 overflow-hidden"
      >
        <div v-if="requestOptions.length > 1" class="flex flex-wrap gap-2">
          <Button
            v-for="option in requestOptions"
            :key="option.requestSeq"
            size="sm"
            :variant="option.requestSeq === selectedRequestSeq ? 'default' : 'outline'"
            @click="selectedRequestSeq = option.requestSeq"
          >
            #{{ option.requestSeq }}
          </Button>
        </div>

        <div class="space-y-3 text-sm">
          <div v-if="selectedTrace">
            <span class="font-semibold">{{ t('traceDialog.endpoint') }}:</span>
            <div class="mt-1 px-2 py-1 bg-muted rounded break-all">
              <span class="text-xs">{{ selectedTrace.endpoint }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.provider') }}:</span>
              <span class="ml-2 `wrap-break-word">{{
                diagnosticProviderId || t('traceDialog.notAvailable')
              }}</span>
            </div>
            <div class="min-w-0">
              <span class="font-semibold">{{ t('traceDialog.model') }}:</span>
              <span class="ml-2 `wrap-break-word">{{
                diagnosticModelId || t('traceDialog.notAvailable')
              }}</span>
            </div>
          </div>
          <div v-if="integrityStatus" class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold">{{ t('traceDialog.integrity.label') }}:</span>
              <Badge :variant="integrityVariant">
                {{ t(`traceDialog.integrity.${integrityStatus}`) }}
              </Badge>
            </div>
            <p v-if="integrityStatus === 'invalid'" class="text-xs text-destructive">
              {{ t('traceDialog.integrity.invalidWarning') }}
            </p>
            <p v-else-if="integrityStatus === 'unverified'" class="text-xs text-muted-foreground">
              {{ t('traceDialog.integrity.unverifiedNote') }}
            </p>
          </div>
        </div>

        <Tabs v-model="activeTab" class="h-0 flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList class="grid grid-cols-4 w-full">
            <TabsTrigger
              v-for="tab in diagnosticTabs"
              :key="tab.id"
              :value="tab.id"
              @click="activeTab = tab.id"
            >
              {{ t(tab.labelKey) }}
            </TabsTrigger>
          </TabsList>

          <div
            class="shrink-0 flex items-center justify-between px-4 py-2 bg-muted border-x border-t"
          >
            <span class="text-sm font-semibold">{{ activeTabLabel }}</span>
            <Button variant="ghost" size="sm" :disabled="!activeJson" @click="copyJson">
              <Icon icon="lucide:copy" class="w-4 h-4 mr-1" />
              {{ copySuccess ? t('traceDialog.copySuccess') : t('traceDialog.copyJson') }}
            </Button>
          </div>

          <TabsContent
            v-if="activeTab === 'request'"
            value="request"
            class="h-0 flex-1 min-h-0 border rounded-b-lg overflow-hidden mt-0"
          >
            <div v-if="selectedTrace" class="relative h-full min-h-0 bg-muted/30">
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
                  class="text-xs whitespace-pre-wrap wrap-break-word"
                ><code>{{ formattedJson }}</code></pre>
              </div>
            </div>
            <div v-else class="h-full flex flex-col items-center justify-center p-6 text-center">
              <Icon icon="lucide:file-json-2" class="w-10 h-10 text-muted-foreground mb-2" />
              <p class="text-sm font-medium">{{ t('traceDialog.requestUnavailable') }}</p>
              <p class="text-xs text-muted-foreground mt-1">
                {{ t('traceDialog.requestUnavailableDesc') }}
              </p>
            </div>
          </TabsContent>

          <TabsContent
            v-if="activeTab === 'view'"
            value="view"
            class="flex-1 min-h-0 border rounded-b-lg overflow-auto p-4 mt-0"
          >
            <div v-if="selectedManifest" class="grid grid-cols-2 gap-3 text-sm">
              <div
                v-for="item in manifestOverview"
                :key="item.label"
                class="min-w-0 border rounded-md p-3"
              >
                <div class="text-xs text-muted-foreground">{{ item.label }}</div>
                <div class="mt-1 font-mono text-xs break-all">{{ item.value }}</div>
              </div>
            </div>
            <div v-else class="h-full flex flex-col items-center justify-center p-6 text-center">
              <Icon icon="lucide:layers-2" class="w-10 h-10 text-muted-foreground mb-2" />
              <p class="text-sm font-medium">{{ t('traceDialog.manifestUnavailable') }}</p>
              <p class="text-xs text-muted-foreground mt-1">
                {{ t('traceDialog.manifestUnavailableDesc') }}
              </p>
            </div>
          </TabsContent>

          <TabsContent
            v-if="activeTab === 'entries'"
            value="entries"
            class="flex-1 min-h-0 border rounded-b-lg overflow-auto p-4 mt-0"
          >
            <div v-if="selectedManifest" class="space-y-5">
              <section v-if="excludedRanges.length">
                <h3 class="text-sm font-semibold mb-2">{{ t('traceDialog.compactedRanges') }}</h3>
                <div class="overflow-auto border rounded-md">
                  <table class="w-full text-xs">
                    <thead class="bg-muted text-muted-foreground">
                      <tr>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.rangeFrom') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.rangeTo') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.rangeCount') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.reason') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(range, index) in excludedRanges"
                        :key="`range-${index}`"
                        class="border-t"
                      >
                        <td class="px-3 py-2 font-mono">{{ range.fromOrderSeq }}</td>
                        <td class="px-3 py-2 font-mono">{{ range.toOrderSeq }}</td>
                        <td class="px-3 py-2 font-mono">{{ range.count }}</td>
                        <td class="px-3 py-2">{{ range.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 class="text-sm font-semibold mb-2">{{ t('traceDialog.includedEntries') }}</h3>
                <div class="overflow-auto border rounded-md">
                  <table class="w-full text-xs">
                    <thead class="bg-muted text-muted-foreground">
                      <tr>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.entryId') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.messageId') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.orderSeq') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.role') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.source') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.reason') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(entry, index) in selectedManifest.manifest.included"
                        :key="`included-${index}`"
                        class="border-t"
                      >
                        <td class="px-3 py-2 font-mono">{{ formatNullable(entry.entryId) }}</td>
                        <td class="px-3 py-2 font-mono break-all">
                          {{ formatNullable(entry.messageId) }}
                        </td>
                        <td class="px-3 py-2 font-mono">{{ formatNullable(entry.orderSeq) }}</td>
                        <td class="px-3 py-2">{{ formatNullable(entry.role) }}</td>
                        <td class="px-3 py-2">{{ entry.source }}</td>
                        <td class="px-3 py-2">{{ entry.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 class="text-sm font-semibold mb-2">{{ t('traceDialog.excludedEntries') }}</h3>
                <div class="overflow-auto border rounded-md">
                  <table class="w-full text-xs">
                    <thead class="bg-muted text-muted-foreground">
                      <tr>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.entryId') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.messageId') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.orderSeq') }}</th>
                        <th class="text-left px-3 py-2">{{ t('traceDialog.reason') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(entry, index) in selectedManifest.manifest.excluded"
                        :key="`excluded-${index}`"
                        class="border-t"
                      >
                        <td class="px-3 py-2 font-mono">{{ formatNullable(entry.entryId) }}</td>
                        <td class="px-3 py-2 font-mono break-all">
                          {{ formatNullable(entry.messageId) }}
                        </td>
                        <td class="px-3 py-2 font-mono">{{ formatNullable(entry.orderSeq) }}</td>
                        <td class="px-3 py-2">{{ entry.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <div v-else class="h-full flex flex-col items-center justify-center p-6 text-center">
              <Icon icon="lucide:list-tree" class="w-10 h-10 text-muted-foreground mb-2" />
              <p class="text-sm font-medium">{{ t('traceDialog.manifestUnavailable') }}</p>
              <p class="text-xs text-muted-foreground mt-1">
                {{ t('traceDialog.manifestUnavailableDesc') }}
              </p>
            </div>
          </TabsContent>

          <TabsContent
            v-if="activeTab === 'budget'"
            value="budget"
            class="flex-1 min-h-0 border rounded-b-lg overflow-auto p-4 mt-0"
          >
            <div v-if="selectedManifest" class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div v-for="item in tokenBudgetItems" :key="item.label" class="border rounded-md p-3">
                <div class="text-xs text-muted-foreground">{{ item.label }}</div>
                <div class="mt-1 font-mono text-lg">{{ item.value }}</div>
              </div>
            </div>
            <div v-else class="h-full flex flex-col items-center justify-center p-6 text-center">
              <Icon icon="lucide:gauge" class="w-10 h-10 text-muted-foreground mb-2" />
              <p class="text-sm font-medium">{{ t('traceDialog.manifestUnavailable') }}</p>
              <p class="text-xs text-muted-foreground mt-1">
                {{ t('traceDialog.manifestUnavailableDesc') }}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-8 text-center">
        <Icon icon="lucide:file-search" class="w-12 h-12 text-muted-foreground mb-2" />
        <h3 class="text-lg font-semibold mb-1">{{ t('traceDialog.empty') }}</h3>
        <p class="text-sm text-muted-foreground">{{ t('traceDialog.emptyDesc') }}</p>
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { Badge } from '@shadcn/components/ui/badge'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { createDeviceClient } from '@api/DeviceClient'
import { createSessionClient } from '@api/SessionClient'
import { useMonaco } from 'stream-monaco'
import { useThemeStore } from '@/stores/theme'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import type { MessageTraceRecord } from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewManifestIntegrity,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'

type DiagnosticTab = 'request' | 'view' | 'entries' | 'budget'

const { t } = useI18n()
const deviceClient = createDeviceClient()
const sessionClient = createSessionClient()
const uiSettingsStore = useUiSettingsStore()
const themeStore = useThemeStore()
const resolvedTheme = computed(() => (themeStore.isDark ? 'vitesse-dark' : 'vitesse-light'))

const jsonEditor = ref<HTMLElement | null>(null)
const { createEditor, updateCode, cleanupEditor, getEditorView, getEditor } = useMonaco({
  readOnly: true,
  wordWrap: 'off',
  wrappingIndent: 'same',
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  themes: ['vitesse-dark', 'vitesse-light'],
  theme: resolvedTheme.value,
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
const manifestList = ref<DeepChatTapeViewManifestRecord[]>([])
const selectedRequestSeq = ref<number | null>(null)
const activeTab = ref<DiagnosticTab>('request')

const diagnosticTabs: Array<{ id: DiagnosticTab; labelKey: string }> = [
  { id: 'request', labelKey: 'traceDialog.tabs.request' },
  { id: 'view', labelKey: 'traceDialog.tabs.view' },
  { id: 'entries', labelKey: 'traceDialog.tabs.entries' },
  { id: 'budget', labelKey: 'traceDialog.tabs.budget' }
]

const requestOptions = computed(() => {
  const seqs = new Set<number>()
  for (const trace of traceList.value) {
    seqs.add(trace.requestSeq)
  }
  for (const manifest of manifestList.value) {
    seqs.add(manifest.requestSeq)
  }
  return [...seqs]
    .sort((left, right) => right - left)
    .map((requestSeq) => ({
      requestSeq
    }))
})

const hasDiagnostics = computed(() => traceList.value.length > 0 || manifestList.value.length > 0)

const selectedTrace = computed(() => {
  if (!traceList.value.length) {
    return null
  }

  if (selectedRequestSeq.value !== null) {
    return traceList.value.find((item) => item.requestSeq === selectedRequestSeq.value) ?? null
  }

  return traceList.value[0] ?? null
})

const selectedManifest = computed(() => {
  if (!manifestList.value.length) {
    return null
  }

  if (selectedRequestSeq.value !== null) {
    return manifestList.value.find((item) => item.requestSeq === selectedRequestSeq.value) ?? null
  }

  return manifestList.value[0] ?? null
})

const diagnosticProviderId = computed(
  () => selectedTrace.value?.providerId ?? selectedManifest.value?.manifest.meta.providerId ?? ''
)

const diagnosticModelId = computed(
  () => selectedTrace.value?.modelId ?? selectedManifest.value?.manifest.meta.modelId ?? ''
)

const integrityStatus = computed<DeepChatTapeViewManifestIntegrity | null>(
  () => selectedManifest.value?.integrity ?? null
)

const integrityVariant = computed<'secondary' | 'destructive' | 'outline'>(() => {
  if (integrityStatus.value === 'invalid') {
    return 'destructive'
  }
  if (integrityStatus.value === 'unverified') {
    return 'outline'
  }
  return 'secondary'
})

const excludedRanges = computed(() => selectedManifest.value?.manifest.excludedRanges ?? [])

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

const activeTabLabel = computed(() => {
  const tab = diagnosticTabs.find((item) => item.id === activeTab.value)
  return tab ? t(tab.labelKey) : t('traceDialog.body')
})

const activeJson = computed(() => {
  if (activeTab.value === 'request') {
    return formattedJson.value
  }
  if (!selectedManifest.value) {
    return ''
  }
  if (activeTab.value === 'view') {
    return JSON.stringify(selectedManifest.value.manifest, null, 2)
  }
  if (activeTab.value === 'entries') {
    return JSON.stringify(
      {
        included: selectedManifest.value.manifest.included,
        excluded: selectedManifest.value.manifest.excluded,
        excludedRanges: selectedManifest.value.manifest.excludedRanges ?? []
      },
      null,
      2
    )
  }
  return JSON.stringify(selectedManifest.value.manifest.tokenBudget, null, 2)
})

const manifestOverview = computed(() => {
  const manifest = selectedManifest.value?.manifest
  if (!manifest) return []
  return [
    { label: t('traceDialog.viewId'), value: manifest.viewId },
    { label: t('traceDialog.policy'), value: manifest.policy },
    ...(typeof manifest.policyVersion === 'number'
      ? [{ label: t('traceDialog.policyVersion'), value: String(manifest.policyVersion) }]
      : []),
    { label: t('traceDialog.taskType'), value: manifest.taskType },
    { label: t('traceDialog.requestSeq'), value: String(manifest.requestSeq) },
    { label: t('traceDialog.latestEntryId'), value: String(manifest.latestEntryId) },
    {
      label: t('traceDialog.reconstructionAnchor'),
      value: formatNullable(manifest.reconstructionAnchorEntryId ?? null)
    },
    {
      label: t('traceDialog.anchorEntryIds'),
      value: manifest.anchorEntryIds.length
        ? manifest.anchorEntryIds.join(', ')
        : t('traceDialog.notAvailable')
    },
    { label: t('traceDialog.schemaVersion'), value: String(manifest.schemaVersion) },
    { label: t('traceDialog.hashVersion'), value: String(manifest.hashVersion) },
    { label: t('traceDialog.promptHash'), value: manifest.hashes.promptHash },
    { label: t('traceDialog.toolDefinitionsHash'), value: manifest.hashes.toolDefinitionsHash },
    { label: t('traceDialog.manifestHash'), value: manifest.hashes.manifestHash }
  ]
})

const tokenBudgetItems = computed(() => {
  const budget = selectedManifest.value?.manifest.tokenBudget
  if (!budget) return []
  return [
    { label: t('traceDialog.contextLength'), value: budget.contextLength },
    { label: t('traceDialog.requestedMaxTokens'), value: budget.requestedMaxTokens },
    { label: t('traceDialog.effectiveMaxTokens'), value: budget.effectiveMaxTokens },
    { label: t('traceDialog.reserveTokens'), value: budget.reserveTokens },
    { label: t('traceDialog.toolReserveTokens'), value: budget.toolReserveTokens },
    { label: t('traceDialog.estimatedPromptTokens'), value: budget.estimatedPromptTokens }
  ]
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

const applyTheme = async () => {
  try {
    getEditor().setTheme(resolvedTheme.value)
  } catch (err) {
    console.warn('Failed to apply Monaco theme:', err)
  }
}

const layoutEditor = () => {
  try {
    getEditorView()?.layout()
  } catch (err) {
    console.warn('Failed to layout Monaco Editor:', err)
  }
}

watch(activeTab, (tab) => {
  if (tab !== 'request') {
    cleanupEditor()
    editorInitialized.value = false
  }
})

watch(
  [isOpen, activeTab, selectedTrace, formattedJson, jsonEditor],
  async ([open, tab, trace, json, editorEl]) => {
    if (open && tab === 'request' && trace && json && editorEl) {
      await nextTick()
      await nextTick()
      const hasEditor = editorEl.querySelector('.monaco-editor')
      if (!hasEditor && !editorInitialized.value) {
        try {
          await createEditor(editorEl, json, 'json')
          editorInitialized.value = true
          await applyTheme()
          applyFontFamily(uiSettingsStore.formattedCodeFontFamily)
          layoutEditor()
        } catch (err) {
          console.error('Failed to create Monaco Editor:', err)
        }
      } else if (hasEditor && editorInitialized.value) {
        updateCode(json, 'json')
        layoutEditor()
      }
    }
  },
  { flush: 'post' }
)

onMounted(async () => {
  if (
    isOpen.value &&
    activeTab.value === 'request' &&
    selectedTrace.value &&
    formattedJson.value &&
    jsonEditor.value
  ) {
    await nextTick()
    await nextTick()
    if (!jsonEditor.value.querySelector('.monaco-editor') && !editorInitialized.value) {
      try {
        await createEditor(jsonEditor.value, formattedJson.value, 'json')
        editorInitialized.value = true
        await applyTheme()
        applyFontFamily(uiSettingsStore.formattedCodeFontFamily)
        layoutEditor()
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

watch(
  resolvedTheme,
  () => {
    if (isOpen.value && editorInitialized.value) {
      void applyTheme()
    }
  },
  { flush: 'post' }
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
  manifestList.value = []
  selectedRequestSeq.value = null
  activeTab.value = 'request'

  try {
    const { traces, manifests } = await sessionClient.listMessageTraceDiagnostics(messageId)
    if (currentRequestId !== requestId.value) {
      return
    }

    traceList.value = Array.isArray(traces) ? traces : []
    manifestList.value = Array.isArray(manifests) ? manifests : []
    selectedRequestSeq.value =
      traceList.value[0]?.requestSeq ?? manifestList.value[0]?.requestSeq ?? null
    activeTab.value = traceList.value.length > 0 ? 'request' : 'view'
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
  if (!activeJson.value) return
  try {
    deviceClient.copyText(activeJson.value)
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
  manifestList.value = []
  selectedRequestSeq.value = null
  activeTab.value = 'request'
  cleanupEditor()
  editorInitialized.value = false
}

const formatNullable = (value: string | number | null): string => {
  if (value === null) {
    return t('traceDialog.notAvailable')
  }
  return String(value)
}

const close = () => {
  isOpen.value = false
  resetState()
  emit('close')
}
</script>
