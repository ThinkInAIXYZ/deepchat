<template>
  <Popover v-model:open="panelOpen">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        :class="
          isDeepchatContext
            ? 'h-6 w-6 p-0 text-muted-foreground hover:text-foreground backdrop-blur-lg'
            : 'h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg'
        "
        :title="triggerTitle"
        :aria-label="triggerTitle"
      >
        <template v-if="isDeepchatContext">
          <Icon icon="lucide:sliders-horizontal" class="h-3.5 w-3.5" />
        </template>
        <template v-else>
          <span>{{ triggerLabel }}</span>
          <Icon icon="lucide:chevron-down" class="h-3 w-3" />
        </template>
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-80 overflow-hidden p-0">
      <template v-if="isDeepchatContext">
        <div class="border-b px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-sm font-medium">
              {{ t('chat.advancedSettings.title') }}
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

        <div class="max-h-[24rem] overflow-y-auto">
          <div v-if="showSystemPromptSection" class="border-b px-3 py-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('chat.advancedSettings.systemPrompt') }}
              </div>
              <span v-if="showCustomSystemPromptBadge" class="text-[11px] text-muted-foreground">
                {{ t('chat.advancedSettings.currentCustomPrompt') }}
              </span>
            </div>

            <Select
              :model-value="selectedSystemPromptId"
              @update:model-value="emit('select-system-prompt', $event as string)"
            >
              <SelectTrigger class="mt-3 h-8 text-xs">
                <SelectValue :placeholder="t('chat.advancedSettings.systemPromptPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in systemPromptOptions"
                  :key="option.id"
                  :value="option.id"
                  :disabled="option.disabled"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="border-b px-3 py-3">
            <div
              class="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              <span>{{ t('chat.input.tools.title') }}</span>
            </div>

            <div v-if="toolsLoading" class="text-xs text-muted-foreground">
              {{ t('chat.input.tools.loading') }}
            </div>

            <div
              v-else-if="groupedAgentTools.length === 0"
              class="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
            >
              {{ t('chat.input.tools.builtinEmpty') }}
            </div>

            <div v-else class="space-y-4">
              <div v-for="group in groupedAgentTools" :key="group.name" class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <div
                    class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {{ group.label }}
                  </div>

                  <Switch
                    :model-value="isGroupEnabled(group)"
                    :disabled="isGroupPending(group)"
                    :aria-label="group.label"
                    @update:model-value="(value) => setGroupEnabled(group, value)"
                  />
                </div>

                <div class="flex flex-wrap gap-2">
                  <Button
                    v-for="item in group.items"
                    :key="item.id"
                    variant="outline"
                    size="sm"
                    class="h-7 rounded-md px-2.5 text-xs shadow-none transition-colors"
                    :class="
                      isGroupItemEnabled(item)
                        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                    "
                    :disabled="isGroupItemPending(item)"
                    @click="toggleGroupItem(item)"
                  >
                    {{ item.label }}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div class="px-3 py-3">
            <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {{ t('chat.input.tools.mcpSection') }}
            </div>

            <div
              v-if="enabledServers.length === 0"
              class="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
            >
              {{ t('chat.input.mcp.empty') }}
            </div>

            <div v-else class="space-y-1">
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
          </div>
        </div>
      </template>

      <template v-else>
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
      </template>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import type { MCPToolDefinition } from '@shared/presenter'
import { SETTINGS_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { useMcpStore } from '@/stores/mcp'
import { useSessionStore } from '@/stores/ui/session'
import { useDraftStore } from '@/stores/ui/draft'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'

type ToolGroupItem =
  | {
      kind: 'tool'
      id: string
      label: string
      toolName: string
    }
  | {
      kind: 'subagent'
      id: 'subagent'
      label: string
    }

type ToolGroup = {
  name: string
  label: string
  items: ToolGroupItem[]
}

type SystemPromptMenuOption = {
  id: string
  label: string
  disabled?: boolean
}

const GROUP_ORDER = [
  'agent-filesystem',
  'agent-core',
  'agent-skills',
  'deepchat-settings',
  'yobrowser'
]

const props = withDefaults(
  defineProps<{
    showSystemPromptSection?: boolean
    systemPromptOptions?: SystemPromptMenuOption[]
    selectedSystemPromptId?: string
    showCustomSystemPromptBadge?: boolean
    showSubagentToggle?: boolean
    subagentEnabled?: boolean
    subagentTogglePending?: boolean
  }>(),
  {
    showSystemPromptSection: false,
    systemPromptOptions: () => [],
    selectedSystemPromptId: 'empty',
    showCustomSystemPromptBadge: false,
    showSubagentToggle: false,
    subagentEnabled: false,
    subagentTogglePending: false
  }
)

const emit = defineEmits<{
  (e: 'select-system-prompt', optionId: string): void
  (e: 'open-change', open: boolean): void
  (e: 'toggle-subagents', enabled: boolean): void
}>()

const { t } = useI18n()
const mcpStore = useMcpStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const windowPresenter = usePresenter('windowPresenter')
const toolPresenter = usePresenter('toolPresenter')
const agentSessionPresenter = usePresenter('agentSessionPresenter')

const panelOpen = ref(false)
const toolsLoading = ref(false)
const agentTools = ref<MCPToolDefinition[]>([])
const disabledToolNames = ref<string[]>([])
const pendingToolNames = ref<string[]>([])
let latestLoadToken = 0

const enabledServers = computed(() => mcpStore.enabledServers)
const enabledServerCount = computed(() => mcpStore.enabledServerCount)
const availableAgents = computed(() => (Array.isArray(agentStore.agents) ? agentStore.agents : []))
const resolveAgentType = (agentId: string | null | undefined): 'deepchat' | 'acp' => {
  if (!agentId) {
    return 'deepchat'
  }

  const matchedAgent = availableAgents.value.find((agent) => agent.id === agentId)
  const selectedAgent =
    agentStore.selectedAgent && agentStore.selectedAgent.id === agentId
      ? agentStore.selectedAgent
      : null
  const explicitType = matchedAgent?.agentType ?? matchedAgent?.type ?? selectedAgent?.type
  if (explicitType === 'deepchat' || explicitType === 'acp') {
    return explicitType
  }

  return agentId === 'deepchat' ? 'deepchat' : 'acp'
}

const currentAgent = computed(() => {
  if (sessionStore.hasActiveSession) {
    const sessionAgentId = sessionStore.activeSession?.agentId ?? 'deepchat'
    return (
      availableAgents.value.find((agent) => agent.id === sessionAgentId) ?? {
        id: sessionAgentId,
        type:
          sessionStore.activeSession?.providerId === 'acp'
            ? 'acp'
            : resolveAgentType(sessionAgentId)
      }
    )
  }
  const selectedAgent = availableAgents.value.find(
    (agent) => agent.id === agentStore.selectedAgentId
  )
  return (
    agentStore.selectedAgent ?? {
      id: agentStore.selectedAgentId ?? 'deepchat',
      type: selectedAgent?.type ?? resolveAgentType(agentStore.selectedAgentId)
    }
  )
})

const isDeepchatContext = computed(() => currentAgent.value.type === 'deepchat')
const deepchatSessionId = computed(() =>
  isDeepchatContext.value && sessionStore.hasActiveSession ? sessionStore.activeSessionId : null
)
const workspacePath = computed(() => {
  if (sessionStore.hasActiveSession) {
    const projectDir = sessionStore.activeSession?.projectDir?.trim()
    return projectDir ? projectDir : null
  }

  const selectedProjectPath = projectStore.selectedProject?.path?.trim()
  return selectedProjectPath ? selectedProjectPath : null
})

const triggerTitle = computed(() =>
  isDeepchatContext.value ? t('chat.advancedSettings.title') : t('chat.input.mcp.title')
)
const triggerLabel = computed(() => t('chat.input.mcp.badge', { count: enabledServerCount.value }))

const normalizeToolNames = (toolNames: string[] | null | undefined): string[] => {
  if (!Array.isArray(toolNames)) {
    return []
  }

  return Array.from(
    new Set(
      toolNames
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right))
}

const getGroupLabel = (serverName: string) => {
  switch (serverName) {
    case 'agent-filesystem':
      return t('chat.input.tools.groups.agentFilesystem')
    case 'agent-core':
      return t('chat.input.tools.groups.agentCore')
    case 'agent-skills':
      return t('chat.input.tools.groups.agentSkills')
    case 'deepchat-settings':
      return t('chat.input.tools.groups.deepchatSettings')
    case 'yobrowser':
      return t('chat.input.tools.groups.yobrowser')
    default:
      return serverName
  }
}

const groupedAgentTools = computed<ToolGroup[]>(() => {
  const groups = new Map<string, ToolGroupItem[]>()

  for (const tool of agentTools.value) {
    const existing = groups.get(tool.server.name) ?? []
    existing.push({
      kind: 'tool',
      id: tool.function.name,
      label: tool.function.name,
      toolName: tool.function.name
    })
    groups.set(tool.server.name, existing)
  }

  if (props.showSubagentToggle) {
    const existing = groups.get('agent-core') ?? []
    existing.push({
      kind: 'subagent',
      id: 'subagent',
      label: t('chat.subagents.label')
    })
    groups.set('agent-core', existing)
  }

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      label: getGroupLabel(name),
      items: [...items].sort((left, right) => left.label.localeCompare(right.label))
    }))
    .sort((left, right) => {
      const leftIndex = GROUP_ORDER.indexOf(left.name)
      const rightIndex = GROUP_ORDER.indexOf(right.name)

      if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex
      }
      if (leftIndex >= 0) {
        return -1
      }
      if (rightIndex >= 0) {
        return 1
      }
      return left.name.localeCompare(right.name)
    })
})

const isToolEnabled = (toolName: string) => !disabledToolNames.value.includes(toolName)
const isToolPending = (toolName: string) => pendingToolNames.value.includes(toolName)
const isGroupItemEnabled = (item: ToolGroupItem) =>
  item.kind === 'subagent' ? props.subagentEnabled : isToolEnabled(item.toolName)
const isGroupItemPending = (item: ToolGroupItem) =>
  item.kind === 'subagent' ? props.subagentTogglePending : isToolPending(item.toolName)
const getGroupToolNames = (group: ToolGroup) =>
  group.items.flatMap((item) => (item.kind === 'tool' ? [item.toolName] : []))
const isGroupEnabled = (group: ToolGroup) => group.items.some((item) => isGroupItemEnabled(item))
const isGroupPending = (group: ToolGroup) => group.items.some((item) => isGroupItemPending(item))

const getServerLabel = (serverName: string) => {
  return t(`mcp.inmemory.${serverName}.name`, serverName)
}

const getServerToolsCount = (serverName: string) => {
  return mcpStore.tools.filter((tool) => tool.server.name === serverName).length
}

const setToolsPending = (toolNames: string[], pending: boolean) => {
  const normalizedToolNames = normalizeToolNames(toolNames)
  if (pending) {
    pendingToolNames.value = normalizeToolNames([...pendingToolNames.value, ...normalizedToolNames])
    return
  }

  const pendingSet = new Set(normalizedToolNames)
  pendingToolNames.value = pendingToolNames.value.filter((name) => !pendingSet.has(name))
}

const syncDraftDisabledTools = () => {
  if (!isDeepchatContext.value || deepchatSessionId.value) {
    return
  }
  disabledToolNames.value = normalizeToolNames(draftStore.disabledAgentTools)
}

const loadDeepchatTools = async () => {
  if (!isDeepchatContext.value) {
    agentTools.value = []
    disabledToolNames.value = []
    toolsLoading.value = false
    return
  }

  const loadToken = ++latestLoadToken
  toolsLoading.value = true

  try {
    const [toolDefinitions, persistedDisabledTools] = await Promise.all([
      toolPresenter.getAllToolDefinitions({
        chatMode: 'agent',
        conversationId: deepchatSessionId.value ?? undefined,
        agentWorkspacePath: workspacePath.value
      }),
      deepchatSessionId.value
        ? agentSessionPresenter.getSessionDisabledAgentTools(deepchatSessionId.value)
        : Promise.resolve([...draftStore.disabledAgentTools])
    ])

    if (loadToken !== latestLoadToken) {
      return
    }

    agentTools.value = Array.isArray(toolDefinitions)
      ? toolDefinitions.filter((tool) => tool.source === 'agent')
      : []
    disabledToolNames.value = normalizeToolNames(
      Array.isArray(persistedDisabledTools) ? persistedDisabledTools : draftStore.disabledAgentTools
    )
  } catch (error) {
    if (loadToken !== latestLoadToken) {
      return
    }
    console.warn('[McpIndicator] Failed to load deepchat tools:', error)
    agentTools.value = []
    syncDraftDisabledTools()
  } finally {
    if (loadToken === latestLoadToken) {
      toolsLoading.value = false
    }
  }
}

const navigateToMcpSettings = (windowId: number) => {
  windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
    routeName: 'settings-mcp'
  })
}

const openSettings = async () => {
  const settingsWindowId = await windowPresenter.createSettingsWindow()
  if (settingsWindowId != null) {
    navigateToMcpSettings(settingsWindowId)
  }
  panelOpen.value = false
}

const persistDisabledTools = async (nextList: string[], affectedToolNames: string[]) => {
  if (!deepchatSessionId.value) {
    draftStore.disabledAgentTools = nextList
    disabledToolNames.value = nextList
    return
  }

  setToolsPending(affectedToolNames, true)
  try {
    const persisted = await agentSessionPresenter.updateSessionDisabledAgentTools(
      deepchatSessionId.value,
      nextList
    )
    disabledToolNames.value = normalizeToolNames(Array.isArray(persisted) ? persisted : nextList)
  } catch (error) {
    console.warn('[McpIndicator] Failed to update disabled tools:', error)
  } finally {
    setToolsPending(affectedToolNames, false)
  }
}

const toggleAgentTool = async (toolName: string) => {
  if (!isDeepchatContext.value || isToolPending(toolName)) {
    return
  }

  const nextDisabledTools = new Set(disabledToolNames.value)
  if (nextDisabledTools.has(toolName)) {
    nextDisabledTools.delete(toolName)
  } else {
    nextDisabledTools.add(toolName)
  }

  const nextList = Array.from(nextDisabledTools).sort((left, right) => left.localeCompare(right))
  await persistDisabledTools(nextList, [toolName])
}

const toggleGroupItem = async (item: ToolGroupItem) => {
  if (item.kind === 'subagent') {
    if (!isDeepchatContext.value || props.subagentTogglePending) {
      return
    }

    emit('toggle-subagents', !props.subagentEnabled)
    return
  }

  await toggleAgentTool(item.toolName)
}

const setGroupEnabled = async (group: ToolGroup, enabled: boolean) => {
  if (!isDeepchatContext.value || isGroupPending(group)) {
    return
  }

  const groupToolNames = getGroupToolNames(group)
  const nextDisabledTools = new Set(disabledToolNames.value)

  for (const toolName of groupToolNames) {
    if (enabled) {
      nextDisabledTools.delete(toolName)
    } else {
      nextDisabledTools.add(toolName)
    }
  }

  const nextList = Array.from(nextDisabledTools).sort((left, right) => left.localeCompare(right))
  const shouldUpdateTools = nextList.join('\n') !== disabledToolNames.value.join('\n')
  const shouldUpdateSubagents =
    group.items.some((item) => item.kind === 'subagent') && props.subagentEnabled !== enabled

  if (!shouldUpdateTools && !shouldUpdateSubagents) {
    return
  }

  if (shouldUpdateTools) {
    await persistDisabledTools(nextList, groupToolNames)
  }

  if (shouldUpdateSubagents) {
    emit('toggle-subagents', enabled)
  }
}

watch(
  () => [isDeepchatContext.value, deepchatSessionId.value, workspacePath.value] as const,
  () => {
    void loadDeepchatTools()
  },
  { immediate: true }
)

watch(
  () => draftStore.disabledAgentTools,
  () => {
    syncDraftDisabledTools()
  },
  { deep: true }
)

watch(
  () => panelOpen.value,
  (open) => {
    emit('open-change', open)
    if (open && isDeepchatContext.value) {
      void loadDeepchatTools()
    }
  }
)
</script>
