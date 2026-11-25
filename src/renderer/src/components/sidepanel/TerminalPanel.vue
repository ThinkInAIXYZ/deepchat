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
      <div class="flex justify-center gap-2">
        <DcButton variant="outline" size="sm" class="h-7 text-xs" @click="selectFolder">
          <Icon icon="lucide:folder-open" class="mr-1.5 h-3.5 w-3.5" />
          {{ t('chat.workspace.files.noWorkspace.button') }}
        </DcButton>
        <DcButton
          v-if="state === 'workdir-missing'"
          variant="ghost"
          size="sm"
          class="h-7 text-xs"
          data-testid="terminal-retry"
          @click="retryAttach"
        >
          {{ t('chat.terminal.restart') }}
        </DcButton>
      </div>
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
import { until } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { createProjectClient } from '@api/ProjectClient'
import { createTerminalClient } from '@api/TerminalClient'
import type { DeepchatRouteOutput } from '@shared/contracts/routes'
import { TERMINAL_INPUT_CHUNK_MAX } from '@shared/contracts/routes'
import { useAccessibilitySupport } from '@/composables/useAccessibilitySupport'
import { useShortcutKeyStore } from '@/stores/shortcutKey'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useThemeStore } from '@/stores/theme'
import { matchesAccelerator } from './terminalShortcut'

type TerminalSnapshot = DeepchatRouteOutput<'terminal.attach'>
type OutputEvent = { terminalId: string; offset: number; data: string }
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
}

const props = defineProps<{
  sessionId: string
  workspacePath: string | null
  /** The side panel is open on this tab. Terminals are only created or attached while active. */
  active: boolean
}>()
const emit = defineEmits<{ 'update:workspacePath': [path: string | null] }>()

const { t } = useI18n()
const client = createTerminalClient()
const projectClient = createProjectClient()
const sidepanelStore = useSidepanelStore()
const themeStore = useThemeStore()
const shortcutKeyStore = useShortcutKeyStore()
const { accessibilityEnabled, accessibilityReady } = useAccessibilitySupport()

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
/** Output that arrived while an attach was in flight, before its snapshot was applied. */
let attachInFlight = false
let earlyOutput: OutputEvent[] = []
let earlyOutputLength = 0
const EARLY_OUTPUT_LIMIT = 1024 * 1024
let ghosttyReady: Promise<void> | null = null
let disposed = false

const DARK_THEME = {
  background: '#111318',
  foreground: '#e5e7eb',
  cursor: '#e5e7eb',
  selectionBackground: '#3b4252'
}
// Light backgrounds need a palette whose white/yellow entries stay readable.
const LIGHT_THEME = {
  background: '#fbfbfc',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#cfd8e3',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
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
  } else if (message.includes('[terminal:forbidden]')) {
    errorMessage.value = t('chat.terminal.status.otherWindow')
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

const isToggleShortcut = (event: KeyboardEvent) =>
  matchesAccelerator(event, shortcutKeyStore.shortcutKeys?.ToggleTerminal)

/** False while the host is collapsed (closing animation, hidden tab). */
function hostHasSize(): boolean {
  const host = terminalHost.value
  return Boolean(host && host.clientWidth > 0 && host.clientHeight > 0)
}

async function createView(): Promise<{ terminal: TerminalView; addon: { fit(): void } }> {
  const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  if (accessibilityEnabled.value) {
    // ghostty-web renders to canvas without an accessible buffer; xterm keeps screen readers working.
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css')
    ])
    const terminal = new Terminal({
      screenReaderMode: true,
      cursorBlink: true,
      fontFamily,
      fontSize: 13,
      scrollback: 5_000,
      theme: terminalTheme.value
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    return { terminal: terminal as unknown as TerminalView, addon: fit }
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
  return { terminal: terminal as unknown as TerminalView, addon: fit }
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

async function ensureView(generation: number): Promise<TerminalView | null> {
  if (view) return view
  await nextTick()
  if (disposed || generation !== attachGeneration || !terminalHost.value) return null
  const { terminal: created, addon } = await createView()
  if (disposed || generation !== attachGeneration || !terminalHost.value) {
    created.dispose()
    return null
  }
  view = created
  fitView = () => {
    // The xterm fit addon clamps a collapsed host to 2x1.
    if (!hostHasSize()) return undefined
    addon.fit()
    return { cols: created.cols, rows: created.rows }
  }
  const host = terminalHost.value
  // Keep the toggle shortcut away from the terminal so the shell never sees it. This runs before
  // either backend's own handler (their custom key handlers use opposite return semantics) and
  // does not cancel the event, so the native menu accelerator still fires.
  const stopToggleShortcut = (event: KeyboardEvent) => {
    if (isToggleShortcut(event)) event.stopImmediatePropagation()
  }
  host.addEventListener('keydown', stopToggleShortcut, true)
  viewDisposers.push(() => host.removeEventListener('keydown', stopToggleShortcut, true))
  created.open(host)
  created.textarea?.setAttribute('aria-label', terminalLabel.value)
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
  resizeObserver.observe(host)
  return created
}

// ghostty-web 0.4 throws on empty writes: its WASM allocator returns an out-of-range pointer
// for zero-length buffers.
function writeView(data: string) {
  if (data) view?.write(data)
}

function writeOutput(payload: OutputEvent) {
  const end = payload.offset + payload.data.length
  if (end <= renderedOutputEnd) return
  // Skip the part already delivered through the attach replay.
  const start = Math.max(0, renderedOutputEnd - payload.offset)
  writeView(start > 0 ? payload.data.slice(start) : payload.data)
  renderedOutputEnd = end
}

function clearEarlyOutput() {
  earlyOutput = []
  earlyOutputLength = 0
}

function applySnapshot(next: TerminalSnapshot) {
  snapshot.value = next
  view?.reset()
  writeView(next.replay)
  renderedOutputEnd = next.outputEnd
  const buffered = earlyOutput
  clearEarlyOutput()
  for (const payload of buffered) {
    if (payload.terminalId === next.terminalId) writeOutput(payload)
  }
  if (next.status === 'running') {
    state.value = 'running'
    exitCode.value = null
  } else {
    state.value = 'exited'
    exitCode.value = next.exitCode ?? null
  }
}

async function open(mode: 'attach' | 'restart') {
  if (!props.active) return
  const generation = ++attachGeneration
  errorMessage.value = null
  if (state.value !== 'running') state.value = 'connecting'
  // Snapshot-era events are now replaced by the coming snapshot; collect fresh ones from here.
  snapshot.value = null
  clearEarlyOutput()
  attachInFlight = true
  try {
    // The renderer choice depends on the native accessibility status; wait for it once.
    if (!accessibilityReady.value) await until(accessibilityReady).toBe(true)
    if (disposed || generation !== attachGeneration) return
    const terminal = await ensureView(generation)
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
    attachInFlight = false
    applySnapshot(next)
    terminal.focus()
  } catch (error) {
    if (disposed || generation !== attachGeneration) return
    attachInFlight = false
    clearEarlyOutput()
    state.value = mapError(error)
    if (state.value !== 'error') disposeView()
  }
}

/** Detach the view (the PTY keeps running) and drop any in-flight attach. */
function detach() {
  attachGeneration += 1
  attachInFlight = false
  disposeView()
  snapshot.value = null
  clearEarlyOutput()
  renderedOutputEnd = 0
  state.value = 'idle'
}

function retryAttach() {
  void open('attach')
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
  if (!snapshot.value) {
    // An attach is in flight: keep events until its snapshot says which terminal and offset apply.
    if (!attachInFlight) return
    earlyOutput.push(payload)
    earlyOutputLength += payload.data.length
    while (earlyOutputLength > EARLY_OUTPUT_LIMIT && earlyOutput.length > 1) {
      earlyOutputLength -= earlyOutput.shift()!.data.length
    }
    return
  }
  if (payload.terminalId !== snapshot.value.terminalId || !view) return
  writeOutput(payload)
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
    detach()
    void open('attach')
  }
)

watch(
  () => props.active,
  (active) => {
    if (active) void open('attach')
    else detach()
  }
)

watch(
  () => props.workspacePath,
  (path, previous) => {
    // A working directory chosen from the empty state starts the shell immediately.
    if (
      path &&
      path !== previous &&
      (state.value === 'no-workdir' || state.value === 'workdir-missing')
    ) {
      void open('attach')
    }
  }
)

watch([accessibilityEnabled, () => themeStore.isDark], () => {
  if (state.value === 'idle' || state.value === 'no-workdir' || state.value === 'workdir-missing')
    return
  // Renderer choice and ghostty-web theme are fixed at creation; rebuild and replay. This also
  // supersedes an attach still creating its view.
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
.terminal-host {
  /* Ghostty makes the host editable for IME and draws its own cursor on the canvas. */
  caret-color: transparent;
}

.terminal-host :deep(canvas) {
  display: block;
}
</style>
