<template>
  <ScrollArea class="h-full w-full">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
      <header class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold tracking-normal">{{ t('routes.plugins') }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ t('settings.pluginsHub.subtitle') }}
          </p>
        </div>

        <Button variant="outline" size="icon" :disabled="loading" @click="loadCatalog">
          <Icon icon="lucide:refresh-cw" class="size-4" :class="loading ? 'animate-spin' : ''" />
        </Button>
      </header>

      <div
        v-if="errorMessage"
        class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
      >
        {{ errorMessage }}
      </div>

      <AgentExtensionPolicyPanel :kinds="['plugins']" />

      <section class="space-y-4">
        <div class="border-b border-border/70 pb-2">
          <h2 class="text-sm font-semibold">{{ t('settings.pluginsHub.available') }}</h2>
        </div>

        <div v-if="catalogItems.length" class="grid gap-3 lg:grid-cols-2">
          <article
            v-for="item in catalogItems"
            :key="item.id"
            class="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background p-3"
          >
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40"
            >
              <Icon :icon="item.icon" class="size-6" :class="item.iconClass" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <h3 class="truncate text-sm font-semibold">{{ item.title }}</h3>
                <span
                  v-if="item.badge"
                  class="shrink-0 rounded-full border px-2 py-0.5 text-[11px]"
                  :class="
                    item.enabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-border text-muted-foreground'
                  "
                >
                  {{ item.badge }}
                </span>
              </div>
              <p class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                {{ item.description }}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              :disabled="isPending(item.id)"
              @click="handleCatalogAction(item)"
            >
              {{ item.actionLabel }}
            </Button>
          </article>
        </div>
        <div
          v-else
          class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          {{ t('settings.pluginsHub.emptySearch') }}
        </div>
      </section>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createPluginClient } from '@api/PluginClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import type { PluginActionResult, PluginListItem } from '@shared/types/plugin'
import type { RemoteChannel, RemoteChannelDescriptor, RemoteChannelStatus } from '@shared/presenter'
import AgentExtensionPolicyPanel from './AgentExtensionPolicyPanel.vue'

type CatalogItem = {
  id: string
  kind: 'official' | 'remote'
  plugin?: PluginListItem
  channel?: RemoteChannel
  enabled: boolean
  title: string
  description: string
  badge?: string
  icon: string
  iconClass?: string
  actionLabel: string
}

const fallbackRemoteChannels: RemoteChannelDescriptor[] = [
  {
    id: 'telegram',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.telegram.title',
    descriptionKey: 'settings.remote.telegram.description',
    supportsPairing: true,
    supportsNotifications: true
  },
  {
    id: 'feishu',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.feishu.title',
    descriptionKey: 'settings.remote.feishu.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'qqbot',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.qqbot.title',
    descriptionKey: 'settings.remote.qqbot.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'discord',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.discord.title',
    descriptionKey: 'settings.remote.discord.description',
    supportsPairing: true,
    supportsNotifications: false
  },
  {
    id: 'weixin-ilink',
    type: 'builtin',
    implemented: true,
    titleKey: 'settings.remote.weixinIlink.title',
    descriptionKey: 'settings.remote.weixinIlink.description',
    supportsPairing: false,
    supportsNotifications: false
  }
]

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
const FEISHU_PLUGIN_ID = 'com.deepchat.plugins.feishu'
const CUA_PLUGIN_ID = 'com.deepchat.plugins.cua'
const CUA_PLUGIN_ICON = 'lucide:laptop-minimal-check'
const remotePluginId = (channel: RemoteChannel): string => `remote:${channel}`
const isFeishuOfficialPlugin = (plugin: PluginListItem): boolean => plugin.id === FEISHU_PLUGIN_ID
const pluginIcon = (plugin: PluginListItem): string =>
  isFeishuOfficialPlugin(plugin)
    ? remoteIconByChannel.feishu
    : plugin.id === CUA_PLUGIN_ID
      ? CUA_PLUGIN_ICON
      : 'lucide:puzzle'

const { t } = useI18n()
const router = useRouter()
const pluginClient = createPluginClient()
const remoteControlClient = createRemoteControlClient()

const plugins = ref<PluginListItem[]>([])
const remoteChannels = ref<RemoteChannelDescriptor[]>(fallbackRemoteChannels)
const remoteStatuses = ref<Partial<Record<RemoteChannel, RemoteChannelStatus | null>>>({})
const loading = ref(false)
const errorMessage = ref('')
const pendingItemId = ref<string | null>(null)

const isPending = (itemId: string) => pendingItemId.value === itemId
const pluginTitle = (plugin: PluginListItem): string =>
  isFeishuOfficialPlugin(plugin) ? t('settings.remote.feishu.title') : plugin.name
const pluginDescription = (plugin: PluginListItem): string => {
  if (isFeishuOfficialPlugin(plugin)) {
    return t('settings.remote.feishu.description')
  }
  return plugin.id === CUA_PLUGIN_ID ? t('settings.pluginsHub.cuaDescription') : plugin.publisher
}
const officialPluginEnabled = (plugin: PluginListItem): boolean =>
  plugin.enabled ||
  (isFeishuOfficialPlugin(plugin) && Boolean(remoteStatuses.value.feishu?.enabled))

const implementedRemoteChannels = computed(() =>
  remoteChannels.value.filter((channel) => channel.implemented)
)
const hasFeishuOfficialPlugin = computed(() => plugins.value.some(isFeishuOfficialPlugin))

const catalogItems = computed<CatalogItem[]>(() => {
  const officialItems = plugins.value.map((plugin) => {
    const enabled = officialPluginEnabled(plugin)
    return {
      id: `official:${plugin.id}`,
      kind: 'official' as const,
      plugin,
      enabled,
      title: pluginTitle(plugin),
      description: pluginDescription(plugin),
      badge: enabled ? t('settings.plugins.status.enabled') : t('settings.plugins.status.disabled'),
      icon: pluginIcon(plugin),
      iconClass: isFeishuOfficialPlugin(plugin) ? remoteIconClassByChannel.feishu : undefined,
      actionLabel: enabled ? t('settings.pluginsHub.manage') : t('settings.pluginsHub.add')
    }
  })

  const remoteItems = implementedRemoteChannels.value
    .filter((channel) => channel.id !== 'feishu' || !hasFeishuOfficialPlugin.value)
    .map((channel) => {
      const status = remoteStatuses.value[channel.id]
      const enabled = Boolean(status?.enabled)
      return {
        id: `remote:${channel.id}`,
        kind: 'remote' as const,
        channel: channel.id,
        enabled,
        title: t(channel.titleKey),
        description: t(channel.descriptionKey),
        badge: enabled
          ? t('settings.plugins.status.enabled')
          : t('settings.plugins.status.disabled'),
        icon: remoteIconByChannel[channel.id],
        iconClass: remoteIconClassByChannel[channel.id],
        actionLabel: enabled ? t('settings.pluginsHub.manage') : t('settings.pluginsHub.add')
      }
    })

  return [...officialItems, ...remoteItems].sort((left, right) => {
    if (left.enabled === right.enabled) {
      return 0
    }
    return left.enabled ? -1 : 1
  })
})

async function loadCatalog(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const [pluginItems, channels] = await Promise.all([
      pluginClient.listPlugins(),
      remoteControlClient.listRemoteChannels().catch(() => fallbackRemoteChannels)
    ])
    plugins.value = pluginItems
    remoteChannels.value = channels ?? fallbackRemoteChannels
    await loadRemoteStatuses()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.loadFailed')
  } finally {
    loading.value = false
  }
}

async function loadRemoteStatuses(): Promise<void> {
  const entries = await Promise.all(
    implementedRemoteChannels.value.map(async (channel) => [
      channel.id,
      await remoteControlClient.getChannelStatus(channel.id).catch(() => null)
    ])
  )
  remoteStatuses.value = Object.fromEntries(entries)
}

async function runPluginAction(
  itemId: string,
  action: () => Promise<PluginActionResult>
): Promise<void> {
  pendingItemId.value = itemId
  errorMessage.value = ''
  try {
    const result = await action()
    if (!result.ok) {
      throw new Error(result.error || t('settings.plugins.actionFailed'))
    }
    await loadCatalog()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.actionFailed')
  } finally {
    pendingItemId.value = null
  }
}

function handleCatalogAction(item: CatalogItem): void {
  if (item.kind === 'official' && item.plugin) {
    const plugin = item.plugin
    if (item.enabled || isFeishuOfficialPlugin(plugin)) {
      void router.push({ name: 'plugins-detail', params: { pluginId: plugin.id } })
    } else {
      void runPluginAction(item.id, () => pluginClient.enablePlugin(plugin.id))
    }
    return
  }

  if (item.kind === 'remote' && item.channel) {
    void router.push({ name: 'plugins-detail', params: { pluginId: remotePluginId(item.channel) } })
    return
  }
}

onMounted(() => {
  void loadCatalog()
})
</script>
