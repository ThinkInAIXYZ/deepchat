<template>
  <ScrollArea class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
      <div v-if="isLoading" class="text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="!settings || !status" class="text-sm text-muted-foreground">
        {{ t('common.error.requestFailed') }}
      </div>
      <template v-else>
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <div class="text-base font-medium">{{ t('settings.remote.title') }}</div>
            <span v-if="isSaving" class="text-xs text-muted-foreground">
              {{ t('common.saving') }}
            </span>
          </div>
          <div class="text-sm text-muted-foreground">
            {{ t('settings.remote.description') }}
          </div>
        </div>

        <div class="overflow-hidden rounded-lg border">
          <div class="space-y-4 p-4">
            <div class="space-y-2">
              <div class="text-base font-medium">{{ t('settings.remote.telegram.title') }}</div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.remote.telegram.description') }}
              </p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs text-muted-foreground">
                {{ t('settings.remote.telegram.botToken') }}
              </Label>
              <div class="relative w-full">
                <Input
                  v-model="settings.botToken"
                  :type="showBotToken ? 'text' : 'password'"
                  :placeholder="t('settings.remote.telegram.botTokenPlaceholder')"
                  class="pr-10"
                  @blur="persistSettings"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  class="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                  @click="showBotToken = !showBotToken"
                >
                  <Icon
                    :icon="showBotToken ? 'lucide:eye-off' : 'lucide:eye'"
                    class="h-4 w-4 text-muted-foreground"
                  />
                </Button>
              </div>
            </div>

            <div class="rounded-md border bg-muted/30 p-3 text-sm">
              <div class="font-medium">{{ t('settings.remote.status.title') }}</div>
              <div class="mt-1 text-muted-foreground">
                {{ formatStatusLine(status) }}
              </div>
              <div v-if="status.botUser" class="mt-1 text-muted-foreground">
                {{
                  t('settings.remote.status.botUser', {
                    id: status.botUser.id,
                    username: status.botUser.username || 'unknown'
                  })
                }}
              </div>
              <div class="mt-1 text-muted-foreground">
                {{
                  t('settings.remote.status.bindings', {
                    count: status.bindingCount,
                    pollOffset: status.pollOffset
                  })
                }}
              </div>
              <div v-if="status.lastError" class="mt-2 break-all text-destructive">
                {{ status.lastError }}
              </div>
            </div>
          </div>

          <div class="border-t p-4">
            <div class="mb-3 flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="text-sm font-medium">
                  {{ t('settings.remote.remoteControl.title') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.remote.remoteControl.description') }}
                </p>
              </div>
              <Switch
                :model-value="settings.remoteEnabled"
                @update:model-value="(value) => updateRemoteEnabled(value)"
              />
            </div>

            <div
              v-if="settings.remoteEnabled"
              data-testid="remote-control-details"
              class="space-y-4"
            >
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.remoteControl.allowedUserIds') }}
                  </Label>
                  <Input
                    data-testid="remote-allowed-user-ids-input"
                    v-model="allowedUserIdsText"
                    :placeholder="t('settings.remote.remoteControl.allowedUserIdsPlaceholder')"
                    @blur="persistSettings"
                  />
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.remoteControl.defaultAgent') }}
                  </Label>
                  <Select
                    :model-value="settings.defaultAgentId"
                    @update:model-value="(value) => updateDefaultAgentId(String(value))"
                  >
                    <SelectTrigger data-testid="remote-default-agent-select" class="h-8!">
                      <SelectValue
                        :placeholder="t('settings.remote.remoteControl.defaultAgentPlaceholder')"
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="agent in defaultAgentOptions"
                        :key="agent.id"
                        :value="agent.id"
                      >
                        {{ agent.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  data-testid="remote-pair-button"
                  variant="outline"
                  size="sm"
                  @click="generatePairCodeAndOpenDialog"
                >
                  {{ t('settings.remote.remoteControl.openPairDialog') }}
                </Button>
                <Button
                  data-testid="remote-bindings-button"
                  variant="outline"
                  size="sm"
                  @click="openBindingsDialog"
                >
                  {{ t('settings.remote.remoteControl.manageBindings') }}
                </Button>
              </div>
            </div>
          </div>

          <div class="border-t p-4">
            <div class="mb-3 flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="text-sm font-medium">
                  {{ t('settings.remote.hooks.title') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.remote.hooks.description') }}
                </p>
              </div>
              <Switch
                :model-value="settings.hookNotifications.enabled"
                @update:model-value="(value) => updateHookEnabled(value)"
              />
            </div>

            <div
              v-if="settings.hookNotifications.enabled"
              data-testid="remote-hooks-details"
              class="space-y-4"
            >
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.hooks.chatId') }}
                  </Label>
                  <Input
                    v-model="settings.hookNotifications.chatId"
                    :placeholder="t('settings.remote.hooks.chatIdPlaceholder')"
                    @blur="persistSettings"
                  />
                </div>
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.hooks.threadId') }}
                  </Label>
                  <Input
                    v-model="settings.hookNotifications.threadId"
                    :placeholder="t('settings.remote.hooks.threadIdPlaceholder')"
                    @blur="persistSettings"
                  />
                </div>
              </div>

              <div class="space-y-2">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.notificationsHooks.events.title') }}
                </Label>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label
                    v-for="eventName in eventNames"
                    :key="`remote-hook-${eventName}`"
                    class="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      :checked="settings.hookNotifications.events.includes(eventName)"
                      @update:checked="(value) => updateHookEvent(eventName, value === true)"
                    />
                    <span>{{ eventLabel(eventName) }}</span>
                  </label>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="telegramTesting"
                  @click="runTelegramHookTest"
                >
                  <Icon
                    :icon="telegramTesting ? 'lucide:loader-2' : 'lucide:send'"
                    :class="['mr-1 h-4 w-4', telegramTesting && 'animate-spin']"
                  />
                  {{
                    telegramTesting
                      ? t('settings.notificationsHooks.test.testing')
                      : t('settings.notificationsHooks.test.button')
                  }}
                </Button>
              </div>

              <div v-if="telegramTestResult" class="space-y-1 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    :class="telegramTestResult.success ? 'text-emerald-600' : 'text-destructive'"
                  >
                    {{
                      telegramTestResult.success
                        ? t('settings.notificationsHooks.test.success')
                        : t('settings.notificationsHooks.test.failed')
                    }}
                  </span>
                  <span class="text-muted-foreground">
                    {{
                      t('settings.notificationsHooks.test.duration', {
                        ms: telegramTestResult.durationMs
                      })
                    }}
                  </span>
                  <span
                    v-if="telegramTestResult.statusCode !== undefined"
                    class="text-muted-foreground"
                  >
                    {{
                      t('settings.notificationsHooks.test.statusCode', {
                        code: telegramTestResult.statusCode
                      })
                    }}
                  </span>
                  <span v-if="telegramTestResult.retryAfterMs" class="text-muted-foreground">
                    {{
                      t('settings.notificationsHooks.test.retryAfter', {
                        ms: telegramTestResult.retryAfterMs
                      })
                    }}
                  </span>
                </div>
                <div v-if="telegramTestResult.error" class="break-all text-destructive">
                  {{ telegramTestResult.error }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </ScrollArea>

  <Dialog v-model:open="pairDialogVisible">
    <DialogContent class="sm:max-w-md">
      <div data-testid="remote-pair-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>{{ t('settings.remote.remoteControl.pairDialogTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.remote.remoteControl.pairDialogDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <div class="text-xs text-muted-foreground">
              {{ t('settings.remote.remoteControl.pairCode') }}
            </div>
            <div class="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-lg tracking-[0.2em]">
              {{ pairDialogCode || t('settings.remote.remoteControl.noPairCode') }}
            </div>
            <div v-if="pairDialogExpiresAt" class="text-xs text-muted-foreground">
              {{
                t('settings.remote.remoteControl.pairCodeExpiresAt', {
                  time: formatTimestamp(pairDialogExpiresAt)
                })
              }}
            </div>
          </div>

          <div class="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
            <div class="text-muted-foreground">
              {{ t('settings.remote.remoteControl.pairDialogInstruction') }}
            </div>
            <div class="mt-2 rounded-md bg-background px-3 py-2 font-mono text-sm">
              /pair {{ pairDialogCode || '------' }}
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" @click="cancelPairDialog">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="bindingsDialogOpen">
    <DialogContent class="sm:max-w-lg">
      <div data-testid="remote-bindings-dialog" class="space-y-6">
        <DialogHeader>
          <DialogTitle>{{ t('settings.remote.remoteControl.bindingsDialogTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('settings.remote.remoteControl.bindingsDialogDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div v-if="bindingsLoading" class="text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="bindings.length === 0"
            data-testid="remote-bindings-empty"
            class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
          >
            {{ t('settings.remote.remoteControl.bindingsEmpty') }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="binding in bindings"
              :key="binding.endpointKey"
              :data-testid="`remote-binding-${binding.endpointKey}`"
              class="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ binding.sessionId }}</div>
                <div class="mt-1 text-xs text-muted-foreground">
                  telegram:{{ binding.chatId }}:{{ binding.messageThreadId }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                :disabled="bindingRemovingKey === binding.endpointKey"
                @click="removeBinding(binding.endpointKey)"
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <Button variant="outline" @click="bindingsDialogOpen = false">
            {{ t('common.close') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import type { Agent } from '@shared/types/agent-interface'
import type { HookEventName, HookTestResult } from '@shared/hooksNotifications'
import { HOOK_EVENT_NAMES } from '@shared/hooksNotifications'
import type {
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus
} from '@shared/presenter'

const remoteControlPresenter = usePresenter('remoteControlPresenter')
const newAgentPresenter = usePresenter('newAgentPresenter')
const { t } = useI18n()
const { toast } = useToast()

const settings = ref<TelegramRemoteSettings | null>(null)
const status = ref<TelegramRemoteStatus | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const showBotToken = ref(false)
const telegramTesting = ref(false)
const telegramTestResult = ref<HookTestResult | null>(null)
const allowedUserIdsText = ref('')
const availableDeepChatAgents = ref<Agent[]>([])
const pairDialogOpen = ref(false)
const pairDialogCode = ref<string | null>(null)
const pairDialogExpiresAt = ref<number | null>(null)
const pairDialogExpectedCode = ref<string | null>(null)
const pairDialogInitialAllowedUserIds = ref<number[]>([])
const pairDialogCancelling = ref(false)
const bindingsDialogOpen = ref(false)
const bindingsLoading = ref(false)
const bindingRemovingKey = ref<string | null>(null)
const bindings = ref<TelegramRemoteBindingSummary[]>([])
let statusRefreshTimer: ReturnType<typeof setInterval> | null = null
let pairDialogRefreshTimer: ReturnType<typeof setInterval> | null = null
let pendingSave = false

const eventNames = HOOK_EVENT_NAMES

const defaultAgentOptions = computed(() => {
  const options = availableDeepChatAgents.value
    .filter((agent) => agent.type === 'deepchat' && agent.enabled)
    .map((agent) => ({
      id: agent.id,
      name: agent.name
    }))

  if (
    settings.value?.defaultAgentId &&
    !options.some((agent) => agent.id === settings.value?.defaultAgentId)
  ) {
    options.unshift({
      id: settings.value.defaultAgentId,
      name: settings.value.defaultAgentId
    })
  }

  return options
})

const pairDialogVisible = computed({
  get: () => pairDialogOpen.value,
  set: (open: boolean) => {
    if (open) {
      pairDialogOpen.value = true
      return
    }

    void cancelPairDialog()
  }
})

const parseAllowedUserIds = (value: string): number[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((left, right) => left - right)

const syncAllowedUserIds = (allowedUserIds: number[]) => {
  if (settings.value) {
    settings.value.allowedUserIds = [...allowedUserIds]
  }
  allowedUserIdsText.value = allowedUserIds.join(', ')
}

const syncLocalFields = (snapshot: TelegramRemoteSettings) => {
  settings.value = {
    ...snapshot,
    hookNotifications: {
      ...snapshot.hookNotifications,
      threadId: snapshot.hookNotifications.threadId ?? ''
    }
  }
  syncAllowedUserIds(snapshot.allowedUserIds)
}

const refreshStatus = async () => {
  status.value = await remoteControlPresenter.getTelegramStatus()
}

const refreshPairingSnapshot = async (): Promise<TelegramPairingSnapshot> => {
  const snapshot = await remoteControlPresenter.getTelegramPairingSnapshot()
  pairDialogCode.value = snapshot.pairCode
  pairDialogExpiresAt.value = snapshot.pairCodeExpiresAt
  return snapshot
}

const refreshAllowedUserIdsOnly = async () => {
  const snapshot = await remoteControlPresenter.getTelegramPairingSnapshot()
  syncAllowedUserIds(snapshot.allowedUserIds)
}

const loadDeepChatAgents = async () => {
  const agents = await newAgentPresenter.getAgents()
  availableDeepChatAgents.value = agents.filter(
    (agent) => agent.type === 'deepchat' && agent.enabled !== false
  )
}

const loadState = async () => {
  isLoading.value = true
  try {
    const [loadedSettings, loadedStatus] = await Promise.all([
      remoteControlPresenter.getTelegramSettings(),
      remoteControlPresenter.getTelegramStatus(),
      loadDeepChatAgents()
    ])
    syncLocalFields(loadedSettings)
    status.value = loadedStatus
  } catch (error) {
    console.error('Failed to load remote settings:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isLoading.value = false
  }
}

const buildDraftSettings = (): TelegramRemoteSettings | null => {
  if (!settings.value) {
    return null
  }

  return {
    ...settings.value,
    allowedUserIds: parseAllowedUserIds(allowedUserIdsText.value)
  }
}

const persistSettings = async () => {
  const nextSettings = buildDraftSettings()
  if (!nextSettings) {
    return
  }

  if (isSaving.value) {
    pendingSave = true
    return
  }

  isSaving.value = true
  try {
    const saved = await remoteControlPresenter.saveTelegramSettings(nextSettings)
    syncLocalFields(saved)
    await Promise.all([refreshStatus(), loadDeepChatAgents()])
  } catch (error) {
    console.error('Failed to save remote settings:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
    if (pendingSave) {
      pendingSave = false
      void persistSettings()
    }
  }
}

const updateRemoteEnabled = (value: boolean) => {
  if (!settings.value) {
    return
  }
  settings.value.remoteEnabled = Boolean(value)
  void persistSettings()
}

const updateDefaultAgentId = (value: string) => {
  if (!settings.value) {
    return
  }
  settings.value.defaultAgentId = value
  void persistSettings()
}

const updateHookEnabled = (value: boolean) => {
  if (!settings.value) {
    return
  }
  settings.value.hookNotifications.enabled = Boolean(value)
  void persistSettings()
}

const updateHookEvent = (eventName: HookEventName, checked: boolean) => {
  if (!settings.value) {
    return
  }
  const events = new Set(settings.value.hookNotifications.events)
  if (checked) {
    events.add(eventName)
  } else {
    events.delete(eventName)
  }
  settings.value.hookNotifications.events = Array.from(events)
  void persistSettings()
}

const stopPairDialogPolling = () => {
  if (pairDialogRefreshTimer) {
    clearInterval(pairDialogRefreshTimer)
    pairDialogRefreshTimer = null
  }
}

const closePairDialogState = () => {
  stopPairDialogPolling()
  pairDialogOpen.value = false
  pairDialogCode.value = null
  pairDialogExpiresAt.value = null
  pairDialogExpectedCode.value = null
  pairDialogInitialAllowedUserIds.value = []
}

const pollPairingSnapshot = async () => {
  if (!pairDialogOpen.value || !pairDialogExpectedCode.value) {
    return
  }

  try {
    const snapshot = await refreshPairingSnapshot()
    const allowedUserIdsChanged =
      snapshot.allowedUserIds.join(',') !== pairDialogInitialAllowedUserIds.value.join(',')
    const pairCodeConsumed =
      snapshot.pairCode !== pairDialogExpectedCode.value && !snapshot.pairCode?.trim()

    if (!pairCodeConsumed) {
      return
    }

    syncAllowedUserIds(snapshot.allowedUserIds)
    await refreshStatus()

    if (!pairDialogCancelling.value && allowedUserIdsChanged) {
      toast({
        title: t('settings.remote.remoteControl.pairingSuccessTitle'),
        description: t('settings.remote.remoteControl.pairingSuccessDescription')
      })
    }

    closePairDialogState()
  } catch (error) {
    console.warn('[RemoteSettings] Failed to poll pairing snapshot:', error)
  }
}

const startPairDialogPolling = () => {
  stopPairDialogPolling()
  pairDialogRefreshTimer = setInterval(() => {
    void pollPairingSnapshot()
  }, 2_000)
}

const generatePairCodeAndOpenDialog = async () => {
  await persistSettings()

  try {
    const pairCode = await remoteControlPresenter.createTelegramPairCode()
    const snapshot = await refreshPairingSnapshot()
    pairDialogExpectedCode.value = pairCode.code
    pairDialogInitialAllowedUserIds.value = [...snapshot.allowedUserIds]
    pairDialogCode.value = pairCode.code
    pairDialogExpiresAt.value = pairCode.expiresAt
    pairDialogCancelling.value = false
    pairDialogOpen.value = true
    startPairDialogPolling()
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const cancelPairDialog = async () => {
  if (!pairDialogOpen.value && !pairDialogCode.value && !pairDialogExpectedCode.value) {
    return
  }

  stopPairDialogPolling()
  pairDialogOpen.value = false
  pairDialogCancelling.value = true
  try {
    await remoteControlPresenter.clearTelegramPairCode()
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    pairDialogCancelling.value = false
    closePairDialogState()
  }
}

const loadBindings = async () => {
  bindingsLoading.value = true
  try {
    bindings.value = await remoteControlPresenter.getTelegramBindings()
  } finally {
    bindingsLoading.value = false
  }
}

const openBindingsDialog = async () => {
  await persistSettings()
  bindingsDialogOpen.value = true
  try {
    await loadBindings()
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const removeBinding = async (endpointKey: string) => {
  bindingRemovingKey.value = endpointKey
  try {
    await remoteControlPresenter.removeTelegramBinding(endpointKey)
    await Promise.all([loadBindings(), refreshStatus(), refreshAllowedUserIdsOnly()])
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    bindingRemovingKey.value = null
  }
}

const runTelegramHookTest = async () => {
  if (telegramTesting.value) {
    return
  }

  await persistSettings()
  telegramTesting.value = true
  telegramTestResult.value = null
  try {
    telegramTestResult.value = await remoteControlPresenter.testTelegramHookNotification()
  } catch (error) {
    telegramTestResult.value = {
      success: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    telegramTesting.value = false
  }
}

const eventLabel = (eventName: HookEventName) =>
  t(`settings.notificationsHooks.events.${eventName}`)

const formatTimestamp = (value: number) => new Date(value).toLocaleString()

const formatStatusLine = (value: TelegramRemoteStatus) =>
  t(`settings.remote.status.states.${value.state}`)

onMounted(() => {
  void loadState()
  statusRefreshTimer = setInterval(() => {
    void refreshStatus()
  }, 2_000)
})

onUnmounted(() => {
  if (statusRefreshTimer) {
    clearInterval(statusRefreshTimer)
    statusRefreshTimer = null
  }
  stopPairDialogPolling()
})
</script>
