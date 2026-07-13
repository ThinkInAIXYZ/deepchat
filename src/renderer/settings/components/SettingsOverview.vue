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
        interactive
        @select="openRoute('settings-provider')"
      />
      <StatusMetricCard
        :label="t('settings.controlCenter.overview.deepchatAgents')"
        :value="
          t('settings.controlCenter.overview.enabledAgentCount', {
            count: enabledDeepChatAgentsCount
          })
        "
        icon="lucide:bot"
        :description="t('settings.controlCenter.overview.deepchatAgentsDescription')"
        interactive
        @select="openRoute('settings-deepchat-agents')"
      />
      <Card class="min-w-0">
        <CardHeader class="gap-2 pb-2">
          <div class="flex items-center justify-between gap-3">
            <CardDescription class="truncate">
              {{ t('settings.controlCenter.quickStart.title') }}
            </CardDescription>
            <Icon icon="lucide:list-checks" class="size-4 shrink-0 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div class="grid gap-1.5">
            <button
              v-for="task in quickTasks"
              :key="task.key"
              type="button"
              class="flex h-8 min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 text-start text-xs transition-colors hover:bg-accent"
              :title="t(task.descriptionKey)"
              @click="openRoute(task.routeName)"
            >
              <Icon
                :icon="task.done ? 'lucide:check-circle-2' : task.icon"
                class="size-4 shrink-0"
                :class="task.done ? 'text-emerald-500' : 'text-muted-foreground'"
              />
              <span class="min-w-0 truncate font-medium">{{ t(task.labelKey) }}</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </section>

    <section
      ref="usageDashboardRef"
      data-testid="settings-overview-usage-dashboard"
      class="min-h-[640px] overflow-hidden rounded-lg border border-border"
    >
      <DashboardSettings />
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
            class=""
            @click="openActivity(activity)"
          >
            <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
              {{ formatDate(activity.createdAt) }}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{{ getActivityCategoryLabel(activity.category) }}</Badge>
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
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@shadcn/components/ui/card'
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
import { createSettingsClient } from '@api/SettingsClient'
import type { SettingsActivityRecord } from '@shared/contracts/routes'
import {
  getSettingsNavigationItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'
import type { SettingsNavigationItem } from '@shared/settingsNavigation'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useSyncStore } from '@/stores/sync'
import { useAgentStore } from '@/stores/ui/agent'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import SettingsSectionCard from './control-center/SettingsSectionCard.vue'
import StatusMetricCard from './control-center/StatusMetricCard.vue'
import DashboardSettings from './DashboardSettings.vue'
import { getRuntimeArch, getRuntimePlatform } from '@api/runtime'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const settingsClient = createSettingsClient()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const syncStore = useSyncStore()
const agentStore = useAgentStore()

const activities = ref<SettingsActivityRecord[]>([])
const searchQuery = ref('')
const usageDashboardRef = ref<HTMLElement | null>(null)
const runtimePlatform = getRuntimePlatform()
const runtimeArch = getRuntimeArch()
const settingsItems = getSettingsNavigationItems(runtimePlatform, runtimeArch)
type SettingsRouteName = SettingsNavigationItem['routeName']

const enabledProvidersCount = computed(
  () =>
    providerStore.providers.filter((provider) => provider.id !== 'acp' && provider.enable).length
)

const enabledModelsCount = computed(() =>
  modelStore.enabledModels.reduce((count, group) => count + group.models.length, 0)
)

const enabledDeepChatAgentsCount = computed(
  () =>
    agentStore.enabledAgents.filter((agent) => (agent.agentType ?? agent.type) === 'deepchat')
      .length
)

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
    key: 'backup',
    labelKey: 'settings.controlCenter.quickStart.backupNow',
    descriptionKey: 'settings.controlCenter.quickStart.backupNowDesc',
    routeName: 'settings-database',
    icon: 'lucide:database-backup',
    done: Boolean(syncStore.lastSyncTime)
  }
])

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
  void router.push(
    resolveSettingsNavigationPath(routeName, undefined, runtimePlatform, runtimeArch)
  )
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

const getActivityCategoryLabel = (category: SettingsActivityRecord['category']) => {
  const labelKeys: Record<SettingsActivityRecord['category'], string> = {
    provider: 'settings.controlCenter.overview.providers',
    model: 'settings.controlCenter.groups.models',
    mcp: 'settings.controlCenter.overview.mcp',
    privacy: 'settings.common.privacyMode',
    appearance: 'routes.settings-display',
    agent: 'settings.controlCenter.groups.models',
    knowledge: 'settings.controlCenter.groups.knowledge',
    prompt: 'routes.settings-prompt',
    shortcut: 'routes.settings-shortcut',
    data: 'settings.data.privacyTitle',
    system: 'settings.controlCenter.groups.system'
  }

  return t(labelKeys[category])
}

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(locale.value || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp))

onMounted(async () => {
  await Promise.allSettled([
    providerStore.ensureInitialized?.(),
    modelStore.initialize?.(),
    syncStore.initialize?.(),
    agentStore.fetchAgents()
  ])
  try {
    activities.value = await settingsClient.listRecentActivity(200)
  } catch (error) {
    console.warn('[SettingsOverview] Failed to load recent settings activity:', error)
    activities.value = []
  }
  await nextTick()
  if (route.query.section === 'usage') {
    usageDashboardRef.value?.scrollIntoView({ block: 'start' })
  }
})
</script>
