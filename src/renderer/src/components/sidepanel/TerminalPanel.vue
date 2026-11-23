<template>
  <div
    class="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
    data-testid="terminal-panel"
  >
    <div
      v-if="state === 'no-workdir' || state === 'workdir-missing'"
      class="m-3 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-4 text-center"
      data-testid="terminal-no-workdir"
    >
      <Icon icon="lucide:folder-plus" class="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p class="mb-2 text-xs font-medium text-foreground">
        {{
          state === 'no-workdir'
            ? t('chat.terminal.noWorkdir.title')
            : t('chat.terminal.workdirMissing.title')
        }}
      </p>
      <p class="mb-3 text-[11px] text-muted-foreground">
        {{
          state === 'no-workdir'
            ? t('chat.terminal.noWorkdir.description')
            : t('chat.terminal.workdirMissing.description')
        }}
      </p>
      <DcButton variant="outline" size="sm" class="h-7 text-xs" @click="selectFolder">
        <Icon icon="lucide:folder-open" class="mr-1.5 h-3.5 w-3.5" />
        {{ t('chat.workspace.files.noWorkspace.button') }}
      </DcButton>
    </div>

    <template v-else>
      <div
        ref="terminalHost"
        class="terminal-host min-h-0 flex-1 overflow-hidden px-2 pt-2"
        :style="{ backgroundColor: terminalTheme.background }"
        data-testid="terminal-host"
      />
      <div
        class="flex h-8 shrink-0 items-center gap-2 border-t px-3 text-[11px] text-muted-foreground"
      >
        <span class="min-w-0 flex-1 truncate" :title="statusTitle" data-testid="terminal-status">
          {{ statusLabel }}
        </span>
        <span v-if="workdirChanged" class="shrink-0 text-amber-600 dark:text-amber-400">
          {{ t('chat.terminal.workdirChanged') }}
        </span>
        <DcButton
          v-if="state === 'running' || state === 'exited' || state === 'error'"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[11px]"
          data-testid="terminal-restart"
          @click="restartTerminal"
        >
          {{ t('chat.terminal.restart') }}
        </DcButton>
        <DcButton
          v-if="state === 'running'"
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[11px]"
          data-testid="terminal-kill"
          @click="killTerminal"
        >
          {{ t('chat.terminal.kill') }}
        </DcButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { createProjectClient } from '@api/ProjectClient'
import { createTerminalClient } from '@api/TerminalClient'
import type { DeepchatRouteOutput } from '@shared/contracts/routes'
import { TERMINAL_INPUT_CHUNK_MAX } from '@shared/contracts/routes'
import { useAccessibilitySupport } from '@/composables/useAccessibilitySupport'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useThemeStore } from '@/stores/theme'

type TerminalSnapshot = DeepchatRouteOutput<'terminal.attach'>
type PanelState =
  | 'idle'
  | 'connecting'
  | 'running'
  | 'exited'
  | 'no-workdir'
  | 'workdir-missing'
  | 'error'

/** The subset of the xterm.js API shared by ghostty-web and @xterm/xterm. */
interface TerminalView {
  cols: number
  rows: number
  textarea?: HTMLTextAreaElement
  open(parent: HTMLElement): void
  write(data: string): void
  reset(): void
  focus(): void
  dispose(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
}

const props = defineProps<{
  sessionId: string
  workspacePath: string | null
}>()
const emit = defineEmits<{ 'update:workspacePath': [path: string | null] }>()

const { t } = useI18n()
const client = createTerminalClient()
const projectClient = createProjectClient()
const sidepanelStore = useSidepanelStore()
const themeStore = useThemeStore()
const { accessibilityEnabled } = useAccessibilitySupport()

const terminalHost = ref<HTMLElement | null>(null)
const state = ref<PanelState>('idle')
const snapshot = ref<TerminalSnapshot | null>(null)
const exitCode = ref<number | null>(null)
const errorMessage = ref<string | null>(null)

let view: TerminalView | null = null
let viewDisposers: Array<() => void> = []
let resizeObserver: ResizeObserver | null = null
let fitView: (() => { cols: number; rows: number } | undefined) | null = null
let fitFrame: number | null = null
let inputBuffer = ''
let inputTimer: ReturnType<typeof setTimeout> | null = null
let attachGeneration = 0
let renderedOutputEnd = 0
let ghosttyReady: Promise<void> | null = null
let disposed = false

const DARK_THEME = {
  background: '#111318',
  foreground: '#e5e7eb',
  cursor: '#e5e7eb',
  selectionBackground: '#3b4252'
}
const LIGHT_THEME = {
  background: '#fbfbfc',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#cfd8e3'
}
const terminalTheme = computed(() => (themeStore.isDark ? DARK_THEME : LIGHT_THEME))
const terminalLabel = computed(() => t('chat.terminal.label'))

const workdirChanged = computed(() => {
  const cwd = snapshot.value?.cwd
  return Boolean(cwd && props.workspacePath && cwd !== props.workspacePath)
})

const shellName = computed(() => {
  const shell = snapshot.value?.shell ?? ''
  return shell.split(/[\\/]/).pop() || shell
})

const statusLabel = computed(() => {
  switch (state.value) {
    case 'connecting':
      return t('chat.terminal.status.starting')
    case 'running':
      return `${shellName.value} · ${snapshot.value?.cwd ?? ''}`
    case 'exited':
      return t('chat.terminal.status.exited', { code: exitCode.value ?? '?' })
    case 'error':
      return errorMessage.value ?? t('chat.terminal.status.error')
    default:
      return ''
  }
})
const statusTitle = computed(() => snapshot.value?.cwd ?? '')

function mapError(error: unknown): PanelState {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('[terminal:no_workdir]')) return 'no-workdir'
  if (message.includes('[terminal:workdir_missing]')) return 'workdir-missing'
  if (message.includes('[terminal:capacity]')) {
    errorMessage.value = t('chat.terminal.status.capacity')
  } else {
    errorMessage.value = t('chat.terminal.status.error')
  }
  console.warn('[TerminalPanel] terminal request failed:', error)
  return 'error'
}

async function loadGhostty() {
  ghosttyReady ??= import('ghostty-web').then((module) => module.init())
  await ghosttyReady
}

async function createView(): Promise<TerminalView | null> {
  const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  if (accessibilityEnabled.value) {
    // ghostty-web renders to canvas without an accessible buffer; xterm keeps screen readers working.
    const { Terminal } = await import('@xterm/xterm')
    await import('@xterm/xterm/css/xterm.css')
    const terminal = new Terminal({
      screenReaderMode: true,
      cursorBlink: true,
      fontFamily,
      fontSize: 13,
      scrollback: 5_000,
      theme: terminalTheme.value
    })
    fitView = () => fitXterm(terminal)
    return terminal as unknown as TerminalView
  }
  await loadGhostty()
  const { Terminal, FitAddon } = await import('ghostty-web')
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily,
    fontSize: 13,
    scrollback: 5_000,
    theme: terminalTheme.value
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  fitView = () => {
    fit.fit()
    return { cols: terminal.cols, rows: terminal.rows }
  }
  return terminal as unknown as TerminalView
}

/** Minimal fit for xterm, which ships no fit logic in core. */
function fitXterm(terminal: import('@xterm/xterm').Terminal) {
  const host = terminalHost.value
  const core = (
    terminal as unknown as {
      _core?: {
        _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } }
      }
    }
  )._core
  const cell = core?._renderService?.dimensions?.css?.cell
  if (!host || !cell?.width || !cell.height) return undefined
  const cols = Math.max(2, Math.floor((host.clientWidth - 16) / cell.width))
  const rows = Math.max(1, Math.floor((host.clientHeight - 8) / cell.height))
  if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows)
  return { cols, rows }
}

function disposeView() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (fitFrame !== null) cancelAnimationFrame(fitFrame)
  fitFrame = null
  for (const dispose of viewDisposers.splice(0)) dispose()
  flushInput()
  view?.dispose()
  view = null
  fitView = null
  if (terminalHost.value) terminalHost.value.replaceChildren()
}

function flushInput() {
  if (inputTimer) clearTimeout(inputTimer)
  inputTimer = null
  const pending = inputBuffer
  inputBuffer = ''
  const terminalId = snapshot.value?.terminalId
  if (!terminalId || !pending || state.value !== 'running') return
  for (let offset = 0; offset < pending.length; offset += TERMINAL_INPUT_CHUNK_MAX) {
    void client
      .sendInput(terminalId, pending.slice(offset, offset + TERMINAL_INPUT_CHUNK_MAX))
      .catch((error) => console.warn('[TerminalPanel] input failed:', error))
  }
}

function queueInput(data: string) {
  inputBuffer += data
  if (inputTimer) return
  inputTimer = setTimeout(flushInput, 8)
}

function scheduleFit() {
  if (fitFrame !== null) return
  fitFrame = requestAnimationFrame(() => {
    fitFrame = null
    fitView?.()
  })
}

async function ensureView(): Promise<TerminalView | null> {
  if (view) return view
  await nextTick()
  const generation = attachGeneration
  const created = await createView()
  if (!created || disposed || generation !== attachGeneration || !terminalHost.value) {
    created?.dispose()
    return null
  }
  view = created
  created.open(terminalHost.value)
  created.textarea?.setAttribute('aria-label', terminalLabel.value)
  created.attachCustomKeyEventHandler((event) => {
    // Let the app-level toggle shortcut reach the menu instead of the shell.
    if (event.key === '`' && (event.metaKey || event.ctrlKey) && !event.altKey) return true
    return false
  })
  const dataSubscription = created.onData(queueInput)
  const resizeSubscription = created.onResize(({ cols, rows }) => {
    const terminalId = snapshot.value?.terminalId
    if (!terminalId || state.value !== 'running') return
    void client.resize(terminalId, cols, rows).catch(() => {})
  })
  viewDisposers.push(
    () => dataSubscription.dispose(),
    () => resizeSubscription.dispose()
  )
  fitView?.()
  resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(terminalHost.value)
  return created
}

function applySnapshot(next: TerminalSnapshot) {
  snapshot.value = next
  view?.reset()
  view?.write(next.replay)
  renderedOutputEnd = next.outputEnd
  if (next.status === 'running') {
    state.value = 'running'
    exitCode.value = null
  } else {
    state.value = 'exited'
    exitCode.value = next.exitCode ?? null
  }
}

async function open(mode: 'attach' | 'restart') {
  const generation = ++attachGeneration
  errorMessage.value = null
  if (state.value !== 'running') state.value = 'connecting'
  try {
    const terminal = await ensureView()
    if (!terminal || generation !== attachGeneration) return
    const size = fitView?.() ?? { cols: terminal.cols, rows: terminal.rows }
    const input = {
      sessionId: props.sessionId,
      cols: size.cols,
      rows: size.rows,
      // Main honors this only for an unsent draft owned by this window.
      ...(props.workspacePath ? { draftWorkdir: props.workspacePath } : {})
    }
    const next = mode === 'restart' ? await client.restart(input) : await client.attach(input)
    if (disposed || generation !== attachGeneration) return
    applySnapshot(next)
    terminal.focus()
  } catch (error) {
    if (disposed || generation !== attachGeneration) return
    state.value = mapError(error)
    if (state.value !== 'error') disposeView()
  }
}

function restartTerminal() {
  void open('restart')
}

function killTerminal() {
  const terminalId = snapshot.value?.terminalId
  if (!terminalId) return
  void client.kill(terminalId).catch((error) => mapError(error))
}

async function selectFolder() {
  try {
    const selectedPath = await projectClient.selectDirectory()
    if (selectedPath) emit('update:workspacePath', selectedPath)
  } catch (error) {
    console.error('Failed to select folder:', error)
  }
}

const stopOutput = client.onOutput((payload) => {
  if (payload.terminalId !== snapshot.value?.terminalId || !view) return
  const end = payload.offset + payload.data.length
  if (end <= renderedOutputEnd) return
  // Skip the part already delivered through the attach replay.
  const start = Math.max(0, renderedOutputEnd - payload.offset)
  view.write(start > 0 ? payload.data.slice(start) : payload.data)
  renderedOutputEnd = end
})

const stopExit = client.onExit((payload) => {
  if (payload.terminalId !== snapshot.value?.terminalId) return
  flushInput()
  state.value = 'exited'
  exitCode.value = payload.exitCode
})

watch(
  () => sidepanelStore.terminalFocusToken,
  () => {
    if (state.value === 'running') view?.focus()
  }
)

watch(
  () => props.sessionId,
  () => {
    disposeView()
    snapshot.value = null
    renderedOutputEnd = 0
    state.value = 'idle'
    void open('attach')
  }
)

watch(
  () => props.workspacePath,
  (path, previous) => {
    // A working directory chosen from the empty state starts the shell immediately.
    if (path && !previous && (state.value === 'no-workdir' || state.value === 'workdir-missing')) {
      void open('attach')
    }
  }
)

watch([accessibilityEnabled, () => themeStore.isDark], () => {
  if (!view) return
  // Renderer choice and ghostty-web theme are fixed at creation; rebuild and replay.
  disposeView()
  void open('attach')
})

onMounted(() => {
  void open('attach')
})

onBeforeUnmount(() => {
  disposed = true
  attachGeneration += 1
  stopOutput()
  stopExit()
  disposeView()
})
</script>

<style scoped>
.terminal-host :deep(canvas) {
  display: block;
}
</style>
