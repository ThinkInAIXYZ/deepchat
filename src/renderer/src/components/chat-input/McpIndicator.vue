<template>
  <Popover v-if="mcpEnabled" v-model:open="panelOpen">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
        :title="t('chat.input.mcp.title')"
        :aria-label="t('chat.input.mcp.title')"
      >
        <span>{{ t('chat.input.mcp.badge', { count: enabledServerCount }) }}</span>
        <Icon icon="lucide:chevron-down" class="h-3 w-3" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-72 p-0">
      <div class="border-b px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-medium">
            {{ t('chat.input.mcp.title') }}
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-muted-foreground"
            :title="t('chat.input.mcp.openSettings')"
            :aria-label="t('chat.input.mcp.openSettings')"
            @click="openSettings"
          >
            <Icon icon="lucide:settings-2" class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div v-if="enabledServers.length === 0" class="px-3 py-4 text-xs text-muted-foreground">
        {{ t('chat.input.mcp.empty') }}
      </div>

      <div v-else class="max-h-64 space-y-1 overflow-y-auto px-2 py-2">
        <div
          v-for="server in enabledServers"
          :key="server.name"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
        >
          <span class="shrink-0">{{ server.icons }}</span>
          <span class="min-w-0 flex-1 truncate" :title="getServerLabel(server.name)">
            {{ getServerLabel(server.name) }}
          </span>
          <span class="shrink-0 text-muted-foreground">
            {{ getServerToolsCount(server.name) }}
          </span>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { SETTINGS_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { useMcpStore } from '@/stores/mcp'

const { t } = useI18n()
const mcpStore = useMcpStore()
const windowPresenter = usePresenter('windowPresenter')
const panelOpen = ref(false)

const mcpEnabled = computed(() => mcpStore.mcpEnabled)
const enabledServers = computed(() => mcpStore.enabledServers)
const enabledServerCount = computed(() => mcpStore.enabledServerCount)

const getServerLabel = (serverName: string) => {
  return t(`mcp.inmemory.${serverName}.name`, serverName)
}

const getServerToolsCount = (serverName: string) => {
  return mcpStore.tools.filter((tool) => tool.server.name === serverName).length
}

const navigateToMcpSettings = (windowId: number) => {
  windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
    routeName: 'settings-mcp'
  })
}

const openSettings = async () => {
  await windowPresenter.createSettingsWindow()
  const settingsWindowId = windowPresenter.getSettingsWindowId()
  if (settingsWindowId != null) {
    navigateToMcpSettings(settingsWindowId)
    window.setTimeout(() => {
      if (windowPresenter.getSettingsWindowId() === settingsWindowId) {
        navigateToMcpSettings(settingsWindowId)
      }
    }, 250)
  }
  panelOpen.value = false
}
</script>
