<template>
  <div v-if="remoteChannel" class="flex h-full min-h-0 w-full flex-col bg-background">
    <div class="shrink-0 px-6 pt-6">
      <Button variant="ghost" size="sm" @click="router.push({ name: 'plugins' })">
        <Icon icon="lucide:arrow-left" class="mr-2 size-4" />
        {{ t('common.back') }}
      </Button>
    </div>
    <div class="min-h-0 flex-1">
      <RemoteSettings :channel="remoteChannel" single-channel />
    </div>
  </div>

  <ScrollArea v-else class="h-full w-full">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" @click="router.push({ name: 'plugins' })">
          <Icon icon="lucide:arrow-left" class="mr-2 size-4" />
          {{ t('common.back') }}
        </Button>
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
                <Icon icon="lucide:puzzle" class="size-6" />
              </div>
              <div class="min-w-0">
                <h1 class="truncate text-2xl font-semibold tracking-normal">{{ plugin.name }}</h1>
                <p class="truncate text-sm text-muted-foreground">
                  {{ plugin.publisher }} · {{ plugin.id }}
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
            <Button v-if="!plugin.enabled" :disabled="pending" size="sm" @click="enablePlugin">
              <Icon icon="lucide:power" class="mr-2 size-4" />
              {{ t('settings.plugins.enable') }}
            </Button>
            <Button
              v-if="plugin.enabled"
              :disabled="pending"
              size="sm"
              variant="outline"
              @click="disablePlugin"
            >
              <Icon icon="lucide:power-off" class="mr-2 size-4" />
              {{ t('settings.plugins.disable') }}
            </Button>
          </div>
        </header>

        <div
          v-if="errorMessage"
          class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {{ errorMessage }}
        </div>

        <section class="grid gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-border p-4">
            <div class="mb-3 text-sm font-semibold">{{ t('settings.plugins.runtime') }}</div>
            <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt class="text-muted-foreground">{{ t('settings.plugins.runtime') }}</dt>
              <dd>{{ formatRuntimeState(plugin.runtime?.state) }}</dd>
              <dt class="text-muted-foreground">{{ t('settings.plugins.version') }}</dt>
              <dd>{{ plugin.runtime?.version || '-' }}</dd>
              <dt class="text-muted-foreground">{{ t('settings.plugins.command') }}</dt>
              <dd class="truncate font-mono text-xs">{{ plugin.runtime?.command || '-' }}</dd>
            </dl>
            <p v-if="plugin.runtime?.lastError" class="mt-3 break-all text-xs text-destructive">
              {{ plugin.runtime.lastError }}
            </p>
          </div>

          <div class="rounded-lg border border-border p-4">
            <div class="mb-3 text-sm font-semibold">
              {{ t('settings.pluginsHub.capabilities') }}
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="capability in plugin.capabilities"
                :key="capability"
                class="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                {{ capability }}
              </span>
            </div>
          </div>
        </section>

        <section v-if="plugin.mcpServers?.length" class="rounded-lg border border-border p-4">
          <div class="mb-3 text-sm font-semibold">{{ t('routes.settings-mcp') }}</div>
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
                {{
                  server.running
                    ? t('settings.plugins.runtimeStates.running')
                    : t('common.disabled')
                }}
              </span>
            </div>
          </div>
        </section>

        <RemoteSettings
          v-if="isFeishuPlugin"
          channel="feishu"
          embedded
          hide-header
          single-channel
        />

        <section v-if="lastActionData" class="rounded-lg border border-border p-4">
          <div class="mb-3 text-sm font-semibold">{{ t('settings.pluginsHub.actionResult') }}</div>
          <pre class="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{{
            lastActionData
          }}</pre>
        </section>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createPluginClient } from '@api/PluginClient'
import RemoteSettings from '../../../settings/components/RemoteSettings.vue'
import type { RemoteChannel } from '@shared/presenter'
import type { PluginActionResult, PluginListItem, PluginRuntimeState } from '@shared/types/plugin'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const pluginClient = createPluginClient()

const plugin = ref<PluginListItem | null>(null)
const loading = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const lastActionData = ref('')
const FEISHU_PLUGIN_ID = 'com.deepchat.plugins.feishu'

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
const isFeishuPlugin = computed(() => pluginId.value === FEISHU_PLUGIN_ID)

function formatRuntimeState(state?: PluginRuntimeState): string {
  if (!state) {
    return '-'
  }
  return t(`settings.plugins.runtimeStates.${state}`)
}

async function loadPlugin(): Promise<void> {
  if (remoteChannel.value) {
    plugin.value = null
    return
  }

  if (!pluginId.value) {
    plugin.value = null
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    plugin.value = (await pluginClient.getPlugin(pluginId.value)) ?? null
  } catch (error) {
    plugin.value = null
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.loadFailed')
  } finally {
    loading.value = false
  }
}

async function runPluginAction(action: () => Promise<PluginActionResult>): Promise<void> {
  pending.value = true
  errorMessage.value = ''
  lastActionData.value = ''
  try {
    const result = await action()
    if (!result.ok) {
      throw new Error(result.error || t('settings.plugins.actionFailed'))
    }
    lastActionData.value = result.data ? JSON.stringify(result.data, null, 2) : ''
    await loadPlugin()
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
  void runPluginAction(() => pluginClient.enablePlugin(currentPlugin.id))
}

function disablePlugin(): void {
  const currentPlugin = plugin.value
  if (!currentPlugin) {
    return
  }
  void runPluginAction(() => pluginClient.disablePlugin(currentPlugin.id))
}

watch(pluginId, () => {
  void loadPlugin()
})

onMounted(() => {
  void loadPlugin()
})
</script>
