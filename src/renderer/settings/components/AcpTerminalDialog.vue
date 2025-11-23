<template>
  <Dialog :open="open" @update:open="handleOpenUpdate">
    <DialogContent
      class="sm:max-w-5xl h-[85vh] flex flex-col gap-0 p-2 overflow-hidden"
      @pointer-down-outside.prevent
      @escape-key-down.prevent
    >
      <DialogHeader>
        <DialogTitle>{{ t('settings.acp.terminal.title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <div
          class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs"
          :class="statusBadgeClass"
        >
          <div class="w-1.5 h-1.5 rounded-full" :class="statusColor"></div>
          {{ statusText }}
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :disabled="!isRunning"
          @click="handlePaste"
          :title="t('settings.acp.terminal.paste')"
        >
          <Icon icon="lucide:clipboard" class="h-4 w-4" />
        </Button>
      </div>

      <div class="flex-1 relative w-full h-full bg-black p-0 overflow-hidden">
        <div ref="terminalContainer" class="terminal-surface"></div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useToast } from '@/components/use-toast'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
  (e: 'dependencies-required', dependencies: ExternalDependency[]): void
}>()

const { t } = useI18n()
const { toast } = useToast()

const terminalContainer = ref<HTMLElement | null>(null)
let terminal: Terminal | null = null

const isRunning = ref(false)
const status = ref<'idle' | 'running' | 'completed' | 'error'>('idle')

interface ExternalDependency {
  name: string
  description: string
  platform?: string[]
  checkCommand?: string
  checkPaths?: string[]
  installCommands?: {
    winget?: string
    chocolatey?: string
    scoop?: string
  }
  downloadUrl?: string
  requiredFor?: string[]
}

const statusColor = computed(() => {
  switch (status.value) {
    case 'running':
      return 'bg-yellow-500 animate-pulse'
    case 'completed':
      return 'bg-green-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-zinc-500'
  }
})

const statusText = computed(() => {
  switch (status.value) {
    case 'running':
      return t('settings.acp.terminal.status.running')
    case 'completed':
      return t('settings.acp.terminal.status.completed')
    case 'error':
      return t('settings.acp.terminal.status.error')
    default:
      return t('settings.acp.terminal.status.idle')
  }
})

const statusBadgeClass = computed(() => {
  return 'bg-muted text-muted-foreground'
})

const handleOpenUpdate = (val: boolean) => {
  if (!val) {
    // Kill process if running
    if (isRunning.value) {
      if (window.electron) {
        window.electron.ipcRenderer.send('acp-terminal:kill')
      }
    }
    emit('update:open', false)
    emit('close')
  } else {
    emit('update:open', val)
  }
}

const ensureTerminal = () => {
  if (!terminalContainer.value) {
    console.warn('[AcpTerminal] Terminal container not available')
    return
  }

  if (!terminal) {
    console.log('[AcpTerminal] Initializing terminal...')
    terminal = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff'
      },
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 5000
    })

    terminal.open(terminalContainer.value)
    console.log('[AcpTerminal] Terminal opened successfully')

    // Handle user input
    terminal.onData((data) => {
      // Send input to backend process
      // Don't echo locally - let the backend process handle all output
      // This avoids xterm.js parsing errors with control characters
      if (window.electron) {
        window.electron.ipcRenderer.send('acp-terminal:input', data)
      }
    })
  }
}

const cleanupTerminal = () => {
  console.log('[AcpTerminal] Cleaning up terminal...')
  if (terminal) {
    terminal.dispose()
    terminal = null
  }
  console.log('[AcpTerminal] Terminal cleaned up')
}

const handleOutput = (_event: unknown, data: string | { type: string; data: string }) => {
  if (!terminal) {
    console.warn('[AcpTerminal] Received output but terminal is not initialized')
    return
  }

  // Handle both legacy object format and new string format
  let text: string
  if (typeof data === 'string') {
    text = data
  } else if (data && typeof data === 'object' && 'data' in data) {
    text = data.data
  } else {
    console.warn('[AcpTerminal] Unknown output data format:', data)
    return
  }

  if (!text || text.length === 0) {
    return
  }

  console.log('[AcpTerminal] Writing output to terminal:', {
    length: text.length,
    preview: text.substring(0, 50).replace(/\n/g, '\\n'),
    type: typeof data === 'object' ? data.type : 'string'
  })

  try {
    // Convert \n to \r\n for proper terminal display
    const normalizedText = text.replace(/\r?\n/g, '\r\n')
    terminal.write(normalizedText)
  } catch (error) {
    // Handle xterm.js parsing errors gracefully
    // These can occur with malformed ANSI escape sequences
    if (error instanceof Error) {
      // Log parsing errors at debug level, but don't break the flow
      if (error.message.includes('Parsing error') || error.message.includes('code: 127')) {
        console.debug('[AcpTerminal] xterm.js parsing error (non-fatal):', error.message)
        // Try to write the text character by character as a fallback
        // This helps with problematic escape sequences
        try {
          const normalizedText = text.replace(/\r?\n/g, '\r\n')
          for (let i = 0; i < normalizedText.length; i++) {
            terminal.write(normalizedText[i])
          }
        } catch (fallbackError) {
          console.warn('[AcpTerminal] Fallback write also failed, skipping output')
        }
      } else {
        console.error('[AcpTerminal] Error writing to terminal:', error)
      }
    } else {
      console.error('[AcpTerminal] Unknown error writing to terminal:', error)
    }
  }
}

const handleStart = (_event: unknown) => {
  isRunning.value = true
  status.value = 'running'
  if (terminal) {
    terminal.clear()
  }
}

const handleExit = (_event: unknown, data: { code: number | null; signal: string | null }) => {
  isRunning.value = false
  if (data.code === 0) {
    status.value = 'completed'
  } else {
    status.value = 'error'
  }
  // Don't print exit message to terminal to keep it clean like a real shell
  // unless it's an error
  if (terminal && data.code !== 0) {
    terminal.writeln(`\r\n\x1b[31mProcess exited with code ${data.code}\x1b[0m`)
  }
}

const handleError = (_event: unknown, data: { message: string }) => {
  status.value = 'error'
  if (terminal) {
    terminal.writeln(`\r\n\x1b[31mError: ${data.message}\x1b[0m`)
  }
}

const handlePaste = async () => {
  try {
    if (!window.api || typeof window.api.readClipboardText !== 'function') {
      console.warn('[AcpTerminal] readClipboardText API not available')
      return
    }

    const text = window.api.readClipboardText()
    if (text && window.electron) {
      window.electron.ipcRenderer.send('acp-terminal:input', text)
      console.log('[AcpTerminal] Pasted text to terminal:', text.length, 'characters')
    }
  } catch (error) {
    console.error('[AcpTerminal] Failed to paste from clipboard:', error)
    toast({
      title: t('settings.acp.terminal.pasteError'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const handleExternalDepsRequired = (
  _event: unknown,
  data: { agentId: string; missingDeps: ExternalDependency[] }
) => {
  console.log('[AcpTerminal] External dependencies required:', data)

  if (!data.missingDeps || data.missingDeps.length === 0) {
    return
  }

  // Emit event to parent to show dependency dialog
  emit('dependencies-required', data.missingDeps)

  // Close terminal dialog since initialization is blocked
  emit('update:open', false)
  emit('close')
}

const setupIpcListeners = () => {
  if (typeof window === 'undefined' || !window.electron) {
    console.warn('[AcpTerminal] Cannot setup IPC listeners - window.electron not available')
    return
  }

  console.log('[AcpTerminal] Setting up IPC listeners')
  window.electron.ipcRenderer.on('acp-init:start', handleStart)
  window.electron.ipcRenderer.on('acp-init:output', handleOutput)
  window.electron.ipcRenderer.on('acp-init:exit', handleExit)
  window.electron.ipcRenderer.on('acp-init:error', handleError)
  window.electron.ipcRenderer.on('external-deps-required', handleExternalDepsRequired)
  console.log('[AcpTerminal] IPC listeners set up successfully')
}

const removeIpcListeners = () => {
  if (typeof window === 'undefined' || !window.electron) {
    return
  }

  window.electron.ipcRenderer.removeAllListeners('acp-init:start')
  window.electron.ipcRenderer.removeAllListeners('acp-init:output')
  window.electron.ipcRenderer.removeAllListeners('acp-init:exit')
  window.electron.ipcRenderer.removeAllListeners('acp-init:error')
  window.electron.ipcRenderer.removeAllListeners('external-deps-required')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      // Wait for dialog animation to complete before initializing
      await nextTick()
      // Give dialog time to render and container to get dimensions
      setTimeout(() => {
        try {
          console.log('[AcpTerminal] Starting terminal initialization sequence')
          // Initialize terminal first
          ensureTerminal()
          console.log('[AcpTerminal] Terminal initialized, setting up IPC listeners')
          // Then set up listeners
          setupIpcListeners()
          status.value = 'idle'
          isRunning.value = false
          console.log('[AcpTerminal] Terminal ready for output')
        } catch (error) {
          console.error('[AcpTerminal] Failed to initialize terminal:', error)
          status.value = 'error'
        }
      }, 150)
    } else {
      console.log('[AcpTerminal] Dialog closing, cleaning up')
      removeIpcListeners()
      cleanupTerminal()
    }
  }
)

onMounted(async () => {
  if (props.open) {
    // Wait for dialog animation to complete before initializing
    await nextTick()
    setTimeout(() => {
      try {
        console.log('[AcpTerminal] onMounted: Starting terminal initialization')
        ensureTerminal()
        setupIpcListeners()
        console.log('[AcpTerminal] onMounted: Terminal initialization complete')
      } catch (error) {
        console.error('[AcpTerminal] onMounted: Failed to initialize terminal:', error)
      }
    }, 150)
  }
})

onBeforeUnmount(() => {
  removeIpcListeners()
  cleanupTerminal()
})
</script>

<style scoped>
.terminal-surface {
  height: 100%;
  width: 100%;
}

/* Xterm.js styles */
:deep(.xterm) {
  height: 100% !important;
  width: 100% !important;
  padding: 20px 24px;
  box-sizing: border-box;
}

:deep(.xterm .xterm-viewport) {
  overflow-y: auto !important;
  scrollbar-width: thin;
  background-color: #000000;
}

:deep(.xterm .xterm-screen) {
  padding: 0 !important;
  background-color: #000000;
}

:deep(.xterm .xterm-helpers) {
  top: 20px !important;
}

/* Custom scrollbar for terminal */
:deep(.xterm-viewport::-webkit-scrollbar) {
  height: 6px;
  width: 6px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: rgba(148, 163, 184, 0.3);
  border-radius: 9999px;
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}
</style>
