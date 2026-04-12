<template>
  <ScrollArea class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
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

        <div class="rounded-lg border p-4">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1">
                <div class="text-base font-medium">
                  {{ t('settings.notificationsHooks.commands.title') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.notificationsHooks.commands.description') }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.notificationsHooks.commands.hint') }}
                </p>
              </div>

              <Button
                data-testid="notifications-hooks-add"
                variant="outline"
                size="sm"
                @click="addHook"
              >
                <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
                {{ t('settings.notificationsHooks.commands.newHook') }}
              </Button>
            </div>

            <Collapsible v-model:open="guideOpen" class="rounded-md border bg-muted/20">
              <CollapsibleTrigger as-child>
                <Button variant="ghost" class="flex h-auto w-full items-center justify-between p-4">
                  <div class="min-w-0 text-left">
                    <div class="text-sm font-medium">
                      {{ t('settings.notificationsHooks.commands.guideTitle') }}
                    </div>
                    <p class="mt-1 text-xs text-muted-foreground">
                      {{ t('settings.notificationsHooks.commands.guideDescription') }}
                    </p>
                  </div>
                  <Icon
                    :icon="guideOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                    class="ml-3 h-4 w-4 shrink-0 text-muted-foreground"
                  />
                </Button>
              </CollapsibleTrigger>

              <CollapsibleContent class="border-t px-4 pb-4">
                <div class="space-y-4 pt-4">
                  <div class="grid gap-4 lg:grid-cols-2">
                    <div class="space-y-2">
                      <div class="text-xs font-medium text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.deliveryTitle') }}
                      </div>
                      <ul class="space-y-1 text-xs text-muted-foreground">
                        <li>{{ t('settings.notificationsHooks.commands.deliveryStdin') }}</li>
                        <li>{{ t('settings.notificationsHooks.commands.deliveryPlaceholder') }}</li>
                        <li>{{ t('settings.notificationsHooks.commands.deliveryEnv') }}</li>
                        <li>{{ t('settings.notificationsHooks.commands.metadataOnly') }}</li>
                      </ul>

                      <div class="rounded-md border bg-background p-3">
                        <div class="mb-2 text-[11px] font-medium text-muted-foreground">
                          {{ t('settings.notificationsHooks.commands.stdinPreviewLabel') }}
                        </div>
                        <pre
                          class="overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-5"
                          >{{ stdinPreview }}</pre
                        >
                      </div>
                    </div>

                    <div class="space-y-2">
                      <div class="text-xs font-medium text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.placeholdersTitle') }}
                      </div>
                      <p class="text-xs text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.placeholdersDescription') }}
                      </p>
                      <div class="grid gap-2 sm:grid-cols-2">
                        <div
                          v-for="item in placeholderDocs"
                          :key="item.token"
                          class="rounded-md border bg-background p-3"
                        >
                          <div class="text-xs font-medium">
                            <code>{{ item.token }}</code>
                          </div>
                          <div class="mt-1 text-[11px] text-muted-foreground">
                            {{ fieldDescription(item.field) }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-4 lg:grid-cols-2">
                    <div class="space-y-2">
                      <div class="text-xs font-medium text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.envTitle') }}
                      </div>
                      <div class="grid gap-2 sm:grid-cols-2">
                        <div
                          v-for="item in envDocs"
                          :key="item.token"
                          class="rounded-md border bg-background p-3"
                        >
                          <div class="text-xs font-medium">
                            <code>{{ item.token }}</code>
                          </div>
                          <div class="mt-1 text-[11px] text-muted-foreground">
                            {{ fieldDescription(item.field) }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="space-y-2">
                      <div class="text-xs font-medium text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.examplesTitle') }}
                      </div>
                      <div class="space-y-2">
                        <div
                          v-for="item in commandExamples"
                          :key="item.labelKey"
                          class="rounded-md border bg-background p-3"
                        >
                          <div class="mb-2 text-[11px] font-medium text-muted-foreground">
                            {{ t(item.labelKey) }}
                          </div>
                          <pre
                            class="overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-5"
                            >{{ item.command }}</pre
                          >
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div
              v-if="config.hooks.length === 0"
              data-testid="notifications-hooks-empty"
              class="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
            >
              {{ t('settings.notificationsHooks.commands.empty') }}
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="(hook, index) in config.hooks"
                :key="hook.id"
                :data-testid="`notifications-hook-${hook.id}`"
                class="rounded-md border p-4"
              >
                <div class="space-y-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-[180px]">
                      <div class="text-sm font-medium">
                        {{ hook.name || fallbackHookName(index) }}
                      </div>
                      <div class="text-xs text-muted-foreground">{{ hook.id }}</div>
                    </div>

                    <div class="flex items-center gap-2">
                      <label class="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{{ hook.enabled ? t('common.enabled') : t('common.disabled') }}</span>
                        <Switch
                          :model-value="hook.enabled"
                          @update:model-value="
                            (value) => updateHookEnabled(hook.id, value === true)
                          "
                        />
                      </label>

                      <Button
                        variant="outline"
                        size="sm"
                        :disabled="isHookTesting(hook.id) || !hook.command.trim()"
                        @click="runHookTest(hook.id)"
                      >
                        <Icon
                          :icon="isHookTesting(hook.id) ? 'lucide:loader-2' : 'lucide:play'"
                          :class="['mr-1 h-4 w-4', isHookTesting(hook.id) && 'animate-spin']"
                        />
                        {{
                          isHookTesting(hook.id)
                            ? t('settings.notificationsHooks.test.testing')
                            : t('settings.notificationsHooks.test.button')
                        }}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        class="text-destructive"
                        @click="removeHook(hook.id)"
                      >
                        <Icon icon="lucide:trash-2" class="mr-1 h-4 w-4" />
                        {{ t('common.delete') }}
                      </Button>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.name') }}
                      </Label>
                      <Input
                        v-model="hook.name"
                        :placeholder="t('settings.notificationsHooks.commands.namePlaceholder')"
                        @blur="persistConfig"
                      />
                    </div>

                    <div class="space-y-2">
                      <Label class="text-xs text-muted-foreground">
                        {{ t('settings.notificationsHooks.commands.commandLabel') }}
                      </Label>
                      <Input
                        v-model="hook.command"
                        :placeholder="t('settings.notificationsHooks.commands.commandPlaceholder')"
                        @blur="persistConfig"
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
                        :key="`${hook.id}-${eventName}`"
                        class="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          :checked="hook.events.includes(eventName)"
                          @update:checked="
                            (value) => updateHookEvent(hook.id, eventName, value === true)
                          "
                        />
                        <span>{{ eventLabel(eventName) }}</span>
                      </label>
                    </div>
                  </div>

                  <div v-if="testResults[hook.id]" class="space-y-1 text-xs">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        :class="
                          testResults[hook.id]?.success ? 'text-emerald-600' : 'text-destructive'
                        "
                      >
                        {{
                          testResults[hook.id]?.success
                            ? t('settings.notificationsHooks.test.success')
                            : t('settings.notificationsHooks.test.failed')
                        }}
                      </span>
                      <span class="text-muted-foreground">
                        {{
                          t('settings.notificationsHooks.test.duration', {
                            ms: testResults[hook.id]?.durationMs || 0
                          })
                        }}
                      </span>
                      <span
                        v-if="testResults[hook.id]?.exitCode !== undefined"
                        class="text-muted-foreground"
                      >
                        {{
                          t('settings.notificationsHooks.test.exitCode', {
                            code: testResults[hook.id]?.exitCode
                          })
                        }}
                      </span>
                    </div>
                    <div v-if="testResults[hook.id]?.error" class="break-all text-destructive">
                      {{ testResults[hook.id]?.error }}
                    </div>
                    <div
                      v-if="testResults[hook.id]?.stdout"
                      class="break-all text-muted-foreground"
                    >
                      <span class="font-medium">
                        {{ t('settings.notificationsHooks.test.stdout') }}
                      </span>
                      : {{ formatPreview(testResults[hook.id]?.stdout) }}
                    </div>
                    <div
                      v-if="testResults[hook.id]?.stderr"
                      class="break-all text-muted-foreground"
                    >
                      <span class="font-medium">
                        {{ t('settings.notificationsHooks.test.stderr') }}
                      </span>
                      : {{ formatPreview(testResults[hook.id]?.stderr) }}
                    </div>
                  </div>
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
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import type {
  HookCommandItem,
  HookEventName,
  HookTestResult,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'
import { DEFAULT_IMPORTANT_HOOK_EVENTS, HOOK_EVENT_NAMES } from '@shared/hooksNotifications'

const PREVIEW_LIMIT = 200
type HookDocField =
  | 'event'
  | 'time'
  | 'isTest'
  | 'conversationId'
  | 'workdir'
  | 'agentId'
  | 'providerId'
  | 'modelId'
  | 'messageId'
  | 'toolName'
  | 'toolCallId'

const { t } = useI18n()
const { toast } = useToast()
const configPresenter = usePresenter('configPresenter')

const config = ref<HooksNotificationsSettings | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const guideOpen = ref(false)
const testing = ref<Record<string, boolean>>({})
const testResults = ref<Record<string, HookTestResult | null>>({})
let pendingSave = false

const eventNames = HOOK_EVENT_NAMES
const stdinPreview = `{
  "event": "SessionStart",
  "time": "2026-04-13T00:00:00.000Z",
  "session": {
    "conversationId": "session-123",
    "workdir": "/path/to/project"
  },
  "user": null,
  "tool": null
}`
const placeholderDocs: Array<{ token: string; field: HookDocField }> = [
  { token: '{{event}}', field: 'event' },
  { token: '{{time}}', field: 'time' },
  { token: '{{isTest}}', field: 'isTest' },
  { token: '{{conversationId}}', field: 'conversationId' },
  { token: '{{workdir}}', field: 'workdir' },
  { token: '{{agentId}}', field: 'agentId' },
  { token: '{{providerId}}', field: 'providerId' },
  { token: '{{modelId}}', field: 'modelId' },
  { token: '{{messageId}}', field: 'messageId' },
  { token: '{{toolName}}', field: 'toolName' },
  { token: '{{toolCallId}}', field: 'toolCallId' }
]
const envDocs: Array<{ token: string; field: HookDocField }> = [
  { token: 'DEEPCHAT_HOOK_EVENT', field: 'event' },
  { token: 'DEEPCHAT_HOOK_TIME', field: 'time' },
  { token: 'DEEPCHAT_HOOK_IS_TEST', field: 'isTest' },
  { token: 'DEEPCHAT_CONVERSATION_ID', field: 'conversationId' },
  { token: 'DEEPCHAT_WORKDIR', field: 'workdir' },
  { token: 'DEEPCHAT_AGENT_ID', field: 'agentId' },
  { token: 'DEEPCHAT_PROVIDER_ID', field: 'providerId' },
  { token: 'DEEPCHAT_MODEL_ID', field: 'modelId' },
  { token: 'DEEPCHAT_MESSAGE_ID', field: 'messageId' },
  { token: 'DEEPCHAT_TOOL_NAME', field: 'toolName' },
  { token: 'DEEPCHAT_TOOL_CALL_ID', field: 'toolCallId' }
]
const commandExamples = [
  {
    labelKey: 'settings.notificationsHooks.commands.exampleNodeLabel',
    command: 'node scripts/hook.js {{event}} {{conversationId}}'
  },
  {
    labelKey: 'settings.notificationsHooks.commands.examplePythonLabel',
    command: 'python scripts/hook.py --event {{event}} --session {{conversationId}}'
  },
  {
    labelKey: 'settings.notificationsHooks.commands.examplePowerShellLabel',
    command: 'powershell -File scripts/hook.ps1 {{event}} {{isTest}}'
  }
]

const createHookDraft = (index: number): HookCommandItem => ({
  id: crypto.randomUUID(),
  name: fallbackHookName(index),
  enabled: false,
  command: '',
  events: [...DEFAULT_IMPORTANT_HOOK_EVENTS]
})

function fallbackHookName(index: number): string {
  return t('settings.notificationsHooks.commands.defaultName', { index: index + 1 })
}

const loadConfig = async () => {
  isLoading.value = true
  try {
    config.value = await configPresenter.getHooksNotificationsConfig()
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
  if (!config.value) {
    return
  }
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

const addHook = () => {
  if (!config.value) {
    return
  }
  config.value.hooks.push(createHookDraft(config.value.hooks.length))
  void persistConfig()
}

const removeHook = (hookId: string) => {
  if (!config.value) {
    return
  }
  config.value.hooks = config.value.hooks.filter((hook) => hook.id !== hookId)
  delete testing.value[hookId]
  delete testResults.value[hookId]
  void persistConfig()
}

const updateHookEnabled = (hookId: string, enabled: boolean) => {
  const hook = config.value?.hooks.find((item) => item.id === hookId)
  if (!hook) {
    return
  }
  hook.enabled = enabled
  void persistConfig()
}

const updateHookEvent = (hookId: string, eventName: HookEventName, checked: boolean) => {
  const hook = config.value?.hooks.find((item) => item.id === hookId)
  if (!hook) {
    return
  }

  const events = new Set(hook.events)
  if (checked) {
    events.add(eventName)
  } else {
    events.delete(eventName)
  }
  hook.events = Array.from(events)
  void persistConfig()
}

const runHookTest = async (hookId: string) => {
  if (testing.value[hookId]) {
    return
  }

  await persistConfig()
  testing.value = {
    ...testing.value,
    [hookId]: true
  }
  testResults.value = {
    ...testResults.value,
    [hookId]: null
  }

  try {
    const result = await configPresenter.testHookCommand(hookId)
    testResults.value = {
      ...testResults.value,
      [hookId]: result
    }
  } catch (error) {
    testResults.value = {
      ...testResults.value,
      [hookId]: {
        success: false,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    testing.value = {
      ...testing.value,
      [hookId]: false
    }
  }
}

const isHookTesting = (hookId: string) => testing.value[hookId] === true

const eventLabel = (eventName: HookEventName) =>
  t(`settings.notificationsHooks.events.${eventName}`)
const fieldDescription = (field: HookDocField) =>
  t(`settings.notificationsHooks.commands.fields.${field}`)

const formatPreview = (value?: string) => {
  if (!value) {
    return ''
  }
  return value.length <= PREVIEW_LIMIT ? value : `${value.slice(0, PREVIEW_LIMIT)}…`
}

onMounted(() => {
  void loadConfig()
})
</script>
