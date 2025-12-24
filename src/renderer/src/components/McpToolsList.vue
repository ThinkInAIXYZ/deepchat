<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useMcpStore } from '@/stores/mcp'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Badge } from '@shadcn/components/ui/badge'
import { useLanguageStore } from '@/stores/language'
import { useChatStore } from '@/stores/chat'
import { useToast } from '@/components/use-toast'
import { useAgentMcpData } from '@/components/chat-input/composables/useAgentMcpData'

const { t } = useI18n()
const mcpStore = useMcpStore()
const langStore = useLanguageStore()
const chatStore = useChatStore()
const { toast } = useToast()
const { tools: scopedTools } = useAgentMcpData()

// 计算属性
const isLoading = computed(() => mcpStore.toolsLoading)
const isError = computed(() => mcpStore.toolsError)
const errorMessage = computed(() => mcpStore.toolsErrorMessage)
const hasTools = computed(() => scopedTools.value.length > 0)
const mcpEnabled = computed(() => mcpStore.mcpEnabled)
const isReadOnly = computed(() => chatStore.isAcpMode)
const effectiveMcpEnabled = computed(() => (isReadOnly.value ? true : mcpEnabled.value))
const selectedServerCount = computed(() => chatStore.activeAgentMcpSelections?.length ?? 0)

const visibleServers = computed(() => {
  if (!chatStore.isAcpMode) return mcpStore.serverList
  const selections = chatStore.activeAgentMcpSelections
  if (!selections?.length) return []
  const set = new Set(selections)
  return mcpStore.serverList.filter((server) => server.type !== 'inmemory' && set.has(server.name))
})

// 处理MCP开关状态变化
const handleMcpEnabledChange = async (enabled: boolean) => {
  if (isReadOnly.value) return
  await mcpStore.setMcpEnabled(enabled)
}

const getTools = (serverName: string) => {
  return scopedTools.value.filter((tool) => tool.server.name === serverName)
}

// 获取每个mcp服务的可用工具数量
const getEnabledToolCountByServer = (serverName: string) => {
  const serverTools = scopedTools.value.filter((tool) => tool.server.name === serverName)
  if (isReadOnly.value) {
    return serverTools.length
  }
  if (chatStore.chatConfig.enabledMcpTools) {
    const enabledTools = chatStore.chatConfig.enabledMcpTools
    return serverTools.filter((tool) => enabledTools.includes(tool.function.name)).length
  }
  return serverTools.length
}

// 获取可用工具总数
const getTotalEnabledToolCount = () => {
  if (isReadOnly.value) {
    return scopedTools.value.length
  }
  if (chatStore.chatConfig.enabledMcpTools) {
    const enabledMcpTools = chatStore.chatConfig.enabledMcpTools
    const filterList = scopedTools.value.filter((item) =>
      enabledMcpTools.includes(item.function.name)
    )
    return filterList.length
  }
  return scopedTools.value.length
}

// 处理单个服务开关状态变化
const onServerToggle = async (serverName: string) => {
  if (isReadOnly.value) return
  // 如果正在加载，不处理
  if (mcpStore.serverLoadingStates[serverName]) {
    return
  }

  const success = await mcpStore.toggleServer(serverName)
  if (!success) {
    // 显示错误提示
    toast({
      title: t('common.error.operationFailed'),
      description: t('mcp.errors.toggleServerFailed', { serverName }),
      variant: 'destructive'
    })
  }
}

// 处理单个工具开关状态变化
const handleToolEnabledChange = (isEnabled: boolean, functionName: string) => {
  if (isReadOnly.value) return
  const currentTools = chatStore.chatConfig.enabledMcpTools || []
  const updatedTools = isEnabled
    ? Array.from(new Set([...currentTools, functionName]))
    : currentTools.filter((name) => name !== functionName)
  chatStore.updateChatConfig({ enabledMcpTools: updatedTools })
}

// 获取单个工具开关状态
const isEnabled = (functionName: string): boolean => {
  if (isReadOnly.value) return true
  return chatStore.chatConfig.enabledMcpTools?.includes(functionName) ?? false
}

// 获取内置服务器的本地化名称和描述
const getLocalizedServerName = (serverName: string) => {
  return t(`mcp.inmemory.${serverName}.name`, serverName)
}
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
                'flex text-accent-foreground rounded-lg shadow-sm items-center gap-1.5 h-7 text-xs px-1.5 w-auto',
                mcpEnabled ? 'text-primary' : ''
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

              <span v-if="isReadOnly && selectedServerCount > 0" class="text-sm">{{
                selectedServerCount
              }}</span>
              <span v-else-if="hasTools && !isLoading && !isError" class="text-sm">{{
                getTotalEnabledToolCount()
              }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <template v-if="isReadOnly">
              <p>{{ t('mcp.tools.acpManagedHint') }}</p>
              <p v-if="selectedServerCount > 0">
                {{ t('mcp.tools.acpServersSelected', { count: selectedServerCount }) }}
              </p>
              <p v-else>{{ t('mcp.tools.acpServersNone') }}</p>
            </template>
            <template v-else>
              <p v-if="!mcpEnabled">{{ t('mcp.tools.disabled') }}</p>
              <p v-else-if="isLoading">{{ t('mcp.tools.loading') }}</p>
              <p v-else-if="isError">{{ t('mcp.tools.error') }}</p>
              <p v-else-if="hasTools">
                {{ t('mcp.tools.available', { count: getTotalEnabledToolCount() }) }}
              </p>
              <p v-else>{{ t('mcp.tools.none') }}</p>
            </template>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>

      <PopoverContent class="w-80 p-0" align="start">
        <div v-if="isReadOnly" class="p-2 border-b text-xs text-muted-foreground">
          {{ t('mcp.tools.acpManagedHint') }}
        </div>
        <!-- MCP启用开关 -->
        <div v-if="!isReadOnly" class="p-2 border-b flex items-center justify-between">
          <div>
            <div class="text-sm font-medium" :dir="langStore.dir">{{ t('mcp.tools.enabled') }}</div>
            <div class="text-xs text-muted-foreground" :dir="langStore.dir">
              {{ t('mcp.tools.enabledDescription') }}
            </div>
          </div>
          <Switch
            aria-label="启用MCP"
            :model-value="mcpEnabled"
            @update:model-value="handleMcpEnabledChange"
          />
        </div>

        <div class="max-h-[300px] overflow-y-auto">
          <div v-if="!effectiveMcpEnabled" class="p-2 text-sm text-muted-foreground text-center">
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
            v-if="effectiveMcpEnabled && visibleServers.length === 0"
            class="p-2 text-sm text-muted-foreground text-center"
          >
            {{ isReadOnly ? t('mcp.tools.acpServersNone') : t('mcp.tools.empty') }}
          </div>
          <div v-else-if="effectiveMcpEnabled" class="divide-y">
            <div v-for="server in visibleServers" :key="server.name" class="w-full">
              <div class="p-2 hover:bg-accent flex items-center w-full">
                <div :dir="langStore.dir" class="w-full">
                  <span class="mr-2">{{ server.icons }}</span>
                  <span v-if="server.type === 'inmemory'" class="grow truncate text-left text-sm">{{
                    getLocalizedServerName(server.name)
                  }}</span>
                  <span v-else class="grow truncate text-left text-sm">{{ server.name }}</span>
                </div>
                <Popover v-if="!isReadOnly">
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
                        v-if="!isReadOnly"
                        :model-value="isEnabled(tool.function.name)"
                        @update:model-value="
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

                <Switch
                  v-if="!isReadOnly"
                  :model-value="server.isRunning"
                  :disabled="server.isLoading"
                  @update:model-value="() => onServerToggle(server.name)"
                />
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </TooltipProvider>
</template>
