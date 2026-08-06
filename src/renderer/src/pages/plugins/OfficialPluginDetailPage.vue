<template>
  <ScrollArea v-if="remoteChannel" class="h-full w-full">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <div class="flex items-center gap-2">
        <DcButton variant="ghost" size="sm" @click="router.push({ name: 'plugins' })">
          <Icon icon="lucide:arrow-left" class="mr-2 size-4" />
          {{ t('common.back') }}
        </DcButton>
      </div>

      <div v-if="remoteLoading" class="space-y-3">
        <div class="h-8 w-56 animate-pulse rounded bg-muted"></div>
        <div class="h-24 animate-pulse rounded-lg bg-muted/60"></div>
      </div>

      <div
        v-else-if="remoteErrorMessage"
        class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
      >
        {{ remoteErrorMessage }}
      </div>

      <template v-else>
        <header
          class="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0 space-y-2">
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted/40"
              >
                <Icon :icon="remoteIcon" class="size-6" :class="remoteIconClass" />
              </div>
              <div class="min-w-0">
                <h1 class="truncate text-2xl font-semibold tracking-normal">
                  {{ remoteTitle }}
                </h1>
                <p class="truncate text-sm text-muted-foreground">
                  {{ remoteDescription }}
                </p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 text-xs">
              <span
                class="rounded-full border px-2 py-1"
                :class="
                  remoteEnabled
                    ? 'border-emerald-500/40 text-emerald-600'
                    : 'border-border text-muted-foreground'
                "
              >
                {{
                  remoteEnabled
                    ? t('settings.plugins.status.enabled')
                    : t('settings.plugins.status.disabled')
                }}
              </span>
              <span v-if="remoteStatus" class="rounded-full border border-border px-2 py-1">
                {{ t(`chat.sidebar.remoteControlStatus.${remoteStatus.state}`) }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <DcButton
              v-if="!remoteEnabled"
              :disabled="pending"
              size="sm"
              @click="enableRemotePlugin"
            >
              <Icon icon="lucide:power" class="mr-2 size-4" />
              {{ t('settings.plugins.enable') }}
            </DcButton>
            <DcButton
              v-if="remoteEnabled"
              :disabled="pending"
              size="sm"
              variant="outline"
              @click="disableRemotePlugin"
            >
              <Icon icon="lucide:power-off" class="mr-2 size-4" />
              {{ t('settings.plugins.disable') }}
            </DcButton>
          </div>
        </header>

        <div
          v-if="errorMessage"
          class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {{ errorMessage }}
        </div>

        <RemoteSettings
          :key="`${remoteChannel}:${remoteSettingsVersion}`"
          :channel="remoteChannel"
          embedded
          hide-channel-toggle
          hide-header
          single-channel
        />
      </template>
    </div>
  </ScrollArea>

  <ScrollArea v-else class="h-full w-full">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <div class="flex items-center gap-2">
        <DcButton variant="ghost" size="sm" @click="router.push({ name: 'plugins' })">
          <Icon icon="lucide:arrow-left" class="mr-2 size-4" />
          {{ t('common.back') }}
        </DcButton>
      </div>

      <div v-if="loading" class="space-y-3">
        <div class="h-8 w-56 animate-pulse rounded bg-muted"></div>
        <div class="h-24 animate-pulse rounded-lg bg-muted/60"></div>
      </div>

      <div
        v-else-if="!plugin"
        class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        {{ t('settings.pluginsHub.pluginNotFound') }}
      </div>

      <template v-else>
        <header
          class="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0 space-y-2">
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted/40"
              >
                <Icon :icon="pluginIcon" class="size-6" :class="pluginIconClass" />
              </div>
              <div class="min-w-0">
                <h1 class="truncate text-2xl font-semibold tracking-normal">{{ pluginTitle }}</h1>
                <p class="truncate text-sm text-muted-foreground">
                  {{ pluginDescription }}
                </p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 text-xs">
              <span class="rounded-full border border-border px-2 py-1">{{ plugin.version }}</span>
              <span
                class="rounded-full border px-2 py-1"
                :class="
                  plugin.enabled
                    ? 'border-emerald-500/40 text-emerald-600'
                    : 'border-border text-muted-foreground'
                "
              >
                {{
                  plugin.enabled
                    ? t('settings.plugins.status.enabled')
                    : t('settings.plugins.status.disabled')
                }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap gap-2">
            <DcButton v-if="!plugin.enabled" :disabled="pending" size="sm" @click="enablePlugin">
              <Icon icon="lucide:power" class="mr-2 size-4" />
              {{ t('settings.plugins.enable') }}
            </DcButton>
            <DcButton
              v-if="plugin.enabled"
              :disabled="pending"
              size="sm"
              variant="outline"
              @click="disablePlugin"
            >
              <Icon icon="lucide:power-off" class="mr-2 size-4" />
              {{ t('settings.plugins.disable') }}
            </DcButton>
          </div>
        </header>

        <div
          v-if="errorMessage"
          class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {{ errorMessage }}
        </div>

        <Alert v-if="plugin.activationError" variant="destructive">
          <Icon icon="lucide:shield-alert" />
          <AlertTitle>{{ t('settings.plugins.runtimeStates.error') }}</AlertTitle>
          <AlertDescription class="break-all">{{ plugin.activationError }}</AlertDescription>
        </Alert>

        <Alert v-else-if="cuaRuntimeIntegrityError" variant="destructive">
          <Icon icon="lucide:shield-alert" />
          <AlertTitle>{{ t('settings.plugins.runtimeStates.error') }}</AlertTitle>
          <AlertDescription class="break-all">{{ cuaRuntimeIntegrityError }}</AlertDescription>
        </Alert>

        <Alert v-else-if="cuaRuntimeQuarantined" variant="destructive">
          <Icon icon="lucide:shield-alert" />
          <AlertTitle>{{ t('settings.plugins.runtimeStates.quarantined') }}</AlertTitle>
          <AlertDescription>
            {{ t('settings.plugins.quarantineDescription') }}
          </AlertDescription>
        </Alert>

        <DcSectionCard :title="t('settings.plugins.runtime')">
          <template #actions>
            <div v-if="showCuaRuntimeActions" class="flex flex-wrap gap-2">
              <DcButton
                v-if="cuaRuntimeQuarantined && !cuaRuntimeIntegrityError"
                data-testid="cua-runtime-retry"
                size="sm"
                variant="outline"
                :disabled="pending"
                @click="runCuaRuntimeAction('runtime.retry')"
              >
                <Icon icon="lucide:rotate-ccw" class="mr-2 size-4" />
                {{ t('settings.plugins.retryRuntime') }}
              </DcButton>
              <DcButton
                v-else
                data-testid="cua-runtime-test"
                size="sm"
                variant="outline"
                :disabled="pending"
                @click="runCuaRuntimeAction('runtime.test')"
              >
                <Icon icon="lucide:play" class="mr-2 size-4" />
                {{ t('settings.plugins.testRuntime') }}
              </DcButton>
            </div>
          </template>
          <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ t('settings.plugins.runtimeState') }}</dt>
            <dd>{{ formatRuntimeState(plugin.runtime?.state) }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.plugins.version') }}</dt>
            <dd>{{ plugin.runtime?.version || '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.plugins.command') }}</dt>
            <dd class="truncate font-mono text-xs">{{ plugin.runtime?.command || '-' }}</dd>
          </dl>
          <p v-if="plugin.runtime?.lastError" class="mt-3 break-all text-xs text-destructive">
            {{ plugin.runtime.lastError }}
          </p>
        </DcSectionCard>

        <DcSectionCard v-if="plugin.mcpServers?.length" :title="t('routes.settings-mcp')">
          <div class="divide-y divide-border/70">
            <div
              v-for="server in plugin.mcpServers"
              :key="server.serverId"
              class="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div class="min-w-0">
                <div class="truncate font-medium">{{ server.serverId }}</div>
                <div v-if="server.lastError" class="break-all text-xs text-destructive">
                  {{ server.lastError }}
                </div>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ formatMcpRuntimeState(server) }}
              </span>
            </div>
          </div>
        </DcSectionCard>

        <RemoteSettings
          v-if="isFeishuPlugin"
          :key="`feishu:${remoteSettingsVersion}`"
          channel="feishu"
          embedded
          hide-channel-toggle
          hide-header
          single-channel
        />

        <DcSectionCard v-if="lastActionData" :title="t('settings.pluginsHub.actionResult')">
          <pre class="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{{
            lastActionData
          }}</pre>
        </DcSectionCard>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcSectionCard } from '@dc-ui/components/section-card'
import { Alert, AlertDescription, AlertTitle } from '@shadcn/components/ui/alert'
import { DcButton } from '@dc-ui/components/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createPluginClient } from '@api/PluginClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import { usePluginCatalogStore } from '@/stores/pluginCatalog'
import RemoteSettings from '../../../settings/components/RemoteSettings.vue'
import type { ChannelSettingsMap, RemoteChannel } from '@shared/types/remote'
import {
  CUA_PLUGIN_ID,
  type PluginActionResult,
  type PluginMcpRuntimeStatus,
  type PluginRuntimeState
} from '@shared/types/plugin'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const pluginClient = createPluginClient()
const remoteControlClient = createRemoteControlClient()
const pluginCatalogStore = usePluginCatalogStore()

const loading = ref(false)
const remoteLoading = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const remoteErrorMessage = ref('')
const lastActionData = ref('')
const remoteSettingsVersion = ref(0)
const FEISHU_PLUGIN_ID = 'com.deepchat.plugins.feishu'
const remoteI18nKeyByChannel: Record<RemoteChannel, string> = {
  telegram: 'telegram',
  feishu: 'feishu',
  qqbot: 'qqbot',
  discord: 'discord',
  'weixin-ilink': 'weixinIlink'
}
const remoteIconByChannel: Record<RemoteChannel, string> = {
  telegram: 'lucide:send',
  feishu: 'lucide:message-circle',
  qqbot: 'lucide:bot',
  discord: 'lucide:radio-tower',
  'weixin-ilink': 'lucide:messages-square'
}
const remoteIconClassByChannel: Record<RemoteChannel, string> = {
  telegram: 'text-sky-500',
  feishu: 'text-blue-500',
  qqbot: 'text-emerald-500',
  discord: 'text-indigo-500',
  'weixin-ilink': 'text-green-500'
}
const CUA_PLUGIN_ICON = 'lucide:laptop-minimal-check'

const pluginId = computed(() => String(route.params.pluginId ?? ''))
const remoteChannel = computed<RemoteChannel | null>(() => {
  const id = pluginId.value
  if (!id.startsWith('remote:')) {
    return null
  }

  const channel = id.slice('remote:'.length)
  return ['telegram', 'feishu', 'qqbot', 'discord', 'weixin-ilink'].includes(channel)
    ? (channel as RemoteChannel)
    : null
})
const plugin = computed(() => pluginCatalogStore.getPlugin(pluginId.value))
const remoteStatus = computed(() => {
  const channel = remoteChannel.value
  return channel ? (pluginCatalogStore.remoteStatuses[channel] ?? null) : null
})
const isFeishuPlugin = computed(() => pluginId.value === FEISHU_PLUGIN_ID)
const isCuaPlugin = computed(() => pluginId.value === CUA_PLUGIN_ID)
const remoteEnabled = computed(() => Boolean(remoteStatus.value?.enabled))
const remoteTitle = computed(() => {
  const channel = remoteChannel.value
  return channel ? t(`settings.remote.${remoteI18nKeyByChannel[channel]}.title`) : ''
})
const remoteDescription = computed(() => {
  const channel = remoteChannel.value
  return channel ? t(`settings.remote.${remoteI18nKeyByChannel[channel]}.description`) : ''
})
const remoteIcon = computed(() => {
  const channel = remoteChannel.value
  return channel ? remoteIconByChannel[channel] : 'lucide:puzzle'
})
const remoteIconClass = computed(() => {
  const channel = remoteChannel.value
  return channel ? remoteIconClassByChannel[channel] : undefined
})
const pluginIcon = computed(() => {
  if (isFeishuPlugin.value) {
    return remoteIconByChannel.feishu
  }
  return isCuaPlugin.value ? CUA_PLUGIN_ICON : 'lucide:puzzle'
})
const pluginIconClass = computed(() =>
  isFeishuPlugin.value ? remoteIconClassByChannel.feishu : undefined
)
const pluginTitle = computed(() =>
  isFeishuPlugin.value ? t('settings.remote.feishu.title') : (plugin.value?.name ?? '')
)
const pluginDescription = computed(() => {
  if (isCuaPlugin.value) {
    return t('settings.pluginsHub.cuaDescription')
  }
  if (isFeishuPlugin.value) {
    return t('settings.remote.feishu.description')
  }
  return plugin.value ? `${plugin.value.publisher} · ${plugin.value.id}` : ''
})
const cuaMcpRuntime = computed(() =>
  plugin.value?.mcpServers?.find((server) => server.serverId === 'cua-driver')
)
const cuaRuntimeQuarantined = computed(() => cuaMcpRuntime.value?.lifecycleState === 'quarantined')
const cuaRuntimeIntegrityError = computed(() => cuaMcpRuntime.value?.integrityError)
const cuaRuntimeUnavailable = computed(
  () => plugin.value?.runtime?.state === 'missing' || plugin.value?.runtime?.state === 'error'
)
const showCuaRuntimeActions = computed(
  () =>
    isCuaPlugin.value &&
    plugin.value?.enabled === true &&
    !plugin.value.activationError &&
    !cuaRuntimeUnavailable.value &&
    Boolean(cuaMcpRuntime.value)
)

function formatRuntimeState(state?: PluginRuntimeState): string {
  if (!state) {
    return '-'
  }
  return t(`settings.plugins.runtimeStates.${state}`)
}

function formatMcpRuntimeState(server: PluginMcpRuntimeStatus): string {
  if (server.lifecycleState === 'quarantined') {
    return t('settings.plugins.runtimeStates.quarantined')
  }
  if (server.running) {
    return t('settings.plugins.runtimeStates.running')
  }
  if (!server.enabled) {
    return t('common.disabled')
  }
  if (isCuaPlugin.value && cuaRuntimeUnavailable.value) {
    return formatRuntimeState(plugin.value?.runtime?.state)
  }
  if (server.lifecycleState === 'error') {
    return t('settings.plugins.runtimeStates.error')
  }
  if (isCuaPlugin.value && server.serverId === 'cua-driver') {
    return t('settings.plugins.runtimeStates.readyOnDemand')
  }
  return t('settings.plugins.runtimeStates.installed')
}

async function loadPlugin(): Promise<void> {
  if (!pluginId.value) {
    return
  }
  loading.value = !plugin.value
  errorMessage.value = ''
  const version = pluginCatalogStore.capturePluginRefresh()
  try {
    const nextPlugin = await pluginClient.getPlugin(pluginId.value)
    if (nextPlugin) {
      pluginCatalogStore.replacePlugin(nextPlugin, version)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.loadFailed')
  } finally {
    loading.value = false
  }
}

async function loadRemotePlugin(): Promise<void> {
  const channel = remoteChannel.value
  if (!channel) {
    return
  }

  remoteLoading.value = !remoteStatus.value
  remoteErrorMessage.value = ''
  errorMessage.value = ''
  const version = pluginCatalogStore.captureRemoteRefresh()
  try {
    const status = await remoteControlClient.getChannelStatus(channel)
    pluginCatalogStore.replaceRemoteStatus(status, version)
  } catch (error) {
    if (remoteStatus.value) {
      console.warn(`[OfficialPluginDetailPage] Failed to refresh ${channel} status:`, error)
    } else {
      remoteErrorMessage.value =
        error instanceof Error ? error.message : t('common.error.requestFailed')
    }
  } finally {
    remoteLoading.value = false
  }
}

async function loadCurrentDetail(): Promise<void> {
  if (remoteChannel.value) {
    await loadRemotePlugin()
    return
  }

  await loadPlugin()
}

async function runPluginAction(
  enabled: boolean,
  action: () => Promise<PluginActionResult>,
  afterSuccess?: () => Promise<void>
): Promise<void> {
  const currentPlugin = plugin.value
  if (!currentPlugin) {
    return
  }

  pending.value = true
  errorMessage.value = ''
  lastActionData.value = ''
  const previous = pluginCatalogStore.beginPluginEnabledMutation(currentPlugin.id, enabled)
  let pluginActionSucceeded = false
  try {
    const result = await action()
    if (!result.ok) {
      throw new Error(result.error || t('settings.plugins.actionFailed'))
    }
    pluginActionSucceeded = true
    pluginCatalogStore.commitPluginMutation(result.status)
    lastActionData.value = result.data ? JSON.stringify(result.data, null, 2) : ''
    await afterSuccess?.()
  } catch (error) {
    if (!pluginActionSucceeded) {
      pluginCatalogStore.rollbackPluginMutation(previous)
    }
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.actionFailed')
  } finally {
    pending.value = false
  }
}

async function runCuaRuntimeAction(actionId: 'runtime.test' | 'runtime.retry'): Promise<void> {
  const currentPlugin = plugin.value
  if (!currentPlugin) {
    return
  }

  pending.value = true
  errorMessage.value = ''
  lastActionData.value = ''
  try {
    const result = await pluginClient.invokeAction({
      pluginId: currentPlugin.id,
      actionId
    })
    if (!result.ok) {
      throw new Error(result.error || t('settings.plugins.actionFailed'))
    }
    if (result.status) {
      pluginCatalogStore.commitPluginMutation(result.status)
    } else {
      await loadPlugin()
    }
  } catch (error) {
    const actionError = error instanceof Error ? error.message : t('settings.plugins.actionFailed')
    await loadPlugin()
    errorMessage.value = actionError
  } finally {
    pending.value = false
  }
}

async function setRemoteChannelEnabled<T extends RemoteChannel>(
  channel: T,
  remoteEnabled: boolean
): Promise<void> {
  const previous = pluginCatalogStore.beginRemoteEnabledMutation(channel, remoteEnabled)
  try {
    const settings = await remoteControlClient.getChannelSettings(channel)
    if (settings.remoteEnabled !== remoteEnabled) {
      await remoteControlClient.saveChannelSettings(channel, {
        ...settings,
        remoteEnabled
      } as ChannelSettingsMap[T])
    }
    pluginCatalogStore.commitRemoteMutation(await remoteControlClient.getChannelStatus(channel))
  } catch (error) {
    pluginCatalogStore.rollbackRemoteMutation(channel, previous)
    throw error
  }
}

async function setFeishuRemoteEnabled(remoteEnabled: boolean): Promise<void> {
  await setRemoteChannelEnabled('feishu', remoteEnabled)
}

async function runRemoteAction(action: () => Promise<void>): Promise<void> {
  pending.value = true
  errorMessage.value = ''
  try {
    await action()
    remoteSettingsVersion.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.actionFailed')
  } finally {
    pending.value = false
  }
}

function enablePlugin(): void {
  const currentPlugin = plugin.value
  if (!currentPlugin) {
    return
  }
  void runPluginAction(
    true,
    () => pluginClient.enablePlugin(currentPlugin.id),
    currentPlugin.id === FEISHU_PLUGIN_ID
      ? async () => {
          await setFeishuRemoteEnabled(true)
          remoteSettingsVersion.value += 1
        }
      : undefined
  )
}

function disablePlugin(): void {
  const currentPlugin = plugin.value
  if (!currentPlugin) {
    return
  }
  void runPluginAction(
    false,
    () => pluginClient.disablePlugin(currentPlugin.id),
    currentPlugin.id === FEISHU_PLUGIN_ID
      ? async () => {
          await setFeishuRemoteEnabled(false)
          remoteSettingsVersion.value += 1
        }
      : undefined
  )
}

function enableRemotePlugin(): void {
  const channel = remoteChannel.value
  if (!channel) {
    return
  }
  void runRemoteAction(() => setRemoteChannelEnabled(channel, true))
}

function disableRemotePlugin(): void {
  const channel = remoteChannel.value
  if (!channel) {
    return
  }
  void runRemoteAction(() => setRemoteChannelEnabled(channel, false))
}

watch(pluginId, () => {
  void loadCurrentDetail()
})

onMounted(() => {
  void loadCurrentDetail()
})
</script>
