<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMcpStore } from '@/stores/mcp'
import { Button } from './ui/button'
import { Switch } from './ui/switch'

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

// 生命周期钩子
onMounted(async () => {
  if (mcpEnabled.value) {
    await mcpStore.loadTools()
  }
})
</script>

<template>
  <TooltipProvider>
    <Popover>
      <PopoverTrigger>
        <div class="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                id="mcp-btn"
                variant="outline"
                class="h-7 text-xs rounded-lg p-2"
                :class="{
                  'text-muted-foreground': !mcpEnabled,
                  'text-primary': mcpEnabled
                }"
                :disabled="!mcpEnabled"
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
                  :class="{ 'text-muted-foreground': !mcpEnabled, 'text-primary': mcpEnabled }"
                  class="text-sm hover:text-accent-foreground"
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
        </div>
      </PopoverTrigger>

      <PopoverContent class="w-80 p-0" align="end">
        <div class="p-4 border-b">
          <h3 class="text-sm font-medium">{{ t('mcp.tools.title') }}</h3>
          <p class="text-xs text-muted-foreground mt-1">{{ t('mcp.tools.description') }}</p>
        </div>

        <!-- MCP启用开关 -->
        <div class="p-4 border-b flex items-center justify-between">
          <div>
            <div class="text-sm font-medium">{{ t('mcp.tools.enabled') }}</div>
            <div class="text-xs text-muted-foreground">{{ t('mcp.tools.enabledDescription') }}</div>
          </div>
          <Switch
            :checked="mcpEnabled"
            @update:checked="handleMcpEnabledChange"
            aria-label="启用MCP"
          />
        </div>

        <div class="max-h-[300px] overflow-y-auto">
          <div v-if="!mcpEnabled" class="p-4 text-sm text-muted-foreground text-center">
            {{ t('mcp.tools.enableToUse') }}
          </div>
          <div v-else-if="isLoading" class="flex justify-center items-center py-8">
            <Icon icon="lucide:loader" class="w-6 h-6 animate-spin" />
          </div>
          <div v-else-if="isError" class="p-4 text-sm text-destructive">
            {{ t('mcp.tools.loadError') }}: {{ errorMessage }}
          </div>
          <div v-else-if="tools.length === 0" class="p-4 text-sm text-muted-foreground text-center">
            {{ t('mcp.tools.empty') }}
          </div>
          <div v-else class="divide-y">
            <div v-for="tool in tools" :key="tool.function.name" class="p-3 hover:bg-accent">
              <div class="font-medium text-sm">{{ tool.function.name }}</div>
              <div class="text-xs text-muted-foreground mt-1">{{ tool.function.description }}</div>

              <!-- 参数列表 -->
              <div v-if="tool.function.parameters?.properties" class="mt-2">
                <div class="text-xs font-medium text-muted-foreground mb-1">
                  {{ t('mcp.tools.parameters') }}:
                </div>
                <div class="space-y-1">
                  <div
                    v-for="(param, paramName) in tool.function.parameters.properties"
                    :key="paramName"
                    class="text-xs flex"
                  >
                    <span class="font-mono mr-1">{{ paramName }}</span>
                    <span class="text-muted-foreground">{{ param.description }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </TooltipProvider>
</template>
