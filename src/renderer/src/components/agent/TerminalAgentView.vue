<template>
  <div class="w-full h-full flex flex-col">
    <div class="p-3 border-b flex items-center gap-3">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:terminal" class="w-4 h-4" />
        <span class="text-sm">Claude Code Terminal</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button size="sm" variant="outline" @click="restart">
          {{ t('common.restart') || 'Restart' }}
        </Button>
      </div>
    </div>
    <div ref="termEl" class="flex-1"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  agentId: string
  config: { id: string; name: string; config: { workingDir?: string; extraArgs?: string } }
}
const props = defineProps<Props>()

const { t } = useI18n()
const terminalPresenter = usePresenter('terminalPresenter')
const threadPresenter = usePresenter('threadPresenter')

const termEl = ref<HTMLDivElement>()
let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
let conversationId: string | null = null

const start = async () => {
  if (!termEl.value) return
  if (!term) {
    term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      scrollback: 1000,
      allowTransparency: false,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4'
      }
    })

    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termEl.value)

    // 初始适配
    setTimeout(() => {
      fitAddon?.fit()
    }, 100)

    // 确保终端正确适配容器大小
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon) {
        setTimeout(() => {
          fitAddon?.fit()
        }, 10)
      }
    })
    resizeObserver.observe(termEl.value)

    term.onData(async (data) => {
      if (sessionId) await terminalPresenter.write(sessionId, data)
    })
  }

  // 确保有会话
  if (!conversationId) {
    conversationId = await threadPresenter.createConversation(
      props.config?.name || 'Claude CLI',
      {
        providerId: 'agent:claude-cli',
        modelId: 'claude-cli'
      },
      0,
      { forceNewAndActivate: true }
    )
  }

  sessionId = await terminalPresenter.startSession(conversationId!, {
    workingDir: props.config.config?.workingDir || '',
    extraArgs: props.config.config?.extraArgs
  })
}

const restart = async () => {
  if (sessionId) await terminalPresenter.stop(sessionId)
  sessionId = null
  await start()
}

onMounted(async () => {
  await start()

  window.electron.ipcRenderer.on('terminal:output', (_e, msg) => {
    if (msg?.sessionId === sessionId && term) {
      term.write(msg.data)
    }
  })
})

onBeforeUnmount(async () => {
  if (sessionId) await terminalPresenter.stop(sessionId)
  term?.dispose()
  term = null
  window.electron.ipcRenderer.removeAllListeners('terminal:output')
})
</script>

<style scoped>
.xterm {
  width: 100%;
  height: 100%;
}
</style>
