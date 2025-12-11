<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[200] bg-background text-foreground flex flex-col pt-8 min-h-0"
    >
      <header class="flex items-center justify-between px-6 py-4 border-b gap-3">
        <div class="space-y-1">
          <div class="text-lg font-semibold leading-tight">
            {{ t('settings.acp.debug.title') }}
          </div>
          <p class="text-sm text-muted-foreground">
            {{ t('settings.acp.debug.description', { name: agentName }) }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <div
            class="flex items-center gap-2 text-xs px-3 py-1 rounded-full border"
            :class="processReady ? 'border-emerald-500/50 text-emerald-600' : 'border-border'"
          >
            <span
              class="h-2 w-2 rounded-full"
              :class="processReady ? 'bg-emerald-500' : 'bg-muted-foreground/60'"
            ></span>
            <span>
              {{
                processReady
                  ? t('settings.acp.debug.processReady')
                  : t('settings.acp.debug.processNotReady')
              }}
            </span>
          </div>
          <Button size="sm" variant="ghost" class="h-8" @click="clearEvents">
            {{ t('settings.acp.debug.clearHistory') }}
          </Button>
          <Button size="sm" variant="outline" class="h-8" @click="emit('update:open', false)">
            {{ t('settings.acp.debug.close') }}
          </Button>
        </div>
      </header>

      <div class="flex-1 grid lg:grid-cols-[260px_1fr] min-h-0 overflow-hidden h-full">
        <aside class="border-r overflow-y-auto p-3 space-y-2 min-h-0 h-full">
          <div class="px-2 text-xs text-muted-foreground">
            {{ t('settings.acp.debug.methodHint') }}
          </div>
          <button
            v-for="method in methodOptions"
            :key="method.value"
            class="w-full text-left rounded-md border transition flex flex-col gap-1 px-3 py-2"
            :class="
              selectedMethod === method.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/60'
            "
            :disabled="!processReady && method.value !== 'initialize'"
            @click="selectMethod(method.value)"
          >
            <div class="text-sm font-medium leading-tight">{{ method.label }}</div>
            <p class="text-xs text-muted-foreground leading-tight">
              {{ method.description }}
            </p>
          </button>
        </aside>

        <main class="flex flex-col gap-4 p-4 overflow-hidden min-h-0 h-full">
          <div class="grid gap-3 md:grid-cols-2 shrink-0">
            <div class="space-y-1">
              <div class="text-xs text-muted-foreground">
                {{ t('settings.acp.debug.workdir') }}
              </div>
              <div class="flex items-center gap-2">
                <Input
                  :value="workdirPath"
                  readonly
                  :placeholder="t('settings.acp.debug.workdirPlaceholder')"
                  class="flex-1"
                />
                <Button size="sm" variant="outline" class="h-9" @click="handleSelectWorkdir">
                  <Icon icon="lucide:folder-open" class="h-4 w-4 mr-1" />
                  {{
                    workdirPath
                      ? t('settings.acp.debug.changeWorkdir')
                      : t('settings.acp.debug.pickWorkdir')
                  }}
                </Button>
                <Button
                  v-if="workdirPath"
                  size="sm"
                  variant="ghost"
                  class="h-9"
                  @click="clearWorkdir"
                >
                  {{ t('common.clear') }}
                </Button>
              </div>
            </div>
            <div v-if="requiresCustomMethod" class="space-y-1">
              <div class="text-xs text-muted-foreground">
                {{ t('settings.acp.debug.customMethod') }}
              </div>
              <Input
                v-model="customMethod"
                :placeholder="t('settings.acp.debug.customMethodPlaceholder')"
                spellcheck="false"
              />
            </div>
          </div>

          <div class="space-y-2 min-h-0 shrink-0">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">{{ t('settings.acp.debug.payload') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.acp.debug.payloadHint') }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="ghost" class="h-8 px-2" @click="formatPayload">
                  {{ t('settings.acp.debug.format') }}
                </Button>
                <Button size="sm" variant="ghost" class="h-8 px-2" @click="resetPayload">
                  {{ t('settings.acp.debug.resetTemplate') }}
                </Button>
              </div>
            </div>
            <div
              class="border rounded-md bg-background overflow-hidden min-h-[260px] max-h-[420px] h-full"
            >
              <div ref="payloadEditor" class="h-full min-h-[260px]"></div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{{ t('settings.acp.debug.agentBadge') }}</Badge>
              <span class="truncate">{{ agentName }}</span>
            </div>
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                class="h-8"
                :disabled="loading"
                :class="loading ? 'opacity-80' : ''"
                @click="handleSend"
              >
                <Icon v-if="loading" icon="lucide:loader" class="h-4 w-4 mr-2 animate-spin" />
                {{ loading ? t('settings.acp.debug.sending') : t('settings.acp.debug.send') }}
              </Button>
            </div>
          </div>

          <div class="flex-1 min-h-0 border rounded-lg overflow-hidden flex flex-col">
            <div class="flex items-center justify-between px-3 py-2 border-b">
              <div class="text-sm font-medium">{{ t('settings.acp.debug.events') }}</div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.acp.debug.eventCount', { count: sortedEvents.length }) }}
              </div>
            </div>
            <div class="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/40 text-xs min-h-0">
              <div
                v-if="!sortedEvents.length"
                class="text-muted-foreground text-xs text-center py-6"
              >
                {{ t('settings.acp.debug.empty') }}
              </div>
              <div
                v-else
                v-for="event in sortedEvents"
                :key="event.id"
                class="bg-background rounded-md border p-2 space-y-1"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <Badge variant="outline">{{ eventLabel(event.kind) }}</Badge>
                    <span class="font-mono text-[11px] text-muted-foreground">
                      {{ formatTime(event.timestamp) }}
                    </span>
                  </div>
                  <div class="text-[11px] font-medium truncate">{{ event.action }}</div>
                </div>
                <div v-if="event.sessionId" class="text-[11px] text-muted-foreground">
                  SID: {{ event.sessionId }}
                </div>
                <div v-if="event.message" class="text-[11px] text-destructive">
                  {{ event.message }}
                </div>
                <pre
                  v-if="event.payload !== undefined"
                  class="mt-1 rounded bg-muted px-2 py-1 whitespace-pre-wrap break-words overflow-x-auto text-[11px]"
                  >{{ stringify(event.payload) }}</pre
                >
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Teleport, computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Badge } from '@shadcn/components/ui/badge'
import { Icon } from '@iconify/vue'
import type { AcpDebugEventEntry, AcpDebugRequest } from '@shared/presenter'
import { usePresenter, getWebContentsId } from '@/composables/usePresenter'
import { ACP_DEBUG_EVENTS } from '@/events'
import { useToast } from '@/components/use-toast'
import { nanoid } from 'nanoid'
import { useMonaco } from 'stream-monaco'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

const props = defineProps<{
  open: boolean
  agentId: string
  agentName: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const { toast } = useToast()
const llmProviderPresenter = usePresenter('llmproviderPresenter')
const devicePresenter = usePresenter('devicePresenter')
const uiSettingsStore = useUiSettingsStore()

const selectedMethod = ref<AcpDebugRequest['action']>('initialize')
const payloadText = ref('')
const workdirPath = ref('')
const customMethod = ref('')
const loading = ref(false)
const events = ref<AcpDebugEventEntry[]>([])
const seenIds = new Set<string>()
const webContentsId = getWebContentsId()
const debugSessionId = ref(createDebugSessionId())
const processReady = ref(false)
const payloadEditor = ref<HTMLElement | null>(null)
let editorCreated = false

const { createEditor, updateCode, getEditorView, cleanupEditor } = useMonaco({
  readOnly: false,
  wordWrap: 'on',
  wrappingIndent: 'same',
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  lineNumbers: 'on'
})

function createDebugSessionId() {
  return `debug-${nanoid(6)}`
}

const methodOptions = computed(() => [
  {
    value: 'initialize' as const,
    label: t('settings.acp.debug.methods.initialize'),
    description: t('settings.acp.debug.methods.initializeDesc')
  },
  {
    value: 'newSession' as const,
    label: t('settings.acp.debug.methods.newSession'),
    description: t('settings.acp.debug.methods.newSessionDesc')
  },
  {
    value: 'loadSession' as const,
    label: t('settings.acp.debug.methods.loadSession'),
    description: t('settings.acp.debug.methods.loadSessionDesc')
  },
  {
    value: 'prompt' as const,
    label: t('settings.acp.debug.methods.prompt'),
    description: t('settings.acp.debug.methods.promptDesc')
  },
  {
    value: 'cancel' as const,
    label: t('settings.acp.debug.methods.cancel'),
    description: t('settings.acp.debug.methods.cancelDesc')
  },
  {
    value: 'setSessionMode' as const,
    label: t('settings.acp.debug.methods.setSessionMode'),
    description: t('settings.acp.debug.methods.setSessionModeDesc')
  },
  {
    value: 'setSessionModel' as const,
    label: t('settings.acp.debug.methods.setSessionModel'),
    description: t('settings.acp.debug.methods.setSessionModelDesc')
  },
  {
    value: 'extMethod' as const,
    label: t('settings.acp.debug.methods.extMethod'),
    description: t('settings.acp.debug.methods.extMethodDesc')
  },
  {
    value: 'extNotification' as const,
    label: t('settings.acp.debug.methods.extNotification'),
    description: t('settings.acp.debug.methods.extNotificationDesc')
  }
])

const requiresSession = computed(() =>
  ['prompt', 'cancel', 'setSessionMode', 'setSessionModel', 'loadSession'].includes(
    selectedMethod.value
  )
)

const requiresCustomMethod = computed(() =>
  ['extMethod', 'extNotification'].includes(selectedMethod.value)
)

const sortedEvents = computed(() => [...events.value].sort((a, b) => a.timestamp - b.timestamp))

const appendEvents = (items: AcpDebugEventEntry[]) => {
  items.forEach((event) => {
    if (seenIds.has(event.id)) return
    seenIds.add(event.id)
    events.value.push(event)
  })
}

const stringify = (payload: unknown) => {
  try {
    return JSON.stringify(payload, null, 2)
  } catch (error) {
    return String(payload)
  }
}

const formatPayload = () => {
  if (!payloadText.value.trim()) return
  try {
    payloadText.value = JSON.stringify(JSON.parse(payloadText.value), null, 2)
    if (editorCreated) {
      updateCode(payloadText.value, 'json')
    }
  } catch (error) {
    toast({
      title: t('settings.acp.debug.parseError'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const templateForMethod = (method: AcpDebugRequest['action']) => {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '1.0',
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true
        },
        clientInfo: { name: 'DeepChat', version: 'debug' }
      }
    case 'newSession':
      return {
        cwd: workdirPath.value || undefined,
        mcpServers: []
      }
    case 'loadSession':
      return { sessionId: debugSessionId.value }
    case 'prompt':
      return {
        prompt: [{ type: 'text', text: 'ping' }]
      }
    case 'cancel':
      return {}
    case 'setSessionMode':
      return { modeId: 'default' }
    case 'setSessionModel':
      return { modelId: '' }
    case 'extMethod':
    case 'extNotification':
      return {}
    default:
      return {}
  }
}

const resetPayload = () => {
  const content = JSON.stringify(templateForMethod(selectedMethod.value), null, 2)
  payloadText.value = content
  if (editorCreated) {
    updateCode(content, 'json')
  }
}

const selectMethod = (method: AcpDebugRequest['action']) => {
  selectedMethod.value = method
  if (!requiresCustomMethod.value) {
    customMethod.value = ''
  }
  resetPayload()
}

const clearEvents = () => {
  events.value = []
  seenIds.clear()
}

const eventLabel = (kind: AcpDebugEventEntry['kind']) => {
  return t(`settings.acp.debug.eventKinds.${kind}`)
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.toLocaleTimeString()}`
}

const handleDebugEvent = (_event: unknown, payload: unknown) => {
  const parsed = payload as {
    webContentsId?: number
    agentId?: string
    event?: AcpDebugEventEntry
  }
  if (!parsed?.event || parsed.agentId !== props.agentId) return
  if (parsed.webContentsId && parsed.webContentsId !== webContentsId) return
  appendEvents([parsed.event])
}

const parsePayload = () => {
  if (!payloadText.value.trim()) return undefined
  return JSON.parse(payloadText.value)
}

const handleSend = async () => {
  let parsedPayload: Record<string, unknown> | undefined
  try {
    parsedPayload = parsePayload()
  } catch (error) {
    toast({
      title: t('settings.acp.debug.parseError'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
    return
  }

  if (requiresCustomMethod.value && !customMethod.value.trim()) {
    toast({
      title: t('settings.acp.debug.customMethodRequired'),
      variant: 'destructive'
    })
    return
  }

  if (!processReady.value && selectedMethod.value !== 'initialize') {
    toast({
      title: t('settings.acp.debug.needInitialize'),
      variant: 'destructive'
    })
    selectedMethod.value = 'initialize'
    resetPayload()
    return
  }

  const sessionId = requiresSession.value ? debugSessionId.value : undefined

  loading.value = true
  try {
    const result = await llmProviderPresenter.runAcpDebugAction({
      agentId: props.agentId,
      action: selectedMethod.value,
      payload: parsedPayload,
      sessionId,
      workdir: workdirPath.value || undefined,
      methodName: requiresCustomMethod.value ? customMethod.value.trim() : undefined,
      webContentsId: webContentsId || undefined
    })

    if (result?.events?.length) {
      appendEvents(result.events)
    }
    if (result?.sessionId) {
      debugSessionId.value = result.sessionId
    }
    if (selectedMethod.value === 'initialize' && result?.status === 'ok') {
      processReady.value = true
    }
    if (result && result.status === 'error' && result.error) {
      toast({
        title: result.error,
        variant: 'destructive'
      })
    }
  } catch (error) {
    toast({
      title: t('settings.acp.debug.requestFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

const handleSelectWorkdir = async () => {
  const result = await devicePresenter.selectDirectory()
  if (result?.canceled || !result.filePaths?.length) return
  workdirPath.value = result.filePaths[0]
}

const clearWorkdir = () => {
  workdirPath.value = ''
}

const ensureEditor = async () => {
  if (editorCreated || !payloadEditor.value) return
  await createEditor(payloadEditor.value, payloadText.value, 'json')
  const editor = getEditorView()
  if (editor) {
    editor.onDidChangeModelContent(() => {
      payloadText.value = editor.getValue()
    })
  }
  editorCreated = true
}

const disposeEditor = () => {
  if (!editorCreated) return
  cleanupEditor()
  editorCreated = false
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      clearEvents()
      processReady.value = false
      selectedMethod.value = 'initialize'
      customMethod.value = ''
      debugSessionId.value = createDebugSessionId()
      await nextTick()
      await ensureEditor()
      resetPayload()
      return
    }
    disposeEditor()
    clearEvents()
    processReady.value = false
    loading.value = false
  }
)

onMounted(async () => {
  if (props.open) {
    await nextTick()
    await ensureEditor()
    resetPayload()
  }
  if (window.electron) {
    window.electron.ipcRenderer.on(ACP_DEBUG_EVENTS.EVENT, handleDebugEvent)
  }
})

onBeforeUnmount(() => {
  disposeEditor()
  if (window.electron) {
    window.electron.ipcRenderer.removeListener(ACP_DEBUG_EVENTS.EVENT, handleDebugEvent)
  }
})
</script>
