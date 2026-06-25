<template>
  <ScrollArea class="h-full w-full">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
      <header class="space-y-4">
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold tracking-normal">{{ t('routes.plugins') }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ t('settings.pluginsHub.subtitle') }}
          </p>
        </div>

        <div class="flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search"
              class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="searchQuery"
              class="h-10 rounded-xl pl-9"
              :placeholder="t('settings.pluginsHub.searchPlaceholder')"
            />
          </div>
          <Button variant="outline" size="icon" :disabled="loading" @click="loadCatalog">
            <Icon icon="lucide:refresh-cw" class="size-4" :class="loading ? 'animate-spin' : ''" />
          </Button>
        </div>
      </header>

      <div
        v-if="errorMessage"
        class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
      >
        {{ errorMessage }}
      </div>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
          <h2 class="text-sm font-semibold">{{ t('settings.pluginsHub.added') }}</h2>
          <RouterLink
            :to="{ name: 'plugins-mcp' }"
            class="text-sm text-muted-foreground hover:text-foreground"
          >
            {{ t('settings.pluginsHub.manage') }}
          </RouterLink>
        </div>

        <div v-if="addedItems.length" class="flex flex-wrap gap-3">
          <button
            v-for="item in addedItems"
            :key="item.id"
            type="button"
            class="flex size-12 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-muted"
            :title="item.title"
            @click="openAddedItem(item)"
          >
            <Icon :icon="item.icon" class="size-6" :class="item.iconClass" />
          </button>
        </div>
        <div v-else class="text-sm text-muted-foreground">
          {{ t('settings.pluginsHub.noAdded') }}
        </div>
      </section>

      <section class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="filter in filters"
            :key="filter.key"
            size="sm"
            :variant="activeFilter === filter.key ? 'default' : 'ghost'"
            class="rounded-lg"
            @click="activeFilter = filter.key"
          >
            {{ t(filter.titleKey) }}
          </Button>
        </div>

        <div v-if="filteredCatalogItems.length" class="grid gap-3 lg:grid-cols-2">
          <article
            v-for="item in filteredCatalogItems"
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
                  class="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
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
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createPluginClient } from '@api/PluginClient'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import type { PluginActionResult, PluginListItem } from '@shared/types/plugin'
import type { RemoteChannel, RemoteChannelDescriptor, RemoteChannelStatus } from '@shared/presenter'

type CatalogFilter = 'official' | 'workspace' | 'personal'
type AddedItem = {
  id: string
  kind: 'official' | 'remote'
  pluginId?: string
  channel?: RemoteChannel
  title: string
  icon: string
  iconClass?: string
}
type CatalogItem = {
  id: string
  kind: 'official' | 'remote' | 'built-in'
  plugin?: PluginListItem
  channel?: RemoteChannel
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

const filters: Array<{ key: CatalogFilter; titleKey: string }> = [
  { key: 'official', titleKey: 'settings.pluginsHub.filters.official' },
  { key: 'workspace', titleKey: 'settings.pluginsHub.filters.workspace' },
  { key: 'personal', titleKey: 'settings.pluginsHub.filters.personal' }
]

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
const searchQuery = ref('')
const activeFilter = ref<CatalogFilter>('official')

const isPending = (itemId: string) => pendingItemId.value === itemId

const implementedRemoteChannels = computed(() =>
  remoteChannels.value.filter((channel) => channel.implemented)
)

const addedItems = computed<AddedItem[]>(() => {
  const officialItems = plugins.value
    .filter((plugin) => plugin.enabled)
    .map((plugin) => ({
      id: `official:${plugin.id}`,
      kind: 'official' as const,
      pluginId: plugin.id,
      title: plugin.name,
      icon: 'lucide:puzzle',
      iconClass: 'text-foreground'
    }))

  const remoteItems = implementedRemoteChannels.value
    .filter((channel) => remoteStatuses.value[channel.id]?.enabled)
    .map((channel) => ({
      id: `remote:${channel.id}`,
      kind: 'remote' as const,
      channel: channel.id,
      title: t(channel.titleKey),
      icon: remoteIconByChannel[channel.id],
      iconClass: remoteIconClassByChannel[channel.id]
    }))

  return [...officialItems, ...remoteItems]
})

const catalogItems = computed<CatalogItem[]>(() => {
  const officialItems = plugins.value.map((plugin) => ({
    id: `official:${plugin.id}`,
    kind: 'official' as const,
    plugin,
    title: plugin.name,
    description: plugin.publisher,
    badge: plugin.enabled
      ? t('settings.plugins.status.enabled')
      : t('settings.plugins.status.disabled'),
    icon: 'lucide:puzzle',
    actionLabel: plugin.enabled ? t('settings.pluginsHub.manage') : t('settings.plugins.enable')
  }))

  const remoteItems = implementedRemoteChannels.value.map((channel) => {
    const status = remoteStatuses.value[channel.id]
    return {
      id: `remote:${channel.id}`,
      kind: 'remote' as const,
      channel: channel.id,
      title: t(channel.titleKey),
      description: t(channel.descriptionKey),
      badge:
        status?.enabled && status.state
          ? t(`chat.sidebar.remoteControlStatus.${status.state}`)
          : t('chat.sidebar.remoteControlDisabled'),
      icon: remoteIconByChannel[channel.id],
      iconClass: remoteIconClassByChannel[channel.id],
      actionLabel: t('settings.pluginsHub.manage')
    }
  })

  const builtInItems: CatalogItem[] = [
    {
      id: 'built-in:mcp',
      kind: 'built-in',
      title: t('routes.settings-mcp'),
      description: t('settings.pluginsHub.mcpDescription'),
      icon: 'lucide:server',
      actionLabel: t('settings.pluginsHub.manage')
    },
    {
      id: 'built-in:skills',
      kind: 'built-in',
      title: t('routes.settings-skills'),
      description: t('settings.pluginsHub.skillsDescription'),
      icon: 'lucide:wand-sparkles',
      actionLabel: t('settings.pluginsHub.manage')
    }
  ]

  return [...builtInItems, ...officialItems, ...remoteItems]
})

const filteredCatalogItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const sourceItems =
    activeFilter.value === 'official'
      ? catalogItems.value
      : activeFilter.value === 'workspace'
        ? []
        : []

  if (!query) {
    return sourceItems
  }

  return sourceItems.filter((item) =>
    [item.title, item.description, item.badge].some((value) => value?.toLowerCase().includes(query))
  )
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

function openAddedItem(item: AddedItem): void {
  if (item.kind === 'official' && item.pluginId) {
    void router.push({ name: 'plugins-official-detail', params: { pluginId: item.pluginId } })
    return
  }
  if (item.kind === 'remote' && item.channel) {
    void router.push({ name: 'plugins-remote-detail', params: { channel: item.channel } })
  }
}

function handleCatalogAction(item: CatalogItem): void {
  if (item.kind === 'official' && item.plugin) {
    const plugin = item.plugin
    if (item.plugin.enabled) {
      void router.push({ name: 'plugins-official-detail', params: { pluginId: plugin.id } })
    } else {
      void runPluginAction(item.id, () => pluginClient.enablePlugin(plugin.id))
    }
    return
  }

  if (item.kind === 'remote' && item.channel) {
    void router.push({ name: 'plugins-remote-detail', params: { channel: item.channel } })
    return
  }

  if (item.id === 'built-in:mcp') {
    void router.push({ name: 'plugins-mcp' })
    return
  }

  if (item.id === 'built-in:skills') {
    void router.push({ name: 'plugins-skills' })
  }
}

onMounted(() => {
  void loadCatalog()
})
</script>
