<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-4 p-4">
      <div v-if="isLoading" class="text-sm text-muted-foreground">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="!config" class="text-sm text-muted-foreground">
        {{ t('common.error.requestFailed') }}
      </div>
      <template v-else>
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <div class="text-base font-medium">{{ t('settings.notificationsHooks.title') }}</div>
            <span v-if="isSaving" class="text-xs text-muted-foreground">
              {{ t('common.saving') }}
            </span>
          </div>
          <div class="text-sm text-muted-foreground">
            {{ t('settings.notificationsHooks.description') }}
          </div>
        </div>

        <div class="border rounded-lg overflow-hidden">
          <div class="flex items-start justify-between gap-4 p-4">
            <div class="flex-1">
              <div class="text-base font-medium">
                {{ t('settings.notificationsHooks.telegram.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.notificationsHooks.telegram.description') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Switch
                :model-value="config.telegram.enabled"
                @update:model-value="(value) => updateChannelEnabled('telegram', value)"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="telegramOpen = !telegramOpen"
              >
                <Icon
                  :icon="telegramOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="w-4 h-4"
                />
              </Button>
            </div>
          </div>
          <Collapsible v-model:open="telegramOpen">
            <CollapsibleContent>
              <div class="border-t p-4 space-y-4">
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">{{
                    t('settings.notificationsHooks.telegram.botToken')
                  }}</Label>
                  <div class="relative w-full">
                    <Input
                      v-model="config.telegram.botToken"
                      :type="showTelegramToken ? 'text' : 'password'"
                      :placeholder="t('settings.notificationsHooks.telegram.botTokenPlaceholder')"
                      class="pr-10"
                      @blur="persistConfig"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      @click="showTelegramToken = !showTelegramToken"
                    >
                      <Icon
                        :icon="showTelegramToken ? 'lucide:eye-off' : 'lucide:eye'"
                        class="w-4 h-4 text-muted-foreground"
                      />
                    </Button>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">{{
                      t('settings.notificationsHooks.telegram.chatId')
                    }}</Label>
                    <Input
                      v-model="config.telegram.chatId"
                      :placeholder="t('settings.notificationsHooks.telegram.chatIdPlaceholder')"
                      @blur="persistConfig"
                    />
                  </div>
                  <div class="space-y-2">
                    <Label class="text-xs text-muted-foreground">{{
                      t('settings.notificationsHooks.telegram.threadId')
                    }}</Label>
                    <Input
                      v-model="config.telegram.threadId"
                      :placeholder="t('settings.notificationsHooks.telegram.threadIdPlaceholder')"
                      @blur="persistConfig"
                    />
                  </div>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">{{
                    t('settings.notificationsHooks.events.title')
                  }}</Label>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      v-for="eventName in eventNames"
                      :key="`telegram-${eventName}`"
                      class="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        :checked="config.telegram.events.includes(eventName)"
                        @update:checked="
                          (value) => updateChannelEvent('telegram', eventName, value === true)
                        "
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
                    @click="runTelegramTest"
                  >
                    <Icon
                      :icon="telegramTesting ? 'lucide:loader-2' : 'lucide:send'"
                      :class="['w-4 h-4 mr-1', telegramTesting && 'animate-spin']"
                    />
                    {{
                      telegramTesting
                        ? t('settings.notificationsHooks.test.testing')
                        : t('settings.notificationsHooks.test.button')
                    }}
                  </Button>
                </div>

                <div v-if="telegramTestResult" class="text-xs space-y-1">
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
                  <div v-if="telegramTestResult.error" class="text-destructive break-all">
                    {{ telegramTestResult.error }}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div class="border rounded-lg overflow-hidden">
          <div class="flex items-start justify-between gap-4 p-4">
            <div class="flex-1">
              <div class="text-base font-medium">
                {{ t('settings.notificationsHooks.discord.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.notificationsHooks.discord.description') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Switch
                :model-value="config.discord.enabled"
                @update:model-value="(value) => updateChannelEnabled('discord', value)"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="discordOpen = !discordOpen"
              >
                <Icon
                  :icon="discordOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="w-4 h-4"
                />
              </Button>
            </div>
          </div>
          <Collapsible v-model:open="discordOpen">
            <CollapsibleContent>
              <div class="border-t p-4 space-y-4">
                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">{{
                    t('settings.notificationsHooks.discord.webhookUrl')
                  }}</Label>
                  <div class="relative w-full">
                    <Input
                      v-model="config.discord.webhookUrl"
                      :type="showDiscordWebhook ? 'text' : 'password'"
                      :placeholder="t('settings.notificationsHooks.discord.webhookUrlPlaceholder')"
                      class="pr-10"
                      @blur="persistConfig"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      @click="showDiscordWebhook = !showDiscordWebhook"
                    >
                      <Icon
                        :icon="showDiscordWebhook ? 'lucide:eye-off' : 'lucide:eye'"
                        class="w-4 h-4 text-muted-foreground"
                      />
                    </Button>
                  </div>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs text-muted-foreground">{{
                    t('settings.notificationsHooks.events.title')
                  }}</Label>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      v-for="eventName in eventNames"
                      :key="`discord-${eventName}`"
                      class="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        :checked="config.discord.events.includes(eventName)"
                        @update:checked="
                          (value) => updateChannelEvent('discord', eventName, value === true)
                        "
                      />
                      <span>{{ eventLabel(eventName) }}</span>
                    </label>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="discordTesting"
                    @click="runDiscordTest"
                  >
                    <Icon
                      :icon="discordTesting ? 'lucide:loader-2' : 'lucide:send'"
                      :class="['w-4 h-4 mr-1', discordTesting && 'animate-spin']"
                    />
                    {{
                      discordTesting
                        ? t('settings.notificationsHooks.test.testing')
                        : t('settings.notificationsHooks.test.button')
                    }}
                  </Button>
                </div>

                <div v-if="discordTestResult" class="text-xs space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      :class="discordTestResult.success ? 'text-emerald-600' : 'text-destructive'"
                    >
                      {{
                        discordTestResult.success
                          ? t('settings.notificationsHooks.test.success')
                          : t('settings.notificationsHooks.test.failed')
                      }}
                    </span>
                    <span class="text-muted-foreground">
                      {{
                        t('settings.notificationsHooks.test.duration', {
                          ms: discordTestResult.durationMs
                        })
                      }}
                    </span>
                    <span
                      v-if="discordTestResult.statusCode !== undefined"
                      class="text-muted-foreground"
                    >
                      {{
                        t('settings.notificationsHooks.test.statusCode', {
                          code: discordTestResult.statusCode
                        })
                      }}
                    </span>
                    <span v-if="discordTestResult.retryAfterMs" class="text-muted-foreground">
                      {{
                        t('settings.notificationsHooks.test.retryAfter', {
                          ms: discordTestResult.retryAfterMs
                        })
                      }}
                    </span>
                  </div>
                  <div v-if="discordTestResult.error" class="text-destructive break-all">
                    {{ discordTestResult.error }}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div
          :class="[
            'border rounded-lg overflow-hidden',
            !confirmoAvailable && 'opacity-60 cursor-not-allowed'
          ]"
        >
          <div class="flex items-start justify-between gap-4 p-4">
            <div class="flex-1">
              <div class="text-base font-medium">
                {{ t('settings.notificationsHooks.confirmo.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{
                  confirmoAvailable
                    ? t('settings.notificationsHooks.confirmo.description')
                    : t('settings.notificationsHooks.confirmo.unavailable', {
                        path: confirmoStatus?.path || ''
                      })
                }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Switch
                :model-value="config.confirmo.enabled"
                :disabled="!confirmoAvailable"
                @update:model-value="(value) => updateChannelEnabled('confirmo', value)"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :disabled="!confirmoAvailable"
                @click="confirmoOpen = !confirmoOpen"
              >
                <Icon
                  :icon="confirmoOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="w-4 h-4"
                />
              </Button>
            </div>
          </div>
          <Collapsible v-model:open="confirmoOpen">
            <CollapsibleContent>
              <div class="border-t p-4 space-y-4">
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="confirmoTesting || !confirmoAvailable"
                    @click="runConfirmoTest"
                  >
                    <Icon
                      :icon="confirmoTesting ? 'lucide:loader-2' : 'lucide:send'"
                      :class="['w-4 h-4 mr-1', confirmoTesting && 'animate-spin']"
                    />
                    {{
                      confirmoTesting
                        ? t('settings.notificationsHooks.test.testing')
                        : t('settings.notificationsHooks.test.button')
                    }}
                  </Button>
                </div>

                <div v-if="confirmoTestResult" class="text-xs space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      :class="confirmoTestResult.success ? 'text-emerald-600' : 'text-destructive'"
                    >
                      {{
                        confirmoTestResult.success
                          ? t('settings.notificationsHooks.test.success')
                          : t('settings.notificationsHooks.test.failed')
                      }}
                    </span>
                    <span class="text-muted-foreground">
                      {{
                        t('settings.notificationsHooks.test.duration', {
                          ms: confirmoTestResult.durationMs
                        })
                      }}
                    </span>
                    <span
                      v-if="confirmoTestResult.exitCode !== undefined"
                      class="text-muted-foreground"
                    >
                      {{
                        t('settings.notificationsHooks.test.exitCode', {
                          code: confirmoTestResult.exitCode
                        })
                      }}
                    </span>
                  </div>
                  <div v-if="confirmoTestResult.error" class="text-destructive break-all">
                    {{ confirmoTestResult.error }}
                  </div>
                  <div v-if="confirmoTestResult.stdout" class="text-muted-foreground break-all">
                    <span class="font-medium">{{
                      t('settings.notificationsHooks.test.stdout')
                    }}</span
                    >: {{ formatPreview(confirmoTestResult.stdout) }}
                  </div>
                  <div v-if="confirmoTestResult.stderr" class="text-muted-foreground break-all">
                    <span class="font-medium">{{
                      t('settings.notificationsHooks.test.stderr')
                    }}</span
                    >: {{ formatPreview(confirmoTestResult.stderr) }}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div class="border rounded-lg overflow-hidden">
          <div class="flex items-start justify-between gap-4 p-4">
            <div class="flex-1">
              <div class="text-base font-medium">
                {{ t('settings.notificationsHooks.commands.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.notificationsHooks.commands.description') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Switch
                :model-value="config.commands.enabled"
                @update:model-value="(value) => updateCommandsEnabled(value)"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="commandsOpen = !commandsOpen"
              >
                <Icon
                  :icon="commandsOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="w-4 h-4"
                />
              </Button>
            </div>
          </div>
          <Collapsible v-model:open="commandsOpen">
            <CollapsibleContent>
              <div class="border-t p-4 space-y-4">
                <div class="text-xs text-muted-foreground">
                  {{ t('settings.notificationsHooks.commands.hint') }}
                </div>

                <div class="space-y-3">
                  <div
                    v-for="eventName in eventNames"
                    :key="`command-${eventName}`"
                    class="border rounded-md p-3 space-y-2"
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <div class="min-w-[160px]">
                        <div class="text-sm font-medium">{{ eventLabel(eventName) }}</div>
                        <div class="text-xs text-muted-foreground">{{ eventName }}</div>
                      </div>
                      <Switch
                        :model-value="config.commands.events[eventName].enabled"
                        @update:model-value="(value) => updateCommandEnabled(eventName, value)"
                      />
                      <div class="flex-1 min-w-[220px]">
                        <Input
                          v-model="config.commands.events[eventName].command"
                          :placeholder="
                            t('settings.notificationsHooks.commands.commandPlaceholder')
                          "
                          @blur="persistConfig"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        :disabled="
                          commandTesting[eventName] ||
                          !config.commands.events[eventName].command.trim()
                        "
                        @click="runCommandTest(eventName)"
                      >
                        <Icon
                          :icon="commandTesting[eventName] ? 'lucide:loader-2' : 'lucide:play'"
                          :class="['w-4 h-4 mr-1', commandTesting[eventName] && 'animate-spin']"
                        />
                        {{
                          commandTesting[eventName]
                            ? t('settings.notificationsHooks.test.testing')
                            : t('settings.notificationsHooks.test.button')
                        }}
                      </Button>
                    </div>

                    <div v-if="commandTestResults[eventName]" class="text-xs space-y-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          :class="
                            commandTestResults[eventName]?.success
                              ? 'text-emerald-600'
                              : 'text-destructive'
                          "
                        >
                          {{
                            commandTestResults[eventName]?.success
                              ? t('settings.notificationsHooks.test.success')
                              : t('settings.notificationsHooks.test.failed')
                          }}
                        </span>
                        <span class="text-muted-foreground">
                          {{
                            t('settings.notificationsHooks.test.duration', {
                              ms: commandTestResults[eventName]?.durationMs || 0
                            })
                          }}
                        </span>
                        <span
                          v-if="commandTestResults[eventName]?.exitCode !== undefined"
                          class="text-muted-foreground"
                        >
                          {{
                            t('settings.notificationsHooks.test.exitCode', {
                              code: commandTestResults[eventName]?.exitCode
                            })
                          }}
                        </span>
                      </div>
                      <div
                        v-if="commandTestResults[eventName]?.error"
                        class="text-destructive break-all"
                      >
                        {{ commandTestResults[eventName]?.error }}
                      </div>
                      <div
                        v-if="commandTestResults[eventName]?.stdout"
                        class="text-muted-foreground break-all"
                      >
                        <span class="font-medium">{{
                          t('settings.notificationsHooks.test.stdout')
                        }}</span
                        >: {{ formatPreview(commandTestResults[eventName]?.stdout) }}
                      </div>
                      <div
                        v-if="commandTestResults[eventName]?.stderr"
                        class="text-muted-foreground break-all"
                      >
                        <span class="font-medium">{{
                          t('settings.notificationsHooks.test.stderr')
                        }}</span
                        >: {{ formatPreview(commandTestResults[eventName]?.stderr) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Collapsible, CollapsibleContent } from '@shadcn/components/ui/collapsible'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import type {
  HookEventName,
  HookTestResult,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'
import { HOOK_EVENT_NAMES } from '@shared/hooksNotifications'

const { t } = useI18n()
const { toast } = useToast()
const configPresenter = usePresenter('configPresenter')

const config = ref<HooksNotificationsSettings | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
let pendingSave = false

const telegramOpen = ref(false)
const discordOpen = ref(false)
const confirmoOpen = ref(false)
const commandsOpen = ref(false)

const showTelegramToken = ref(false)
const showDiscordWebhook = ref(false)

const telegramTesting = ref(false)
const discordTesting = ref(false)
const confirmoTesting = ref(false)
const telegramTestResult = ref<HookTestResult | null>(null)
const discordTestResult = ref<HookTestResult | null>(null)
const confirmoTestResult = ref<HookTestResult | null>(null)
const confirmoStatus = ref<{ available: boolean; path: string } | null>(null)
const confirmoAvailable = computed(() => confirmoStatus.value?.available ?? false)

const eventNames = HOOK_EVENT_NAMES

const buildEventRecord = <T,>(value: T) =>
  Object.fromEntries(eventNames.map((name) => [name, value])) as Record<HookEventName, T>

const commandTesting = ref<Record<HookEventName, boolean>>(buildEventRecord(false))
const commandTestResults = ref<Record<HookEventName, HookTestResult | null>>(buildEventRecord(null))

const loadConfig = async () => {
  isLoading.value = true
  try {
    const [loadedConfig, status] = await Promise.all([
      configPresenter.getHooksNotificationsConfig(),
      Promise.resolve()
        .then(() => configPresenter.getConfirmoHookStatus())
        .catch((error) => {
          console.warn('Failed to load confirmo status:', error)
          return null
        })
    ])
    config.value = loadedConfig
    confirmoStatus.value = status ?? { available: false, path: '' }
  } catch (error) {
    console.error('Failed to load hooks config:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isLoading.value = false
  }
}

const persistConfig = async () => {
  if (!config.value) return
  if (isSaving.value) {
    pendingSave = true
    return
  }
  isSaving.value = true
  try {
    const updated = await configPresenter.setHooksNotificationsConfig(config.value)
    if (updated) {
      config.value = updated
    }
  } catch (error) {
    console.error('Failed to save hooks config:', error)
    toast({
      title: t('common.error.operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    isSaving.value = false
    if (pendingSave) {
      pendingSave = false
      void persistConfig()
    }
  }
}

const updateChannelEnabled = (channel: 'telegram' | 'discord' | 'confirmo', value: boolean) => {
  if (!config.value) return
  if (channel === 'confirmo' && !confirmoAvailable.value) return
  const nextEnabled = Boolean(value)
  const wasEnabled = config.value[channel].enabled
  config.value[channel].enabled = nextEnabled
  if (!wasEnabled && nextEnabled) {
    if (channel === 'telegram') {
      telegramOpen.value = true
    } else if (channel === 'discord') {
      discordOpen.value = true
    } else if (channel === 'confirmo') {
      confirmoOpen.value = true
    }
  }
  persistConfig()
}

const updateCommandsEnabled = (value: boolean) => {
  if (!config.value) return
  const nextEnabled = Boolean(value)
  const wasEnabled = config.value.commands.enabled
  config.value.commands.enabled = nextEnabled
  if (!wasEnabled && nextEnabled) {
    commandsOpen.value = true
  }
  persistConfig()
}

const updateChannelEvent = (
  channel: 'telegram' | 'discord' | 'confirmo',
  eventName: HookEventName,
  checked: boolean
) => {
  if (!config.value) return
  if (channel === 'confirmo' && !confirmoAvailable.value) return
  const events = new Set(config.value[channel].events)
  if (checked) {
    events.add(eventName)
  } else {
    events.delete(eventName)
  }
  config.value[channel].events = Array.from(events)
  persistConfig()
}

const updateCommandEnabled = (eventName: HookEventName, value: boolean) => {
  if (!config.value) return
  config.value.commands.events[eventName].enabled = Boolean(value)
  persistConfig()
}

const runTelegramTest = async () => {
  if (telegramTesting.value) return
  await persistConfig()
  telegramTesting.value = true
  telegramTestResult.value = null
  try {
    const result = await configPresenter.testTelegramNotification()
    telegramTestResult.value = result
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

const runDiscordTest = async () => {
  if (discordTesting.value) return
  await persistConfig()
  discordTesting.value = true
  discordTestResult.value = null
  try {
    const result = await configPresenter.testDiscordNotification()
    discordTestResult.value = result
  } catch (error) {
    discordTestResult.value = {
      success: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    discordTesting.value = false
  }
}

const runConfirmoTest = async () => {
  if (confirmoTesting.value || !confirmoAvailable.value) return
  await persistConfig()
  confirmoTesting.value = true
  confirmoTestResult.value = null
  try {
    const result = await configPresenter.testConfirmoNotification()
    confirmoTestResult.value = result
  } catch (error) {
    confirmoTestResult.value = {
      success: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    confirmoTesting.value = false
  }
}

const runCommandTest = async (eventName: HookEventName) => {
  if (commandTesting.value[eventName]) return
  await persistConfig()
  commandTesting.value[eventName] = true
  commandTestResults.value[eventName] = null
  try {
    const result = await configPresenter.testHookCommand(eventName)
    commandTestResults.value[eventName] = result
  } catch (error) {
    commandTestResults.value[eventName] = {
      success: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    commandTesting.value[eventName] = false
  }
}

const eventLabel = (eventName: HookEventName) =>
  t(`settings.notificationsHooks.events.${eventName}`)

const PREVIEW_LIMIT = 200
const formatPreview = (value?: string) => {
  if (!value) return ''
  if (value.length <= PREVIEW_LIMIT) return value
  return `${value.slice(0, PREVIEW_LIMIT)}…`
}

onMounted(() => {
  loadConfig()
})
</script>
