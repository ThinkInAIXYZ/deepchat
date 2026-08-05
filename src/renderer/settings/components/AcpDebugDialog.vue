<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      hide-close
      class="top-0 left-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 pt-8 sm:max-w-none"
    >
      <header class="flex items-center justify-between gap-3 border-b px-6 py-4">
        <DialogHeader class="space-y-1 text-left">
          <DialogTitle class="text-lg font-semibold leading-tight">
            {{ t('settings.acp.debug.title') }}
          </DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            {{ t('settings.acp.debug.description', { name: agentName }) }}
          </DialogDescription>
        </DialogHeader>
        <div class="flex items-center gap-3">
          <DcStatusPill
            :status="processReady ? 'success' : 'neutral'"
            :label="
              processReady
                ? t('settings.acp.debug.processReady')
                : t('settings.acp.debug.processNotReady')
            "
          />
          <DcButton
            size="sm"
            variant="outline"
            class="h-8"
            :disabled="loading"
            @click="runHealthCheck"
          >
            <Spinner v-if="loading" data-icon="inline-start" />
            {{
              loading ? t('settings.acp.debug.healthChecking') : t('settings.acp.debug.healthCheck')
            }}
          </DcButton>
          <DcButton size="sm" variant="ghost" class="h-8" @click="clearEvents">
            {{ t('settings.acp.debug.clearHistory') }}
          </DcButton>
          <DcButton size="sm" variant="outline" class="h-8" @click="emit('update:open', false)">
            {{ t('settings.acp.debug.close') }}
          </DcButton>
        </div>
      </header>

      <div
        v-if="debugFeedback"
        role="alert"
        class="flex min-h-9 shrink-0 items-center gap-2 border-b border-destructive/25 bg-destructive/5 px-6 py-2 text-xs text-destructive"
      >
        <Icon icon="lucide:circle-alert" class="size-3.5 shrink-0" />
        <span class="shrink-0 font-medium">{{ debugFeedback.title }}</span>
        <span
          v-if="debugFeedback.description"
          class="min-w-0 truncate text-destructive/80"
          :title="debugFeedback.description"
        >
          {{ debugFeedback.description }}
        </span>
      </div>

      <div class="grid h-full min-h-0 flex-1 overflow-hidden lg:grid-cols-[260px_1fr]">
        <aside class="h-full min-h-0 space-y-2 overflow-y-auto border-r p-3">
          <DcButton
            v-for="method in methodOptions"
            :key="method.value"
            type="button"
            variant="outline"
            class="h-auto w-full flex-col items-start gap-1 px-3 py-2 text-left"
            :class="
              selectedMethod === method.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/60'
            "
            :disabled="loading || (!processReady && method.value !== 'initialize')"
            @click="selectMethod(method.value)"
          >
            <span class="text-sm font-medium leading-tight">{{ method.label }}</span>
          </DcButton>
        </aside>

        <main class="flex flex-col gap-4 p-4 overflow-hidden min-h-0 h-full">
          <div v-if="requiresCustomMethod" class="shrink-0 space-y-1">
            <div class="text-xs text-muted-foreground">
              {{ t('settings.acp.debug.customMethod') }}
            </div>
            <Input
              v-model="customMethod"
              :placeholder="t('settings.acp.debug.customMethodPlaceholder')"
              spellcheck="false"
              :aria-invalid="debugFeedback?.source === 'method' || undefined"
              @update:model-value="clearDebugFeedback"
            />
          </div>

          <div class="flex-1 min-h-0 flex flex-col gap-3">
            <div class="flex items-center justify-between px-3 py-2 border rounded-md bg-muted/40">
              <div class="text-sm font-medium">{{ t('settings.acp.debug.events') }}</div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.acp.debug.eventCount', { count: sortedEvents.length }) }}
              </div>
            </div>
            <div
              class="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/40 text-xs min-h-0 rounded-md"
            >
              <Empty v-if="!sortedEvents.length" class="border-0 py-6">
                <EmptyHeader>
                  <EmptyDescription class="text-xs">
                    {{ t('settings.acp.debug.empty') }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <div
                v-else
                v-for="event in sortedEvents"
                :key="event.id"
                class="rounded-md border p-2 space-y-1"
                :class="eventTone(event.kind)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <DcBadge variant="outline">{{ eventLabel(event.kind) }}</DcBadge>
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

          <div
            class="shrink-0 border rounded-lg overflow-hidden flex flex-col bg-background/80 shadow-sm"
          >
            <div
              class="border-x-0 border-b-0 border rounded-none bg-background overflow-hidden min-h-[200px] max-h-[340px] h-full"
            >
              <div ref="payloadEditor" class="h-full min-h-[200px]"></div>
            </div>

            <div
              class="flex flex-wrap items-center gap-3 px-3 py-3 border-t bg-muted/20 justify-between"
            >
              <div class="text-xs text-muted-foreground">
                {{ t('settings.acp.debug.payloadHint') }}
              </div>
              <div class="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                <span class="truncate max-w-[240px]" :title="workdirPath || undefined">
                  {{ workdirLabel }}
                </span>
                <DcButton
                  size="icon"
                  variant="ghost"
                  icon="lucide:folder-open"
                  :label="t('mcp.selectFolder')"
                  :tooltip="t('mcp.selectFolder')"
                  class="h-9 w-9"
                  :disabled="loading"
                  @click="handleSelectWorkdir"
                />
                <DcButton
                  v-if="workdirPath"
                  size="sm"
                  variant="ghost"
                  class="h-8"
                  :disabled="loading"
                  @click="clearWorkdir"
                >
                  {{ t('common.clear') }}
                </DcButton>
                <DcButton
                  size="sm"
                  variant="ghost"
                  class="h-8 px-2"
                  :disabled="loading"
                  @click="formatPayload"
                >
                  {{ t('settings.acp.debug.format') }}
                </DcButton>
                <DcButton
                  size="sm"
                  variant="ghost"
                  class="h-8 px-2"
                  :disabled="loading"
                  @click="resetPayload"
                >
                  {{ t('settings.acp.debug.resetTemplate') }}
                </DcButton>
                <DcButton
                  size="sm"
                  class="h-9"
                  :disabled="loading"
                  :class="loading ? 'opacity-80' : ''"
                  @click="handleSend"
                >
                  <Spinner v-if="loading" data-icon="inline-start" />
                  {{ loading ? t('settings.acp.debug.sending') : t('settings.acp.debug.send') }}
                </DcButton>
              </div>
            </div>
          </div>
        </main>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcStatusPill } from '@dc-ui/components/status-pill'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { DcBadge } from '@dc-ui/components/badge'
import { Empty, EmptyDescription, EmptyHeader } from '@shadcn/components/ui/empty'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Icon } from '@iconify/vue'
import type { AcpDebugEventEntry } from '@shared/types/acp'
import type { AcpDebugRequest } from '@shared/types/acp'
import { getRuntimeWebContentsId } from '@api/runtime'
import { createDeviceClient } from '@api/DeviceClient'
import { createProviderClient } from '@api/ProviderClient'
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
const deviceClient = createDeviceClient()
const providerClient = createProviderClient()
const uiSettingsStore = useUiSettingsStore()

const selectedMethod = ref<AcpDebugRequest['action']>('newSession')
const payloadText = ref('')
const workdirPath = ref('')
const customMethod = ref('')
const loading = ref(false)
const events = ref<AcpDebugEventEntry[]>([])
const seenIds = new Set<string>()
const webContentsId = ref<number | null>(null)
const debugSessionId = ref(createDebugSessionId())
const debugRequestId = ref(createDebugRequestId())
const processReady = ref(false)
const payloadEditor = ref<HTMLElement | null>(null)
type DebugFeedbackSource = 'payload' | 'method' | 'lifecycle' | 'request' | 'workdir' | 'editor'
type DebugFeedback = Readonly<{
  source: DebugFeedbackSource
  title: string
  description?: string
}>
const debugFeedback = ref<DebugFeedback | null>(null)
let editorCreated = false
let stopDebugEvents: (() => void) | null = null
let dialogGeneration = 0
const workdirLabel = computed(() =>
  workdirPath.value ? workdirPath.value : t('settings.acp.debug.workdirPlaceholder')
)

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

function createDebugRequestId() {
  return `debug-run-${nanoid(8)}`
}

const errorDescription = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const setDebugFeedback = (source: DebugFeedbackSource, title: string, description?: string) => {
  const normalizedDescription = description?.trim()
  debugFeedback.value = {
    source,
    title,
    ...(normalizedDescription && normalizedDescription !== title
      ? { description: normalizedDescription }
      : {})
  }
}

const clearDebugFeedback = () => {
  debugFeedback.value = null
}

const isCurrentDialogGeneration = (generation: number) =>
  props.open && generation === dialogGeneration

const methodOptions = computed(() => [
  {
    value: 'initialize' as const,
    label: t('settings.acp.debug.methods.initialize')
  },
  {
    value: 'authenticate' as const,
    label: t('settings.acp.debug.methods.authenticate')
  },
  {
    value: 'newSession' as const,
    label: t('settings.acp.debug.methods.newSession')
  },
  {
    value: 'loadSession' as const,
    label: t('settings.acp.debug.methods.loadSession')
  },
  {
    value: 'sessionList' as const,
    label: t('settings.acp.debug.methods.sessionList')
  },
  {
    value: 'sessionResume' as const,
    label: t('settings.acp.debug.methods.sessionResume')
  },
  {
    value: 'sessionClose' as const,
    label: t('settings.acp.debug.methods.sessionClose')
  },
  {
    value: 'sessionFork' as const,
    label: t('settings.acp.debug.methods.sessionFork')
  },
  {
    value: 'prompt' as const,
    label: t('settings.acp.debug.methods.prompt')
  },
  {
    value: 'cancel' as const,
    label: t('settings.acp.debug.methods.cancel')
  },
  {
    value: 'setSessionMode' as const,
    label: t('settings.acp.debug.methods.setSessionMode')
  },
  {
    value: 'setSessionModel' as const,
    label: t('settings.acp.debug.methods.setSessionModel')
  },
  {
    value: 'extMethod' as const,
    label: t('settings.acp.debug.methods.extMethod')
  },
  {
    value: 'extNotification' as const,
    label: t('settings.acp.debug.methods.extNotification')
  }
])

const requiresSession = computed(() =>
  [
    'prompt',
    'cancel',
    'setSessionMode',
    'setSessionModel',
    'loadSession',
    'sessionResume',
    'sessionClose',
    'sessionFork'
  ].includes(selectedMethod.value)
)

const requiresCustomMethod = computed(() =>
  ['extMethod', 'extNotification'].includes(selectedMethod.value)
)

const sortedEvents = computed(() => [...events.value].sort((a, b) => b.timestamp - a.timestamp))

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
  clearDebugFeedback()
  try {
    payloadText.value = JSON.stringify(JSON.parse(payloadText.value), null, 2)
    if (editorCreated) {
      updateCode(payloadText.value, 'json')
    }
  } catch (error) {
    setDebugFeedback('payload', t('settings.acp.debug.parseError'), errorDescription(error))
  }
}

const templateForMethod = (method: AcpDebugRequest['action']) => {
  switch (method) {
    case 'initialize':
      return {}
    case 'authenticate':
      return { methodId: '' }
    case 'newSession':
      return {
        ...(workdirPath.value ? { cwd: workdirPath.value } : {}),
        mcpServers: []
      }
    case 'loadSession':
      return {
        sessionId: debugSessionId.value,
        ...(workdirPath.value ? { cwd: workdirPath.value } : {})
      }
    case 'sessionList':
      return {
        ...(workdirPath.value ? { cwd: workdirPath.value } : {}),
        sync: true
      }
    case 'sessionResume':
      return {
        sessionId: debugSessionId.value,
        ...(workdirPath.value ? { cwd: workdirPath.value } : {}),
        mcpServers: []
      }
    case 'sessionClose':
      return {
        sessionId: debugSessionId.value
      }
    case 'sessionFork':
      return {
        sessionId: debugSessionId.value,
        ...(workdirPath.value ? { cwd: workdirPath.value } : {}),
        mcpServers: []
      }
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
  clearDebugFeedback()
  const content = JSON.stringify(templateForMethod(selectedMethod.value), null, 2)
  payloadText.value = content
  if (editorCreated) {
    updateCode(content, 'json')
  }
}

const applyWorkdirToPayload = (
  payload: Record<string, unknown> | undefined,
  method: AcpDebugRequest['action'] = selectedMethod.value
): Record<string, unknown> | undefined => {
  if (
    !['newSession', 'loadSession', 'sessionList', 'sessionResume', 'sessionFork'].includes(method)
  ) {
    return payload
  }
  const base = payload ?? {}
  return {
    ...base,
    ...(workdirPath.value ? { cwd: workdirPath.value } : {})
  }
}

const syncWorkdirIntoPayload = () => {
  if (
    !['newSession', 'loadSession', 'sessionList', 'sessionResume', 'sessionFork'].includes(
      selectedMethod.value
    )
  )
    return
  if (!payloadText.value.trim()) return
  try {
    const parsed = JSON.parse(payloadText.value) ?? {}
    if (workdirPath.value) {
      parsed.cwd = workdirPath.value
    } else {
      delete parsed.cwd
    }
    const content = JSON.stringify(parsed, null, 2)
    payloadText.value = content
    if (editorCreated) {
      updateCode(content, 'json')
    }
  } catch {
    // ignore sync errors to avoid interrupting editing
  }
}

const selectMethod = (method: AcpDebugRequest['action']) => {
  if (loading.value) return
  clearDebugFeedback()
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

const eventTone = (kind: AcpDebugEventEntry['kind']) => {
  if (kind === 'request') return 'bg-primary/5 border-primary/30'
  if (kind === 'lifecycle') return 'bg-sky-50 dark:bg-sky-950/30 border-sky-200/60'
  if (kind === 'stderr') return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60'
  if (kind === 'response') {
    return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-700/40'
  }
  if (kind === 'error') return 'bg-destructive/10 border-destructive/30'
  return 'bg-muted/40 border-border'
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.toLocaleTimeString()}`
}

const handleDebugEvent = (payload: unknown) => {
  const parsed = payload as {
    requestId?: string
    webContentsId?: number
    agentId?: string
    event?: AcpDebugEventEntry
  }
  if (!props.open || !parsed?.event || parsed.agentId !== props.agentId) return
  if (parsed.requestId !== debugRequestId.value) return
  if (parsed.webContentsId && parsed.webContentsId !== webContentsId.value) return
  appendEvents([parsed.event])
}

const parsePayload = () => {
  if (!payloadText.value.trim()) return undefined
  return JSON.parse(payloadText.value)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const handleSend = async () => {
  if (loading.value) return
  clearDebugFeedback()
  let parsedPayload: Record<string, unknown> | undefined
  try {
    parsedPayload = parsePayload()
  } catch (error) {
    setDebugFeedback('payload', t('settings.acp.debug.parseError'), errorDescription(error))
    return
  }

  if (requiresCustomMethod.value && !customMethod.value.trim()) {
    setDebugFeedback('method', t('settings.acp.debug.customMethodRequired'))
    return
  }

  if (!processReady.value && selectedMethod.value !== 'initialize') {
    setDebugFeedback('lifecycle', t('settings.acp.debug.needInitialize'))
    return
  }

  const generation = dialogGeneration
  const action = selectedMethod.value
  const methodName = requiresCustomMethod.value ? customMethod.value.trim() : undefined
  const workdir = workdirPath.value || undefined
  const payloadSessionId =
    isPlainObject(parsedPayload) &&
    typeof parsedPayload.sessionId === 'string' &&
    parsedPayload.sessionId.trim()
      ? parsedPayload.sessionId.trim()
      : undefined
  const fallbackSessionId = requiresSession.value
    ? debugSessionId.value.trim() || undefined
    : undefined
  const sessionId = payloadSessionId ?? fallbackSessionId
  const payloadToSend = applyWorkdirToPayload(parsedPayload, action)

  loading.value = true
  try {
    const result = await providerClient.runAcpDebugAction({
      requestId: debugRequestId.value,
      agentId: props.agentId,
      action,
      payload: payloadToSend,
      sessionId,
      workdir,
      methodName
    })
    if (!isCurrentDialogGeneration(generation)) return

    if (result?.events?.length) {
      appendEvents(result.events)
    }
    if (result?.sessionId) {
      debugSessionId.value = result.sessionId
    }
    if (result?.status === 'ok') {
      processReady.value = true
      clearDebugFeedback()
    }
    if (result?.status === 'error') {
      if (action === 'initialize') {
        processReady.value = false
      }
      setDebugFeedback('request', t('settings.acp.debug.requestFailed'), result.error || undefined)
    }
  } catch (error) {
    if (!isCurrentDialogGeneration(generation)) return
    setDebugFeedback('request', t('settings.acp.debug.requestFailed'), errorDescription(error))
  } finally {
    if (isCurrentDialogGeneration(generation)) {
      loading.value = false
    }
  }
}

const runHealthCheck = async () => {
  if (loading.value) return
  clearDebugFeedback()
  const generation = dialogGeneration
  const workdir = workdirPath.value || undefined
  clearEvents()
  debugSessionId.value = ''
  loading.value = true
  try {
    const initializeResult = await providerClient.runAcpDebugAction({
      requestId: debugRequestId.value,
      agentId: props.agentId,
      action: 'initialize',
      payload: templateForMethod('initialize'),
      workdir
    })
    if (!isCurrentDialogGeneration(generation)) return
    appendEvents(initializeResult.events ?? [])

    if (initializeResult.status === 'error') {
      throw new Error(initializeResult.error || t('settings.acp.debug.requestFailed'))
    }

    processReady.value = true

    const newSessionResult = await providerClient.runAcpDebugAction({
      requestId: debugRequestId.value,
      agentId: props.agentId,
      action: 'newSession',
      payload: applyWorkdirToPayload(templateForMethod('newSession'), 'newSession'),
      workdir
    })
    if (!isCurrentDialogGeneration(generation)) return
    appendEvents(newSessionResult.events ?? [])

    if (newSessionResult.status === 'error') {
      throw new Error(newSessionResult.error || t('settings.acp.debug.requestFailed'))
    }

    const newSessionId = newSessionResult.sessionId

    const cancelResult = await providerClient.runAcpDebugAction({
      requestId: debugRequestId.value,
      agentId: props.agentId,
      action: 'cancel',
      payload: templateForMethod('cancel'),
      sessionId: newSessionId,
      workdir
    })
    if (!isCurrentDialogGeneration(generation)) return
    appendEvents(cancelResult.events ?? [])

    if (cancelResult.status === 'error') {
      if (newSessionId) {
        debugSessionId.value = newSessionId
      }
      throw new Error(cancelResult.error || t('settings.acp.debug.requestFailed'))
    }

    selectedMethod.value = 'newSession'
    resetPayload()
  } catch (error) {
    if (!isCurrentDialogGeneration(generation)) return
    processReady.value = false
    setDebugFeedback(
      'lifecycle',
      t('settings.acp.debug.healthCheckFailed'),
      errorDescription(error)
    )
  } finally {
    if (isCurrentDialogGeneration(generation)) {
      loading.value = false
    }
  }
}

const handleSelectWorkdir = async () => {
  const generation = dialogGeneration
  clearDebugFeedback()
  try {
    const result = await deviceClient.selectDirectory()
    if (!isCurrentDialogGeneration(generation)) return
    if (result?.canceled || !result.filePaths?.length) return
    workdirPath.value = result.filePaths[0]
    syncWorkdirIntoPayload()
  } catch (error) {
    if (!isCurrentDialogGeneration(generation)) return
    console.error('[AcpDebugDialog] Failed to select a working directory:', error)
    setDebugFeedback('workdir', t('common.error.operationFailed'))
  }
}

const clearWorkdir = () => {
  clearDebugFeedback()
  workdirPath.value = ''
  syncWorkdirIntoPayload()
}

const ensureEditor = async () => {
  if (editorCreated || !payloadEditor.value) return
  await createEditor(payloadEditor.value, payloadText.value, 'json')
  const editor = getEditorView()
  if (editor) {
    editor.onDidChangeModelContent(() => {
      payloadText.value = editor.getValue()
      clearDebugFeedback()
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
    const generation = ++dialogGeneration
    if (open) {
      clearEvents()
      clearDebugFeedback()
      processReady.value = false
      selectedMethod.value = 'newSession'
      customMethod.value = ''
      debugSessionId.value = createDebugSessionId()
      debugRequestId.value = createDebugRequestId()
      try {
        await nextTick()
        if (!isCurrentDialogGeneration(generation)) return
        await ensureEditor()
        if (!isCurrentDialogGeneration(generation)) return
        resetPayload()
      } catch (error) {
        if (!isCurrentDialogGeneration(generation)) return
        console.error('[AcpDebugDialog] Failed to initialize payload editor:', error)
        setDebugFeedback('editor', t('common.error.operationFailed'))
      }
      return
    }
    disposeEditor()
    clearEvents()
    clearDebugFeedback()
    processReady.value = false
    loading.value = false
  }
)

onMounted(async () => {
  try {
    webContentsId.value = await getRuntimeWebContentsId()
  } catch (error) {
    console.warn('[AcpDebugDialog] Failed to resolve runtime webContents id:', error)
  }

  if (props.open) {
    const generation = dialogGeneration
    try {
      await nextTick()
      if (!isCurrentDialogGeneration(generation)) return
      await ensureEditor()
      if (!isCurrentDialogGeneration(generation)) {
        disposeEditor()
        return
      }
      resetPayload()
    } catch (error) {
      console.error('[AcpDebugDialog] Failed to initialize payload editor:', error)
      setDebugFeedback('editor', t('common.error.operationFailed'))
    }
  }
  stopDebugEvents = providerClient.onAcpDebugEvent(handleDebugEvent)
})

onBeforeUnmount(() => {
  dialogGeneration += 1
  disposeEditor()
  stopDebugEvents?.()
  stopDebugEvents = null
})
</script>
