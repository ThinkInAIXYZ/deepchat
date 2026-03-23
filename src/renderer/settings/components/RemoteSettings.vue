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

            <div class="space-y-4">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.remoteControl.streamMode') }}
                  </Label>
                  <Select v-model="settings.streamMode" @update:model-value="persistSettings">
                    <SelectTrigger class="h-8!">
                      <SelectValue :placeholder="t('settings.remote.remoteControl.streamMode')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">
                        {{ t('settings.remote.remoteControl.streamModeDraft') }}
                      </SelectItem>
                      <SelectItem value="final">
                        {{ t('settings.remote.remoteControl.streamModeFinal') }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">
                    {{ t('settings.remote.remoteControl.allowedUserIds') }}
                  </Label>
                  <Input
                    v-model="allowedUserIdsText"
                    :placeholder="t('settings.remote.remoteControl.allowedUserIdsPlaceholder')"
                    @blur="persistSettings"
                  />
                </div>
              </div>

              <div class="space-y-2">
                <Label class="text-xs text-muted-foreground">
                  {{ t('settings.remote.remoteControl.pairCode') }}
                </Label>
                <div class="flex flex-wrap items-center gap-2">
                  <Input :model-value="pairCodeDisplay" readonly class="max-w-xs" />
                  <Button variant="outline" size="sm" @click="generatePairCode">
                    {{ t('settings.remote.remoteControl.generatePairCode') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!settings.pairCode"
                    @click="clearPairCode"
                  >
                    {{ t('settings.remote.remoteControl.clearPairCode') }}
                  </Button>
                </div>
                <div v-if="settings.pairCodeExpiresAt" class="text-xs text-muted-foreground">
                  {{
                    t('settings.remote.remoteControl.pairCodeExpiresAt', {
                      time: formatTimestamp(settings.pairCodeExpiresAt)
                    })
                  }}
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" @click="clearBindings">
                  {{ t('settings.remote.remoteControl.clearBindings') }}
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

            <div class="space-y-4">
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import type { HookEventName, HookTestResult } from '@shared/hooksNotifications'
import { HOOK_EVENT_NAMES } from '@shared/hooksNotifications'
import type { TelegramRemoteSettings, TelegramRemoteStatus } from '@shared/presenter'

const remoteControlPresenter = usePresenter('remoteControlPresenter')
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
let statusRefreshTimer: ReturnType<typeof setInterval> | null = null
let pendingSave = false

const eventNames = HOOK_EVENT_NAMES

const pairCodeDisplay = computed(
  () => settings.value?.pairCode || t('settings.remote.remoteControl.noPairCode')
)

const parseAllowedUserIds = (value: string): number[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((left, right) => left - right)

const syncLocalFields = (snapshot: TelegramRemoteSettings) => {
  settings.value = {
    ...snapshot,
    hookNotifications: {
      ...snapshot.hookNotifications,
      threadId: snapshot.hookNotifications.threadId ?? ''
    }
  }
  allowedUserIdsText.value = snapshot.allowedUserIds.join(', ')
}

const refreshStatus = async () => {
  status.value = await remoteControlPresenter.getTelegramStatus()
}

const loadState = async () => {
  isLoading.value = true
  try {
    const [loadedSettings, loadedStatus] = await Promise.all([
      remoteControlPresenter.getTelegramSettings(),
      remoteControlPresenter.getTelegramStatus()
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
    await refreshStatus()
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

const generatePairCode = async () => {
  await persistSettings()
  try {
    const pairCode = await remoteControlPresenter.createTelegramPairCode()
    if (!settings.value) {
      return
    }
    settings.value.pairCode = pairCode.code
    settings.value.pairCodeExpiresAt = pairCode.expiresAt
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const clearPairCode = async () => {
  try {
    await remoteControlPresenter.clearTelegramPairCode()
    if (settings.value) {
      settings.value.pairCode = null
      settings.value.pairCodeExpiresAt = null
    }
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const clearBindings = async () => {
  try {
    const clearedCount = await remoteControlPresenter.clearTelegramBindings()
    await refreshStatus()
    toast({
      title: t('settings.remote.remoteControl.clearBindings'),
      description: t('settings.remote.remoteControl.clearBindingsResult', {
        count: clearedCount
      })
    })
  } catch (error) {
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
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
})
</script>
