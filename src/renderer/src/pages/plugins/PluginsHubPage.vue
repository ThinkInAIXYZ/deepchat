<template>
  <div data-testid="plugins-hub-page" class="flex h-full min-h-0 w-full flex-col bg-background">
    <template v-if="!isAcpAgent">
      <div class="shrink-0 border-b border-border/70 px-5 py-3">
        <div class="flex min-w-0 items-center justify-between gap-3">
          <nav class="flex min-w-0 items-center gap-1" :aria-label="t('routes.plugins')">
            <RouterLink
              v-for="tab in tabs"
              :key="tab.name"
              :to="{ name: tab.name }"
              class="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors"
              :class="
                activeTab === tab.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              "
            >
              <Icon :icon="tab.icon" class="size-4" />
              <span>{{ t(tab.titleKey) }}</span>
            </RouterLink>
          </nav>
        </div>
        <p
          data-testid="plugins-hub-scope-banner"
          class="mt-2 text-xs leading-5 text-muted-foreground"
        >
          {{ scopeBannerText }}
        </p>
      </div>

      <div class="min-h-0 flex-1">
        <RouterView />
      </div>
    </template>

    <section
      v-else
      data-testid="plugins-acp-unavailable"
      role="status"
      class="flex min-h-0 flex-1 items-center justify-center px-6 py-12"
    >
      <div class="flex max-w-md flex-col items-center text-center">
        <div
          class="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40"
        >
          <Icon icon="lucide:unplug" class="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 class="mt-4 text-xl font-semibold tracking-normal">
          {{ t('settings.pluginsHub.acpUnavailableTitle') }}
        </h1>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {{ t('settings.pluginsHub.acpUnavailableDescription') }}
        </p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useAgentStore } from '@/stores/ui/agent'

const { t } = useI18n()
const route = useRoute()
const agentStore = useAgentStore()

const tabs = [
  {
    key: 'plugins',
    name: 'plugins',
    titleKey: 'routes.plugins',
    icon: 'lucide:puzzle'
  },
  {
    key: 'skills',
    name: 'plugins-skills',
    titleKey: 'routes.settings-skills',
    icon: 'lucide:wand-sparkles'
  },
  {
    key: 'mcp',
    name: 'plugins-mcp',
    titleKey: 'routes.settings-mcp',
    icon: 'lucide:server'
  }
] as const

const activeTab = computed(() => {
  const routeName = String(route.name ?? '')
  if (routeName.includes('skills')) {
    return 'skills'
  }
  if (routeName.includes('mcp')) {
    return 'mcp'
  }
  return 'plugins'
})

const selectedAgentName = computed(() => {
  const agent = agentStore.selectedAgent
  return agent?.name?.trim() || t('settings.pluginsHub.currentAgentFallback')
})

const scopeBannerText = computed(() => {
  if (activeTab.value === 'plugins') {
    return t('settings.pluginsHub.scopeGlobalPlugins')
  }
  return t('settings.pluginsHub.scopeCurrentAgent', { agent: selectedAgentName.value })
})

const isAcpAgent = computed(() => {
  const agent = agentStore.selectedAgent
  return Boolean(agent && (agent.agentType ?? agent.type) === 'acp')
})
</script>
