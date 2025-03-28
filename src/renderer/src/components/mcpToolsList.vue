<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMcpStore } from '@/stores/mcp'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Badge } from './ui/badge'

const { t } = useI18n()
const mcpStore = useMcpStore()

// 计算属性
const isLoading = computed(() => mcpStore.toolsLoading)
const isError = computed(() => mcpStore.toolsError)
const errorMessage = computed(() => mcpStore.toolsErrorMessage)
const tools = computed(() => mcpStore.tools)
const toolCount = computed(() => mcpStore.toolCount)
const hasTools = computed(() => mcpStore.hasTools)
const mcpEnabled = computed(() => mcpStore.mcpEnabled)

// 处理MCP开关状态变化
const handleMcpEnabledChange = async (enabled: boolean) => {
  await mcpStore.setMcpEnabled(enabled)
}

const clientList = computed(() =>
  mcpStore.clients
    .filter((client) => client.isRunning)
    .map((client) => {
      return {
        name: client.name,
        icon: client.icon,
        tools: client.tools
      }
    })
)

// 生命周期钩子
onMounted(async () => {
  if (mcpEnabled.value) {
    await mcpStore.loadTools()
    await mcpStore.loadClients()
  }
})
</script>

<template>
  <TooltipProvider>
    <Popover>
      <PopoverTrigger>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              id="mcp-btn"
              variant="outline"
              :class="[
                'flex border border-border rounded-lg shadow-sm items-center gap-1.5 h-7 text-xs px-1.5 w-auto',
                mcpEnabled
                  ? 'dark:!bg-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                  : 'text-muted-foreground '
              ]"
              size="icon"
            >
              <Icon v-if="isLoading" icon="lucide:loader" class="w-4 h-4 animate-spin" />
              <Icon
                v-else-if="isError"
                icon="lucide:alert-circle"
                class="w-4 h-4 text-destructive"
              />
              <Icon v-else icon="lucide:hammer" class="w-4 h-4" />

              <span
                v-if="hasTools && !isLoading && !isError"
                :class="{ 'text-muted-foreground': !mcpEnabled, 'text-white': mcpEnabled }"
                class="text-sm"
                >{{ toolCount }}</span
              >
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p v-if="!mcpEnabled">{{ t('mcp.tools.disabled') }}</p>
            <p v-else-if="isLoading">{{ t('mcp.tools.loading') }}</p>
            <p v-else-if="isError">{{ t('mcp.tools.error') }}</p>
            <p v-else-if="hasTools">{{ t('mcp.tools.available', { count: toolCount }) }}</p>
            <p v-else>{{ t('mcp.tools.none') }}</p>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>

      <PopoverContent class="w-80 p-0" align="start">
        <!-- MCP启用开关 -->
        <div class="p-2 border-b flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">{{ t('mcp.tools.enabled') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('mcp.tools.enabledDescription') }}</div>
          </div>
          <Switch
            aria-label="启用MCP"
            :checked="mcpEnabled"
            @update:checked="handleMcpEnabledChange"
          />
        </div>

        <div class="max-h-[300px] overflow-y-auto">
          <div v-if="!mcpEnabled" class="p-2 text-sm text-muted-foreground text-center">
            {{ t('mcp.tools.enableToUse') }}
          </div>
          <div v-else-if="isLoading" class="flex justify-center items-center py-8">
            <Icon icon="lucide:loader" class="w-6 h-6 animate-spin" />
          </div>
          <div v-else-if="isError" class="p-2 text-sm text-destructive">
            {{ t('mcp.tools.loadError') }}: {{ errorMessage }}
          </div>
          <div v-else-if="tools.length === 0" class="p-2 text-sm text-muted-foreground text-center">
            {{ t('mcp.tools.empty') }}
          </div>
          <div v-else class="divide-y">
            <div v-for="server in clientList" :key="server.name" class="w-full">
              <Popover class="w-full">
                <PopoverTrigger class="w-full">
                  <div class="p-2 hover:bg-accent flex items-center w-full">
                    <span class="mr-2">{{ server.icon }}</span
                    ><span class="flex-grow truncate text-left text-sm">{{ server.name }}</span
                    ><Badge variant="outline">{{ server.tools.length }}</Badge>
                  </div>
                </PopoverTrigger>
                <PopoverContent align="start" class="p-2 max-h-[300px] overflow-y-auto">
                  <div v-for="tool in server.tools" :key="tool.function.name" class="py-1">
                    <div class="font-medium text-sm">{{ tool.function.name }}</div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </TooltipProvider>
</template>
