<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useMcpStore } from '@/stores/mcp'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { useLanguageStore } from '@/stores/language'
import { useAgentMcpData } from '@/components/chat-input/composables/useAgentMcpData'

const { t } = useI18n()
const mcpStore = useMcpStore()
const langStore = useLanguageStore()
const { tools: scopedTools } = useAgentMcpData()
const open = ref(false)

// 计算属性
const isLoading = computed(() => mcpStore.toolsLoading)
const isError = computed(() => mcpStore.toolsError)
const errorMessage = computed(() => mcpStore.toolsErrorMessage)
const hasTools = computed(() => scopedTools.value.length > 0)

// All tools are enabled by default (chatConfig removed in Phase 6)
const visibleServers = computed(() => {
  return mcpStore.serverList
})

const getTools = (serverName: string) => {
  return scopedTools.value.filter((tool) => tool.server.name === serverName)
}

// Get tool count for each server (all tools enabled)
const getEnabledToolCountByServer = (serverName: string) => {
  const serverTools = scopedTools.value.filter((tool) => tool.server.name === serverName)
  return serverTools.length
}

// Get total enabled tool count (all tools enabled)
const getTotalEnabledToolCount = () => {
  return scopedTools.value.length
}

// Toggle server functionality removed - all servers enabled by default

// 获取内置服务器的本地化名称和描述
const getLocalizedServerName = (serverName: string) => {
  const key = `mcp.servers.${serverName}.name` as const
  const hasKey = t(key) !== key
  return hasKey ? t(key) : serverName
}
</script>

<template>
  <div v-if="hasTools" class="flex items-center gap-2">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          :disabled="isLoading"
        >
          <Icon icon="lucide:plug-zap" class="w-4 h-4" />
          <span class="ml-1">{{ t('mcp.title') }}</span>
          <Badge variant="secondary" class="ml-1 px-1 py-0 text-[10px]">
            {{ getTotalEnabledToolCount() }}
          </Badge>
          <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
        <div
          class="rounded-lg border bg-card p-1 shadow-md max-h-96 overflow-y-auto"
          :dir="langStore.dir"
        >
          <!-- Loading State -->
          <div v-if="isLoading" class="flex items-center justify-center py-8">
            <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
          </div>

          <!-- Error State -->
          <div v-else-if="isError" class="flex flex-col items-center py-8 px-4 text-center">
            <Icon icon="lucide:alert-circle" class="w-8 h-8 text-destructive mb-2" />
            <p class="text-sm text-muted-foreground">{{ errorMessage }}</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="!hasTools" class="flex flex-col items-center py-8 px-4 text-center">
            <Icon icon="lucide:plug-zap" class="w-8 h-8 text-muted-foreground mb-2" />
            <p class="text-sm text-muted-foreground">{{ t('mcp.empty') }}</p>
          </div>

          <!-- Tools List (Display Only - Phase 6: All tools enabled by default) -->
          <div v-else class="flex flex-col">
            <div
              v-for="server in visibleServers"
              :key="server.name"
              class="flex flex-col gap-1 p-2 hover:bg-muted/50 rounded-md transition-colors"
            >
              <!-- Server Header -->
              <div class="flex items-center gap-2">
                <Icon
                  :icon="server.type === 'inmemory' ? 'lucide:cpu' : 'lucide:server'"
                  class="w-4 h-4 text-muted-foreground"
                />
                <span class="flex-1 text-sm font-medium">
                  {{ getLocalizedServerName(server.name) }}
                </span>
                <Badge variant="outline" class="text-[10px]">
                  {{ getEnabledToolCountByServer(server.name) }}
                </Badge>
              </div>

              <!-- Tools for this server -->
              <div class="ml-6 flex flex-col gap-1">
                <div
                  v-for="tool in getTools(server.name)"
                  :key="tool.function.name"
                  class="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Icon icon="lucide:wrench" class="w-3 h-3" />
                  <span class="truncate flex-1">{{ tool.function.name }}</span>
                  <Badge variant="secondary" class="text-[10px]">Enabled</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>

<style scoped>
/* Custom scrollbar for tools list */
:deep(.max-h-96) {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted)) transparent;
}

:deep(.max-h-96::-webkit-scrollbar) {
  width: 6px;
}

:deep(.max-h-96::-webkit-scrollbar-track) {
  background: transparent;
}

:deep(.max-h-96::-webkit-scrollbar-thumb) {
  background-color: hsl(var(--muted));
  border-radius: 3px;
}
</style>
