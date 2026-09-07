<template>
  <section
    v-if="shellSettingsSupported"
    class="flex flex-col gap-2"
    data-testid="command-shell-settings"
  >
    <div class="flex min-h-10 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span
        class="flex shrink-0 items-center gap-2 text-sm font-medium sm:min-w-[220px]"
        :dir="langStore.dir"
      >
        <Icon icon="lucide:terminal" class="size-4 text-muted-foreground" />
        <span class="truncate">{{ t('settings.common.commandShell.title') }}</span>
      </span>
      <div class="w-full sm:ml-auto sm:max-w-[320px]">
        <Select
          :model-value="config.preference"
          :disabled="loading || saving"
          @update:model-value="updatePreference"
        >
          <SelectTrigger
            data-testid="command-shell-preference"
            class="h-8! w-full border-border text-sm hover:bg-accent"
            :aria-label="t('settings.common.commandShell.title')"
            @mousedown.capture="suppressOverrideBlurForPointerFocus"
            @blur="saveOverride"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="end"
            @pointerdown.capture="suppressOverrideBlurForPointerFocus"
            @focusout="saveOverride"
          >
            <SelectItem value="auto">{{ t('settings.common.commandShell.auto') }}</SelectItem>
            <template v-if="isWindows">
              <SelectItem value="windows-powershell">
                {{ t('settings.common.commandShell.windowsPowerShell') }}
              </SelectItem>
              <SelectItem value="powershell-core">
                {{ t('settings.common.commandShell.powerShellCore') }}
              </SelectItem>
              <SelectItem value="cmd">
                {{ t('settings.common.commandShell.commandPrompt') }}
              </SelectItem>
              <SelectItem value="git-bash">
                {{ t('settings.common.commandShell.gitBash') }}
              </SelectItem>
            </template>
            <template v-else>
              <SelectItem value="bash">{{ t('settings.common.commandShell.bash') }}</SelectItem>
              <SelectItem value="zsh">{{ t('settings.common.commandShell.zsh') }}</SelectItem>
              <SelectItem value="fish">{{ t('settings.common.commandShell.fish') }}</SelectItem>
            </template>
          </SelectContent>
        </Select>
      </div>
    </div>

    <template v-if="config.preference === 'git-bash'">
      <div class="flex min-h-10 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
        <span
          class="flex shrink-0 items-center gap-2 text-sm font-medium sm:min-w-[220px]"
          :dir="langStore.dir"
        >
          <Icon icon="lucide:file-terminal" class="size-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.common.commandShell.executable') }}</span>
        </span>
        <div class="flex w-full min-w-0 items-center gap-1.5 sm:ml-auto sm:max-w-[320px]">
          <Input
            v-model="overrideDraft"
            data-testid="command-shell-executable"
            class="h-8 min-w-0 flex-1 text-sm"
            :aria-label="t('settings.common.commandShell.executable')"
            :disabled="loading || saving"
            :placeholder="t('settings.common.commandShell.autoDetect')"
            @blur="saveOverride"
            @keydown.enter.prevent="saveOverride"
          />
          <DcButton
            variant="outline"
            size="icon"
            icon="lucide:folder-open"
            :label="t('settings.common.commandShell.browse')"
            :tooltip="t('settings.common.commandShell.browse')"
            :disabled="loading || saving"
            data-testid="command-shell-browse"
            @mousedown.prevent
            @click="browseForExecutable"
          />
          <DcButton
            v-if="config.gitBashExecutableOverride"
            variant="ghost"
            size="icon"
            icon="lucide:x"
            :label="t('settings.common.commandShell.clearOverride')"
            :tooltip="t('settings.common.commandShell.clearOverride')"
            :disabled="loading || saving"
            data-testid="command-shell-clear"
            @mousedown.prevent
            @click="clearOverride"
          />
        </div>
      </div>

      <div class="flex min-h-8 items-start gap-3">
        <span class="hidden min-w-[220px] shrink-0 sm:block" />
        <div class="flex w-full min-w-0 items-start gap-2 text-xs sm:ml-auto sm:max-w-[320px]">
          <Icon :icon="statusIcon" class="mt-0.5 size-3.5 shrink-0" :class="statusIconClass" />
          <span class="min-w-0 flex-1 break-all" data-testid="command-shell-status">
            {{ statusText }}
          </span>
          <DcButton
            variant="ghost"
            size="icon-xs"
            icon="lucide:refresh-cw"
            :icon-class="checking ? 'animate-spin' : undefined"
            :label="t('settings.common.commandShell.refresh')"
            :tooltip="t('settings.common.commandShell.refresh')"
            :disabled="loading || saving || checking"
            data-testid="command-shell-refresh"
            @mousedown.prevent
            @click="refreshFromControls"
          />
        </div>
      </div>
    </template>

    <div v-if="operationError" class="text-xs text-destructive sm:pl-[220px]">
      {{ operationError }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { createDeviceClient } from '@api/DeviceClient'
import { createSettingsClient } from '@api/SettingsClient'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useLanguageStore } from '@/stores/language'
import {
  AgentCommandShellPreferenceSchema,
  DEFAULT_AGENT_COMMAND_SHELL_CONFIG,
  type AgentCommandShellConfig,
  type GitBashAvailability
} from '@shared/commandShell'

const { t } = useI18n()
const langStore = useLanguageStore()
const deviceClient = createDeviceClient()
const settingsClient = createSettingsClient()

const isWindows = ref(false)
const shellSettingsSupported = ref(false)
const loading = ref(true)
const saving = ref(false)
const checking = ref(false)
const operationError = ref('')
const config = ref<AgentCommandShellConfig>({ ...DEFAULT_AGENT_COMMAND_SHELL_CONFIG })
const overrideDraft = ref('')
const availability = ref<GitBashAvailability | null>(null)
let configRequestId = 0
let availabilityRequestId = 0
let configLoadRequestId = 0
let suppressOverrideBlur = false
let stopCommandShellChanged: (() => void) | null = null
let disposed = false

const statusIcon = computed(() => {
  if (checking.value) return 'lucide:loader-circle'
  return availability.value?.available ? 'lucide:circle-check' : 'lucide:circle-alert'
})

const statusIconClass = computed(() => {
  if (checking.value) return 'animate-spin text-muted-foreground'
  return availability.value?.available ? 'text-emerald-600' : 'text-destructive'
})

const statusText = computed(() => {
  if (checking.value) return t('settings.common.commandShell.checking')
  if (!availability.value) return t('settings.common.commandShell.checkFailed')
  if (availability.value.available) {
    return t('settings.common.commandShell.available', {
      path: availability.value.executable
    })
  }
  return t(`settings.common.commandShell.errors.${availability.value.error}`)
})

const applyConfig = (value: AgentCommandShellConfig) => {
  config.value = value
  overrideDraft.value = value.gitBashExecutableOverride ?? ''
}

const persistConfig = async (next: AgentCommandShellConfig): Promise<boolean> => {
  const requestId = ++configRequestId
  saving.value = true
  operationError.value = ''
  try {
    const saved = await settingsClient.updateCommandShell(next)
    if (requestId !== configRequestId) return false
    applyConfig(saved)
    return true
  } catch (error) {
    console.error('[CommandShellSettings] Failed to update command shell:', error)
    if (requestId === configRequestId) {
      operationError.value = t('settings.common.commandShell.updateFailed')
    }
    return false
  } finally {
    if (requestId === configRequestId) saving.value = false
  }
}

const refreshAvailability = async (forceRefresh = false) => {
  const requestId = ++availabilityRequestId
  checking.value = true
  operationError.value = ''
  try {
    const result = await settingsClient.checkCommandShell(forceRefresh)
    if (requestId === availabilityRequestId) availability.value = result
  } catch (error) {
    console.error('[CommandShellSettings] Failed to check Git Bash:', error)
    if (requestId === availabilityRequestId) {
      availability.value = null
    }
  } finally {
    if (requestId === availabilityRequestId) checking.value = false
  }
}

const handlePublishedConfig = (value: AgentCommandShellConfig) => {
  configLoadRequestId += 1
  configRequestId += 1
  availabilityRequestId += 1
  saving.value = false
  checking.value = false
  operationError.value = ''
  availability.value = null
  applyConfig(value)
  if (isWindows.value && value.preference === 'git-bash') {
    void refreshAvailability()
  }
}

const updatePreference = async (value: unknown) => {
  if (saving.value) return
  const parsed = AgentCommandShellPreferenceSchema.safeParse(value)
  if (!parsed.success) return

  const normalizedOverride = overrideDraft.value.trim()
  const existingOverride = config.value.gitBashExecutableOverride ?? ''
  if (parsed.data === config.value.preference && normalizedOverride === existingOverride) return

  const { gitBashExecutableOverride: _existing, ...baseConfig } = config.value
  const saved = await persistConfig({
    ...baseConfig,
    preference: parsed.data,
    ...(normalizedOverride ? { gitBashExecutableOverride: normalizedOverride } : {})
  })
  if (!saved) return
  availabilityRequestId += 1
  availability.value = null
  if (parsed.data === 'git-bash') await refreshAvailability()
}

const suppressOverrideBlurForPointerFocus = () => {
  suppressOverrideBlur = true
  queueMicrotask(() => {
    suppressOverrideBlur = false
  })
}

const isPreferenceFocusTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest('[data-slot="select-trigger"], [data-slot="select-content"]'))

const saveOverride = async (event?: FocusEvent) => {
  if (event && isPreferenceFocusTarget(event.relatedTarget)) return
  if (saving.value || suppressOverrideBlur) return
  const normalized = overrideDraft.value.trim()
  if (normalized === (config.value.gitBashExecutableOverride ?? '')) {
    overrideDraft.value = normalized
    return
  }

  const { gitBashExecutableOverride: _existing, ...baseConfig } = config.value
  const saved = await persistConfig({
    ...baseConfig,
    preference: 'git-bash',
    ...(normalized ? { gitBashExecutableOverride: normalized } : {})
  })
  if (!saved) {
    overrideDraft.value = config.value.gitBashExecutableOverride ?? ''
    return
  }
  availabilityRequestId += 1
  availability.value = null
  await refreshAvailability(true)
}

const refreshFromControls = async () => {
  if (saving.value || checking.value) return
  const normalized = overrideDraft.value.trim()
  if (normalized !== (config.value.gitBashExecutableOverride ?? '')) {
    await saveOverride()
    return
  }
  overrideDraft.value = normalized
  await refreshAvailability(true)
}

const browseForExecutable = async () => {
  if (saving.value) return
  operationError.value = ''
  try {
    const result = await deviceClient.selectFiles({
      filters: [{ name: 'Git Bash', extensions: ['exe'] }],
      multiple: false
    })
    if (result.canceled || !result.filePaths[0]) return
    overrideDraft.value = result.filePaths[0]
    await saveOverride()
  } catch (error) {
    console.error('[CommandShellSettings] Failed to select Git Bash:', error)
    operationError.value = t('settings.common.commandShell.browseFailed')
  }
}

const clearOverride = async () => {
  if (saving.value) return
  overrideDraft.value = ''
  await saveOverride()
}

onMounted(async () => {
  stopCommandShellChanged = settingsClient.onCommandShellChanged(({ config: publishedConfig }) => {
    if (!disposed) handlePublishedConfig(publishedConfig)
  })
  let shouldCheckAvailability = false
  let currentConfigLoadRequestId: number | null = null
  try {
    const deviceInfo = await deviceClient.getDeviceInfo()
    if (disposed) return
    isWindows.value = deviceInfo.platform === 'win32'
    shellSettingsSupported.value = ['darwin', 'linux', 'win32'].includes(deviceInfo.platform)
    if (!shellSettingsSupported.value) return

    currentConfigLoadRequestId = ++configLoadRequestId
    const savedConfig = await settingsClient.getCommandShell()
    if (disposed || currentConfigLoadRequestId !== configLoadRequestId) return
    applyConfig(savedConfig)
    shouldCheckAvailability = savedConfig.preference === 'git-bash'
  } catch (error) {
    if (
      disposed ||
      (currentConfigLoadRequestId !== null && currentConfigLoadRequestId !== configLoadRequestId)
    ) {
      return
    }
    console.error('[CommandShellSettings] Failed to load command shell settings:', error)
    operationError.value = t('settings.common.commandShell.loadFailed')
  } finally {
    loading.value = false
  }
  if (shouldCheckAvailability) await refreshAvailability()
})

onBeforeUnmount(() => {
  disposed = true
  configLoadRequestId += 1
  configRequestId += 1
  availabilityRequestId += 1
  stopCommandShellChanged?.()
  stopCommandShellChanged = null
})
</script>
