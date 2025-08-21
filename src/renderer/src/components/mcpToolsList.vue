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
import { useLanguageStore } from '@/stores/language'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()
const mcpStore = useMcpStore()
const langStore = useLanguageStore()
const chatStore = useChatStore()

// 计算属性
const isLoading = computed(() => mcpStore.toolsLoading)
const isError = computed(() => mcpStore.toolsError)
const errorMessage = computed(() => mcpStore.toolsErrorMessage)
const hasTools = computed(() => mcpStore.hasTools)
const mcpEnabled = computed(() => mcpStore.mcpEnabled)

// 处理MCP开关状态变化
const handleMcpEnabledChange = async (enabled: boolean) => {
  await mcpStore.setMcpEnabled(enabled)
}

const getTools = (serverName: string) => {
  return mcpStore.tools.filter((tool) => tool.server.name === serverName)
}

// 获取每个mcp服务的可用工具数量
const getEnabledToolCountByServer = (serverName: string) => {
  const serverTools = mcpStore.tools.filter((tool) => tool.server.name === serverName)
  if (chatStore.chatConfig.enabledMcpTools) {
    const enabledTools = chatStore.chatConfig.enabledMcpTools
    return serverTools.filter((tool) => enabledTools.includes(tool.function.name)).length
  }
  return serverTools.length
}

// 获取可用工具总数
const getTotalEnabledToolCount = () => {
  if (chatStore.chatConfig.enabledMcpTools) {
    const enabledMcpTools = chatStore.chatConfig.enabledMcpTools
    const filterList = mcpStore.tools.filter((item) => enabledMcpTools.includes(item.function.name))
    return filterList.length
  }
  return mcpStore.tools.length
}

// 处理单个服务开关状态变化
const onServerToggle = (serverName: string) => {
  mcpStore.toggleServer(serverName)
}

// 处理单个工具开关状态变化
const handleToolEnabledChange = (isEnabled: boolean, functionName: string) => {
  const currentTools = chatStore.chatConfig.enabledMcpTools || []
  const updatedTools = isEnabled
    ? Array.from(new Set([...currentTools, functionName]))
    : currentTools.filter((name) => name !== functionName)
  chatStore.updateChatConfig({ enabledMcpTools: updatedTools })
}

// 获取单个工具开关状态
const isEnabled = (functionName: string): boolean => {
  return chatStore.chatConfig.enabledMcpTools?.includes(functionName) ?? false
}

// 获取内置服务器的本地化名称和描述
const getLocalizedServerName = (serverName: string) => {
  return t(`mcp.inmemory.${serverName}.name`, serverName)
}
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
                'flex border border-input rounded-lg shadow-sm items-center gap-1.5 h-7 text-xs px-1.5 w-auto',
                mcpEnabled
                  ? 'dark:!bg-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                  : ''
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
                >{{ getTotalEnabledToolCount() }}</span
              >
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p v-if="!mcpEnabled">{{ t('mcp.tools.disabled') }}</p>
            <p v-else-if="isLoading">{{ t('mcp.tools.loading') }}</p>
            <p v-else-if="isError">{{ t('mcp.tools.error') }}</p>
            <p v-else-if="hasTools">
              {{ t('mcp.tools.available', { count: getTotalEnabledToolCount() }) }}
            </p>
            <p v-else>{{ t('mcp.tools.none') }}</p>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>

      <PopoverContent class="w-80 p-0" align="start">
        <!-- MCP启用开关 -->
        <div class="p-2 border-b flex items-center justify-between">
          <div>
            <div class="text-sm font-medium" :dir="langStore.dir">{{ t('mcp.tools.enabled') }}</div>
            <div class="text-xs text-muted-foreground" :dir="langStore.dir">
              {{ t('mcp.tools.enabledDescription') }}
            </div>
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
          <!-- <div v-else-if="isLoading" class="flex justify-center items-center py-8">
            <Icon icon="lucide:loader" class="w-6 h-6 animate-spin" />
          </div>
          <div v-else-if="isError" class="p-2 text-sm text-destructive">
            {{ t('mcp.tools.loadError') }}: {{ errorMessage }}
          </div> -->
          <div v-else-if="isError" class="p-2 text-sm text-destructive">
            {{ t('mcp.tools.loadError') }}: {{ errorMessage }}
          </div>
          <div
            v-if="mcpEnabled && mcpStore.serverList.length === 0"
            class="p-2 text-sm text-muted-foreground text-center"
          >
            {{ t('mcp.tools.empty') }}
          </div>
          <div v-else-if="mcpEnabled" class="divide-y">
            <div v-for="server in mcpStore.serverList" :key="server.name" class="w-full">
              <div class="p-2 hover:bg-accent flex items-center w-full">
                <div :dir="langStore.dir" class="w-full">
                  <span class="mr-2">{{ server.icons }}</span>
                  <span
                    v-if="server.type === 'inmemory'"
                    class="flex-grow truncate text-left text-sm"
                    >{{ getLocalizedServerName(server.name) }}</span
                  >
                  <span v-else class="flex-grow truncate text-left text-sm">{{ server.name }}</span>
                </div>
                <Popover>
                  <PopoverTrigger>
                    <Badge
                      v-if="server.isRunning && !server.isLoading"
                      variant="outline"
                      class="flex items-center gap-1 mr-2 text-xs"
                    >
                      {{ getEnabledToolCountByServer(server.name) }}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="p-2 max-h-[300px] overflow-y-auto">
                    <div
                      v-for="tool in getTools(server.name)"
                      :key="tool.function.name"
                      class="flex justify-between py-1"
                    >
                      <div class="font-medium text-sm">{{ tool.function.name }}</div>
                      <Switch
                        :checked="isEnabled(tool.function.name)"
                        @update:checked="
                          (isEnabled) => handleToolEnabledChange(isEnabled, tool.function.name)
                        "
                      />
                    </div>
                    <div
                      v-if="getTools(server.name).length === 0"
                      class="p-2 text-sm text-muted-foreground text-center"
                    >
                      {{ t('mcp.tools.empty') }}
                    </div>
                  </PopoverContent>
                </Popover>

                <Switch :checked="server.isRunning" @click="onServerToggle(server.name)">
                  <template #thumb>
                    <div class="flex items-center justify-center w-full h-full">
                      <Icon
                        v-if="server.isLoading"
                        icon="lucide:loader-2"
                        class="w-3 h-3 text-muted-foreground animate-spin"
                      />
                    </div>
                  </template>
                </Switch>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </TooltipProvider>
</template>
