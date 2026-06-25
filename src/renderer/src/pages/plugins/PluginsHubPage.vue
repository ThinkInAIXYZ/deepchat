<template>
  <div data-testid="plugins-hub-page" class="flex h-full min-h-0 w-full flex-col bg-background">
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
    </div>

    <div class="min-h-0 flex-1">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const route = useRoute()

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
</script>
