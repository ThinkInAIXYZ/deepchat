<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent hide-close class="sm:max-w-[760px]">
      <DialogHeader>
        <DialogTitle>
          {{ t('settings.acp.auth.title', { name: challenge?.agentName ?? '' }) }}
        </DialogTitle>
        <DialogDescription>{{ t('settings.acp.auth.description') }}</DialogDescription>
      </DialogHeader>

      <div v-if="challenge" class="space-y-4">
        <RadioGroup v-model="selectedMethodId" class="space-y-2" :disabled="authPending">
          <label
            v-for="method in challenge.methods"
            :key="method.id"
            class="flex items-start gap-3 rounded-lg border px-3 py-3"
            :class="method.type === 'unsupported' ? 'opacity-60' : 'cursor-pointer'"
          >
            <RadioGroupItem
              :id="`acp-auth-${method.id}`"
              :value="method.id"
              :disabled="method.type === 'unsupported'"
              class="mt-0.5"
            />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ method.name }}</span>
              <span v-if="method.description" class="block text-xs text-muted-foreground mt-1">
                {{ method.description }}
              </span>
              <span
                v-if="method.type === 'unsupported'"
                class="block text-xs text-muted-foreground mt-1"
              >
                {{ t('settings.acp.auth.unsupported') }}
              </span>
            </span>
          </label>
        </RadioGroup>

        <div
          v-if="!challenge.methods.length"
          class="rounded-lg border px-3 py-3 text-sm text-muted-foreground"
        >
          {{ t('settings.acp.auth.noMethods') }}
        </div>

        <div v-show="runId" class="overflow-hidden rounded-lg border bg-[#111318]">
          <div ref="terminalHost" class="h-[320px] p-2" />
        </div>

        <div class="flex items-center justify-between gap-3 text-xs">
          <span :class="statusClass">{{ statusLabel }}</span>
          <span v-if="error" class="text-destructive text-right">{{ error }}</span>
        </div>
      </div>

      <DialogFooter>
        <DcButton v-if="authPending && runId" variant="outline" @click="cancelAuthentication">
          {{ t('settings.acp.auth.cancelSignIn') }}
        </DcButton>
        <DcButton v-else variant="outline" @click="handleOpenChange(false)">
          {{ t('common.close') }}
        </DcButton>
        <DcButton
          v-if="!authPending && state !== 'succeeded'"
          :disabled="!selectedMethod || selectedMethod.type === 'unsupported'"
          @click="startAuthentication"
        >
          {{ startLabel }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { AcpAuthChallenge, AcpAuthRunState } from '@shared/types/acp'
import { createAcpAuthClient } from '@api/AcpAuthClient'
import { DcButton } from '@dc-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'

const props = defineProps<{
  open: boolean
  challenge: AcpAuthChallenge | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  succeeded: []
}>()

const { t } = useI18n()
const client = createAcpAuthClient()
const selectedMethodId = ref('')
const state = ref<AcpAuthRunState>('required')
const runId = ref<string | null>(null)
const error = ref<string | null>(null)
const terminalHost = ref<HTMLElement | null>(null)
let terminal: XtermTerminal | null = null
let terminalInput = ''
let terminalInputTimer: ReturnType<typeof setTimeout> | null = null
let emittedSuccess = false
let authenticationAttempt = 0
let latestStateVersion = 0

const selectedMethod = computed(() =>
  props.challenge?.methods.find((method) => method.id === selectedMethodId.value)
)
const authPending = computed(() => state.value === 'running' || state.value === 'reconnecting')
const startLabel = computed(() =>
  selectedMethod.value?.type === 'terminal'
    ? t('settings.acp.auth.openTerminal')
    : t('settings.mcp.authenticate')
)
const statusLabel = computed(() => t(`settings.acp.auth.status.${state.value}`))
const statusClass = computed(() =>
  state.value === 'failed'
    ? 'text-destructive'
    : state.value === 'succeeded'
      ? 'text-emerald-600'
      : 'text-muted-foreground'
)

function resetDialog() {
  invalidateAuthenticationAttempt()
  state.value = 'required'
  runId.value = null
  error.value = null
  emittedSuccess = false
  latestStateVersion = 0
  const supported = props.challenge?.methods.filter((method) => method.type !== 'unsupported') ?? []
  selectedMethodId.value = supported.length === 1 ? supported[0].id : ''
  terminal?.dispose()
  terminal = null
}

async function ensureTerminal() {
  await nextTick()
  if (terminal || !terminalHost.value) return
  const { Terminal } = await import('@xterm/xterm')
  terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    theme: { background: '#111318', foreground: '#e5e7eb' }
  })
  terminal.open(terminalHost.value)
  terminal.onData((data) => {
    if (!runId.value) return
    terminalInput += data
    if (terminalInputTimer) return
    terminalInputTimer = setTimeout(() => {
      terminalInputTimer = null
      const pending = terminalInput
      terminalInput = ''
      if (!runId.value || !pending) return
      for (let offset = 0; offset < pending.length; offset += 16_384) {
        void client.sendInput(runId.value, pending.slice(offset, offset + 16_384))
      }
    }, 8)
  })
}

async function startAuthentication() {
  if (!props.challenge || !selectedMethod.value) return
  const attempt = ++authenticationAttempt
  const stateVersionAtStart = latestStateVersion
  error.value = null
  state.value = 'running'
  try {
    const result = await client.start(props.challenge.id, selectedMethod.value.id)
    if (attempt !== authenticationAttempt || !props.open) {
      if (result.runId) cancelRun(result.runId)
      return
    }
    if (result.version <= latestStateVersion) return
    latestStateVersion = result.version
    state.value = result.state
    runId.value = result.runId ?? null
    error.value = result.error ?? null
    if (runId.value) await ensureTerminal()
    notifySucceeded()
  } catch (caught) {
    if (attempt !== authenticationAttempt || latestStateVersion !== stateVersionAtStart) return
    state.value = 'failed'
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function cancelAuthentication() {
  if (!runId.value) return
  await client.cancel(runId.value)
}

function handleOpenChange(open: boolean) {
  if (!open) invalidateAuthenticationAttempt()
  emit('update:open', open)
}

function invalidateAuthenticationAttempt() {
  authenticationAttempt += 1
  const activeRunId = authPending.value ? runId.value : null
  runId.value = null
  clearTerminalInput()
  if (activeRunId) cancelRun(activeRunId)
}

function clearTerminalInput() {
  if (terminalInputTimer) clearTimeout(terminalInputTimer)
  terminalInputTimer = null
  terminalInput = ''
}

function cancelRun(activeRunId: string) {
  void client.cancel(activeRunId).catch(() => {})
}

function notifySucceeded() {
  if (state.value !== 'succeeded' || emittedSuccess) return
  emittedSuccess = true
  emit('succeeded')
}

const stopOutput = client.onOutput((payload) => {
  if (!props.open) return
  if (payload.challengeId !== props.challenge?.id) return
  if (runId.value && payload.runId !== runId.value) return
  runId.value ??= payload.runId
  void ensureTerminal().then(() => terminal?.write(payload.data))
})
const stopState = client.onStateChanged((payload) => {
  if (!props.open) return
  if (payload.challengeId !== props.challenge?.id) return
  if (runId.value && payload.runId && payload.runId !== runId.value) return
  if (payload.version <= latestStateVersion) return
  latestStateVersion = payload.version
  runId.value = payload.runId ?? runId.value
  state.value = payload.state
  error.value = payload.error ?? null
  if (runId.value) void ensureTerminal()
  notifySucceeded()
})

watch(
  () => [props.open, props.challenge?.id] as const,
  ([open]) => {
    if (open) resetDialog()
  }
)

onBeforeUnmount(() => {
  invalidateAuthenticationAttempt()
  stopOutput()
  stopState()
  terminal?.dispose()
})
</script>
