<template>
  <SettingsPageShell
    data-testid="settings-overview-page"
    :title="t('settings.controlCenter.overview.title')"
    :description="t('settings.controlCenter.overview.description')"
  >
    <InputGroup>
      <InputGroupAddon>
        <Icon icon="lucide:search" class="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        v-model="searchQuery"
        :placeholder="t('settings.controlCenter.overview.searchPlaceholder')"
        @keydown.enter="openFirstSearchResult"
      />
    </InputGroup>

    <div
      v-if="searchResults.length > 0"
      class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="settings-overview-search-results"
    >
      <Button
        v-for="item in searchResults"
        :key="item.routeName"
        variant="outline"
        class="justify-start"
        @click="openRoute(item.routeName)"
      >
        <Icon :icon="item.icon" class="size-4" />
        <span class="truncate">{{ t(item.titleKey) }}</span>
      </Button>
    </div>

    <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatusMetricCard
        :label="t('settings.controlCenter.overview.providers')"
        :value="t('settings.controlCenter.overview.enabledCount', { count: enabledProvidersCount })"
        icon="lucide:cloud-cog"
        :description="t('settings.controlCenter.overview.providersDescription')"
      />
      <StatusMetricCard
        :label="t('settings.controlCenter.overview.mcp')"
        :value="t('settings.controlCenter.overview.runningCount', { count: runningMcpCount })"
        icon="lucide:server"
        :description="
          mcpEnabled
            ? t('settings.controlCenter.overview.mcpOn')
            : t('settings.controlCenter.overview.mcpOff')
        "
      />
      <StatusMetricCard
        :label="t('settings.controlCenter.overview.knowledge')"
        :value="t('settings.controlCenter.overview.sourceCount', { count: knowledgeSourceCount })"
        icon="lucide:book-marked"
        :description="t('settings.controlCenter.overview.knowledgeDescription')"
      />
      <StatusMetricCard
        :label="t('settings.controlCenter.overview.data')"
        :value="lastBackupText"
        icon="lucide:database-backup"
        :description="
          syncEnabled
            ? t('settings.controlCenter.overview.syncOn')
            : t('settings.controlCenter.overview.syncOff')
        "
      />
    </section>

    <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <SettingsSectionCard :title="t('settings.controlCenter.quickStart.title')">
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="task in quickTasks"
            :key="task.key"
            type="button"
            class="flex min-w-0 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-start hover:bg-accent"
            @click="openRoute(task.routeName)"
          >
            <Icon
              :icon="task.done ? 'lucide:check-circle-2' : task.icon"
              class="size-4 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{{ t(task.labelKey) }}</div>
              <div class="truncate text-xs text-muted-foreground">
                {{ t(task.descriptionKey) }}
              </div>
            </div>
          </button>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard :title="t('settings.controlCenter.needsAttention.title')">
        <div v-if="attentionItems.length" class="flex flex-col gap-2">
          <button
            v-for="item in attentionItems"
            :key="item.key"
            type="button"
            class="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-start hover:bg-accent"
            @click="openRoute(item.routeName)"
          >
            <Badge variant="secondary" class="shrink-0">{{ item.category }}</Badge>
            <span class="min-w-0 truncate text-sm">{{ t(item.labelKey) }}</span>
          </button>
        </div>
        <Empty v-else>
          <EmptyHeader>
            <EmptyTitle>{{ t('settings.controlCenter.needsAttention.empty') }}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </SettingsSectionCard>
    </section>

    <SettingsSectionCard
      :title="t('settings.controlCenter.activity.title')"
      :description="t('settings.controlCenter.activity.description')"
    >
      <Table v-if="activities.length">
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('settings.controlCenter.activity.when') }}</TableHead>
            <TableHead>{{ t('settings.controlCenter.activity.category') }}</TableHead>
            <TableHead>{{ t('settings.controlCenter.activity.change') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="activity in activities"
            :key="activity.id"
            class="cursor-pointer"
            @click="openActivity(activity)"
          >
            <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
              {{ formatDate(activity.createdAt) }}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{{ activity.category }}</Badge>
            </TableCell>
            <TableCell class="min-w-0">
              <span class="line-clamp-2 text-sm">
                {{ t(activity.summaryKey, activity.summaryParams) }}
              </span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Empty v-else>
        <EmptyHeader>
          <EmptyTitle>{{ t('settings.controlCenter.activity.empty') }}</EmptyTitle>
          <EmptyDescription>
            {{ t('settings.controlCenter.activity.emptyDescription') }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SettingsSectionCard>

    <section
      ref="usageDashboardRef"
      data-testid="settings-overview-usage-dashboard"
      class="min-h-[640px] overflow-hidden rounded-lg border border-border"
    >
      <DashboardSettings />
    </section>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shadcn/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@shadcn/components/ui/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@shadcn/components/ui/table'
import { createConfigClient } from '@api/ConfigClient'
import { createSettingsClient } from '@api/SettingsClient'
import type { SettingsActivityRecord } from '@shared/contracts/routes'
import {
  getSettingsNavigationItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'
import type { SettingsNavigationItem } from '@shared/settingsNavigation'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useMcpStore } from '@/stores/mcp'
import { useSyncStore } from '@/stores/sync'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import SettingsSectionCard from './control-center/SettingsSectionCard.vue'
import StatusMetricCard from './control-center/StatusMetricCard.vue'
import DashboardSettings from './DashboardSettings.vue'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const configClient = createConfigClient()
const settingsClient = createSettingsClient()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const mcpStore = useMcpStore()
const syncStore = useSyncStore()
const uiSettingsStore = useUiSettingsStore()

const activities = ref<SettingsActivityRecord[]>([])
const searchQuery = ref('')
const knowledgeSourceCount = ref(0)
const usageDashboardRef = ref<HTMLElement | null>(null)
const settingsItems = getSettingsNavigationItems(window.electron?.process?.platform)
type SettingsRouteName = SettingsNavigationItem['routeName']

const enabledProvidersCount = computed(
  () =>
    providerStore.providers.filter((provider) => provider.id !== 'acp' && provider.enable).length
)

const enabledModelsCount = computed(() =>
  modelStore.enabledModels.reduce((count, group) => count + group.models.length, 0)
)

const mcpEnabled = computed(() => mcpStore.mcpEnabled)
const runningMcpCount = computed(
  () => mcpStore.serverList.filter((server) => server.isRunning).length
)
const syncEnabled = computed(() => syncStore.syncEnabled)

const lastBackupText = computed(() => {
  if (!syncStore.lastSyncTime) {
    return t('settings.controlCenter.overview.backupNever')
  }

  return new Intl.DateTimeFormat(locale.value || undefined, {
    dateStyle: 'medium'
  }).format(new Date(syncStore.lastSyncTime))
})

const quickTasks = computed<
  Array<{
    key: string
    labelKey: string
    descriptionKey: string
    routeName: SettingsRouteName
    icon: string
    done: boolean
  }>
>(() => [
  {
    key: 'api-key',
    labelKey: 'settings.controlCenter.quickStart.addApiKey',
    descriptionKey: 'settings.controlCenter.quickStart.addApiKeyDesc',
    routeName: 'settings-provider',
    icon: 'lucide:key-round',
    done: providerStore.providers.some((provider) => provider.id !== 'acp' && provider.apiKey)
  },
  {
    key: 'enable-model',
    labelKey: 'settings.controlCenter.quickStart.enableModel',
    descriptionKey: 'settings.controlCenter.quickStart.enableModelDesc',
    routeName: 'settings-provider',
    icon: 'lucide:box',
    done: enabledModelsCount.value > 0
  },
  {
    key: 'start-mcp',
    labelKey: 'settings.controlCenter.quickStart.startMcp',
    descriptionKey: 'settings.controlCenter.quickStart.startMcpDesc',
    routeName: 'settings-mcp',
    icon: 'lucide:server',
    done: runningMcpCount.value > 0
  },
  {
    key: 'backup',
    labelKey: 'settings.controlCenter.quickStart.backupNow',
    descriptionKey: 'settings.controlCenter.quickStart.backupNowDesc',
    routeName: 'settings-database',
    icon: 'lucide:database-backup',
    done: Boolean(syncStore.lastSyncTime)
  }
])

const attentionItems = computed(() => {
  const items: Array<{
    key: string
    labelKey: string
    category: string
    routeName: SettingsRouteName
  }> = []

  if (enabledModelsCount.value === 0) {
    items.push({
      key: 'models',
      labelKey: 'settings.controlCenter.needsAttention.noModels',
      category: 'Models',
      routeName: 'settings-provider'
    })
  }
  if (!uiSettingsStore.privacyModeEnabled) {
    items.push({
      key: 'privacy',
      labelKey: 'settings.controlCenter.needsAttention.privacyOff',
      category: 'Data',
      routeName: 'settings-database'
    })
  }
  if (!syncStore.lastSyncTime) {
    items.push({
      key: 'backup',
      labelKey: 'settings.controlCenter.needsAttention.backupNever',
      category: 'Data',
      routeName: 'settings-database'
    })
  }

  return items
})

const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return []
  }

  return settingsItems
    .filter((item) => {
      const title = t(item.titleKey).toLowerCase()
      return (
        title.includes(query) ||
        item.keywords.some((keyword) => keyword.toLowerCase().includes(query))
      )
    })
    .slice(0, 8)
})

const openRoute = (routeName: SettingsRouteName) => {
  void router.push(resolveSettingsNavigationPath(routeName))
}

const openActivity = (activity: SettingsActivityRecord) => {
  if (!activity.routeName) {
    return
  }

  void router.push({
    name: activity.routeName,
    params: activity.routeParams
  })
}

const openFirstSearchResult = () => {
  const first = searchResults.value[0]
  if (first) {
    openRoute(first.routeName)
  }
}

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(locale.value || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp))

onMounted(async () => {
  const [knowledgeResult] = await Promise.allSettled([
    configClient.getKnowledgeConfigs(),
    providerStore.ensureInitialized?.(),
    modelStore.initialize?.(),
    mcpStore.loadConfig?.(),
    syncStore.initialize?.()
  ])
  if (knowledgeResult.status === 'fulfilled') {
    knowledgeSourceCount.value = knowledgeResult.value.filter((config) => config.enabled).length
  }
  activities.value = await settingsClient.listRecentActivity(200)
  await nextTick()
  if (route.query.section === 'usage') {
    usageDashboardRef.value?.scrollIntoView({ block: 'start' })
  }
})
</script>
