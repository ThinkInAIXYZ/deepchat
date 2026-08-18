<template>
  <DcPopover v-model:open="panelOpen" width-class="w-80" align="end">
    <template #trigger>
      <DcButton
        variant="ghost"
        size="sm"
        :class="
          isDeepchatContext
            ? 'dc-blur-panel h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
            : 'dc-blur-panel h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground'
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
      </DcButton>
    </template>

    <template v-if="isDeepchatContext" #header>
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium">
          {{ t('chat.advancedSettings.title') }}
        </div>
        <DcButton
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0 text-muted-foreground"
          :tooltip="t('chat.input.mcp.openSettings')"
          :aria-label="t('chat.input.mcp.openSettings')"
          @click="openSettings"
        >
          <Icon icon="lucide:settings-2" class="h-3.5 w-3.5" />
        </DcButton>
      </div>
    </template>

    <template v-if="isDeepchatContext">
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

        <slot name="generation-settings" />

        <div class="border-b px-3 py-3" data-testid="tool-mode-section">
          <div
            class="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span>{{ t('chat.input.toolMode.title') }}</span>
            <span v-if="toolModeOverride === null" class="normal-case tracking-normal">
              {{ t('chat.input.toolMode.modelDefault') }}
            </span>
          </div>

          <RadioGroup
            :model-value="resolvedToolMode"
            class="grid grid-cols-3 gap-1.5"
            :disabled="toolModeDisabled"
            :aria-label="t('chat.input.toolMode.title')"
            @update:model-value="setToolMode"
          >
            <label
              v-for="mode in toolModeOptions"
              :key="mode"
              class="flex h-8 min-w-0 cursor-pointer items-center justify-center rounded-md border px-2 text-xs transition-colors"
              :class="[
                resolvedToolMode === mode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                toolModeDisabled ? 'cursor-not-allowed opacity-50' : ''
              ]"
            >
              <RadioGroupItem :value="mode" class="sr-only" />
              <span class="truncate">{{ getToolModeLabel(mode) }}</span>
            </label>
          </RadioGroup>

          <div class="mt-2 flex items-start justify-between gap-2">
            <span class="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
              {{ toolModeDescription }}
            </span>
            <DcButton
              variant="ghost"
              size="sm"
              class="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
              :disabled="toolModeDisabled || toolModeOverride === null"
              data-testid="tool-mode-use-default"
              @click="useModelDefaultToolMode"
            >
              {{ t('chat.input.toolMode.useModelDefault') }}
            </DcButton>
          </div>

          <div v-if="toolModeSaving" class="mt-1 text-xs text-muted-foreground">
            {{ t('chat.input.toolMode.saving') }}
          </div>
          <div v-else-if="toolModeLocked" class="mt-1 text-xs text-muted-foreground">
            {{ t('chat.input.toolMode.locked') }}
          </div>
          <div v-else-if="toolModeError" class="mt-1 text-xs text-destructive">
            {{ toolModeError }}
          </div>
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
            v-else-if="visibleToolGroups.length === 0"
            class="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
          >
            {{ t('chat.input.tools.builtinEmpty') }}
          </div>

          <div v-else class="space-y-4">
            <div v-for="group in visibleToolGroups" :key="group.name" class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {{ group.label }}
                </div>

                <Switch
                  v-if="group.configurable"
                  :model-value="isGroupEnabled(group)"
                  :disabled="isGroupPending(group)"
                  :aria-label="group.label"
                  @update:model-value="(value) => setGroupEnabled(group, value)"
                />
              </div>

              <div class="flex flex-wrap gap-2">
                <DcButton
                  v-for="item in group.items"
                  :key="item.id"
                  :as="item.configurable ? 'button' : 'span'"
                  :variant="!item.configurable || isGroupItemEnabled(item) ? 'default' : 'outline'"
                  size="sm"
                  class="h-7 rounded-md border px-2.5 text-xs shadow-none transition-colors"
                  :class="[
                    !item.configurable || isGroupItemEnabled(item)
                      ? 'border-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    !item.configurable ? 'pointer-events-none' : ''
                  ]"
                  :disabled="item.configurable && isGroupItemPending(item)"
                  @click="toggleGroupItem(item)"
                >
                  {{ item.label }}
                </DcButton>
              </div>
            </div>
          </div>
        </div>

        <div :class="enabledPluginServers.length > 0 ? 'border-b px-3 py-3' : 'px-3 py-3'">
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

        <div v-if="enabledPluginServers.length > 0" class="px-3 py-3">
          <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {{ t('chat.input.tools.pluginSection') }}
          </div>

          <div class="space-y-1">
            <div
              v-for="server in enabledPluginServers"
              :key="server.name"
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <Icon
                v-if="server.icons === 'plugin'"
                icon="lucide:puzzle"
                class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
              <span v-else class="shrink-0">{{ server.icons }}</span>
              <span class="min-w-0 flex-1 truncate" :title="getPluginServerLabel(server)">
                {{ getPluginServerLabel(server) }}
              </span>
              <span class="shrink-0 text-muted-foreground">
                {{ getPluginServerToolsCount(server.name) }}
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
          <DcButton
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0 text-muted-foreground"
            :tooltip="t('chat.input.mcp.openSettings')"
            :aria-label="t('chat.input.mcp.openSettings')"
            @click="openSettings"
          >
            <Icon icon="lucide:settings-2" class="h-3.5 w-3.5" />
          </DcButton>
        </div>
      </div>

      <div
        v-if="enabledServers.length === 0 && enabledPluginServers.length === 0"
        class="px-3 py-4 text-xs text-muted-foreground"
      >
        {{ t('chat.input.mcp.empty') }}
      </div>

      <div v-else class="max-h-64 space-y-3 overflow-y-auto px-2 py-2">
        <div v-if="enabledServers.length > 0" class="space-y-1">
          <div
            v-if="enabledPluginServers.length > 0"
            class="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {{ t('chat.input.tools.mcpSection') }}
          </div>
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

        <div v-if="enabledPluginServers.length > 0" class="space-y-1">
          <div
            class="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {{ t('chat.input.tools.pluginSection') }}
          </div>
          <div
            v-for="server in enabledPluginServers"
            :key="server.name"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
          >
            <Icon
              v-if="server.icons === 'plugin'"
              icon="lucide:puzzle"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            />
            <span v-else class="shrink-0">{{ server.icons }}</span>
            <span class="min-w-0 flex-1 truncate" :title="getPluginServerLabel(server)">
              {{ getPluginServerLabel(server) }}
            </span>
            <span class="shrink-0 text-muted-foreground">
              {{ getPluginServerToolsCount(server.name) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </DcPopover>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcPopover } from '@dc-ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { createSessionClient } from '@api/SessionClient'
import { createSkillClient } from '@api/SkillClient'
import { createToolClient } from '@api/ToolClient'
import type { MCPToolDefinition } from '@shared/types/mcp'
import { useMcpStore } from '@/stores/mcp'
import { useSessionStore } from '@/stores/ui/session'
import { useDraftStore } from '@/stores/ui/draft'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import { useModelCapabilities } from '@/composables/useModelCapabilities'
import { ToolModeSchema, type ToolMode, type ToolModeOverride } from '@shared/toolMode'

type ToolGroupItem = {
  id: string
  label: string
  toolName: string
  configurable: boolean
}

type ToolGroup = {
  name: string
  label: string
  items: ToolGroupItem[]
  configurable: boolean
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
const TOOL_MODE_OPTIONS: readonly ToolMode[] = ['agent', 'code', 'minimal']
const MINIMAL_AGENT_FILESYSTEM_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'exec',
  'process'
])
const MINIMAL_EDITOR_REQUIRED_AGENT_TOOLS = ['read', 'write', 'edit'] as const
const MODE_FIXED_AGENT_TOOLS = new Set(['deepchat_question', 'deepchat_subagents'])

const props = withDefaults(
  defineProps<{
    showSystemPromptSection?: boolean
    systemPromptOptions?: SystemPromptMenuOption[]
    selectedSystemPromptId?: string
    showCustomSystemPromptBadge?: boolean
    subagentsAvailable?: boolean
  }>(),
  {
    showSystemPromptSection: false,
    systemPromptOptions: () => [],
    selectedSystemPromptId: 'empty',
    showCustomSystemPromptBadge: false,
    subagentsAvailable: false
  }
)

const emit = defineEmits<{
  (e: 'select-system-prompt', optionId: string): void
  (e: 'open-change', open: boolean): void
}>()

const { t } = useI18n()
const router = useRouter()
const mcpStore = useMcpStore()
const sessionStore = useSessionStore()
const draftStore = useDraftStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()
const toolClient = createToolClient()
const sessionClient = createSessionClient()
const skillClient = createSkillClient()

const panelOpen = ref(false)
const toolsLoading = ref(false)
const agentTools = ref<MCPToolDefinition[]>([])
const disabledToolNames = ref<string[]>([])
const pendingToolNames = ref<string[]>([])
const optimisticToolModeOverride = ref<ToolModeOverride | undefined>(undefined)
const toolModeSaving = ref(false)
const toolModeError = ref('')
let latestLoadToken = 0
let unsubscribeSkillSessionChanged: (() => void) | null = null

const enabledServers = computed(() => mcpStore.enabledServers)
const enabledPluginServers = computed(() => mcpStore.enabledPluginServers)
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
const currentProviderId = computed(() =>
  sessionStore.hasActiveSession ? sessionStore.activeSession?.providerId : draftStore.providerId
)
const currentModelId = computed(() =>
  sessionStore.hasActiveSession ? sessionStore.activeSession?.modelId : draftStore.modelId
)
const modelCapabilities = useModelCapabilities({
  providerId: currentProviderId,
  modelId: currentModelId
})
const persistedToolModeOverride = computed<ToolModeOverride>(() =>
  sessionStore.hasActiveSession
    ? (sessionStore.activeSession?.toolModeOverride ?? null)
    : draftStore.toolModeOverride
)
const toolModeOverride = computed<ToolModeOverride>(() =>
  optimisticToolModeOverride.value === undefined
    ? persistedToolModeOverride.value
    : optimisticToolModeOverride.value
)
const modelDefaultToolMode = computed<ToolMode>(
  () => modelCapabilities.snapshot.value?.defaultToolMode ?? 'agent'
)
const resolvedToolMode = computed<ToolMode>(
  () => toolModeOverride.value ?? modelDefaultToolMode.value
)
const toolModeLocked = computed(
  () => sessionStore.hasActiveSession && sessionStore.activeSession?.status === 'working'
)
const toolModeDisabled = computed(() => toolModeSaving.value || toolModeLocked.value)
const toolModeOptions = TOOL_MODE_OPTIONS
const toolModeDescription = computed(() =>
  t(`chat.input.toolMode.descriptions.${resolvedToolMode.value}`)
)

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
      id: tool.function.name,
      label: tool.function.name,
      toolName: tool.function.name,
      configurable: true
    })
    groups.set(tool.server.name, existing)
  }

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      label: getGroupLabel(name),
      configurable: true,
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

const fixedToolGroup = (name: string, label: string, toolNames: string[]): ToolGroup => ({
  name,
  label,
  configurable: false,
  items: toolNames.map((toolName) => ({
    id: toolName,
    label: toolName,
    toolName,
    configurable: false
  }))
})

const createSubagentToolItem = (): ToolGroupItem => ({
  id: 'deepchat_subagents',
  label: 'deepchat_subagents',
  toolName: 'deepchat_subagents',
  configurable: false
})

const includeSubagentTool = (groups: ToolGroup[], fallbackLabel: string): ToolGroup[] => {
  if (
    !props.subagentsAvailable ||
    groups.some((group) => group.items.some((item) => item.toolName === 'deepchat_subagents'))
  ) {
    return groups
  }

  const subagentItem = createSubagentToolItem()
  const coreGroupIndex = groups.findIndex((group) => group.name === 'agent-core')
  if (coreGroupIndex < 0) {
    return [
      ...groups,
      {
        name: 'agent-core',
        label: fallbackLabel,
        configurable: false,
        items: [subagentItem]
      }
    ]
  }

  return groups.map((group, index) =>
    index === coreGroupIndex ? { ...group, items: [...group.items, subagentItem] } : group
  )
}

const visibleToolGroups = computed<ToolGroup[]>(() => {
  if (resolvedToolMode.value === 'minimal') {
    const editor = currentProviderId.value === 'openai-codex' ? 'apply_patch' : 'str_replace_editor'
    const editorAvailable = MINIMAL_EDITOR_REQUIRED_AGENT_TOOLS.every(
      (toolName) => !disabledToolNames.value.includes(toolName)
    )
    const retainedGroups = groupedAgentTools.value
      .map((group) => {
        const retainedItems =
          group.name === 'agent-filesystem'
            ? group.items.filter((item) => !MINIMAL_AGENT_FILESYSTEM_TOOLS.has(item.toolName))
            : group.items
        const items = retainedItems.map((item) =>
          MODE_FIXED_AGENT_TOOLS.has(item.toolName) ? { ...item, configurable: false } : item
        )
        return { ...group, items, configurable: items.some((item) => item.configurable) }
      })
      .filter((group) => group.items.length > 0)
    return [
      fixedToolGroup('tool-mode-minimal', t('chat.input.toolMode.minimalTools'), [
        'exec',
        'process',
        ...(editorAvailable ? [editor] : [])
      ]),
      ...includeSubagentTool(retainedGroups, getGroupLabel('agent-core'))
    ]
  }

  if (resolvedToolMode.value === 'code') {
    const entries = currentProviderId.value === 'openai-codex' ? ['exec', 'wait'] : ['run_code']
    const codeCallableLabel = t('chat.input.toolMode.codeCallable')
    const codeEntryGroup = fixedToolGroup(
      'tool-mode-code-entry',
      t('chat.input.toolMode.codeEntry'),
      entries
    )
    const directToolItems = groupedAgentTools.value
      .flatMap((group) => group.items)
      .filter((item) => item.toolName === 'deepchat_question')
      .map((item) => ({ ...item, configurable: false }))
    if (props.subagentsAvailable) directToolItems.push(createSubagentToolItem())
    const codeCallableGroups = groupedAgentTools.value
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !MODE_FIXED_AGENT_TOOLS.has(item.toolName)),
        label: `${codeCallableLabel} · ${group.label}`
      }))
      .filter((group) => group.items.length > 0)
    return [
      { ...codeEntryGroup, items: [...codeEntryGroup.items, ...directToolItems] },
      ...codeCallableGroups
    ]
  }

  return groupedAgentTools.value
})

const isToolEnabled = (toolName: string) => !disabledToolNames.value.includes(toolName)
const isToolPending = (toolName: string) => pendingToolNames.value.includes(toolName)
const isGroupItemEnabled = (item: ToolGroupItem) => isToolEnabled(item.toolName)
const isGroupItemPending = (item: ToolGroupItem) => isToolPending(item.toolName)
const getGroupToolNames = (group: ToolGroup) =>
  group.items.filter((item) => item.configurable).map((item) => item.toolName)
const isGroupEnabled = (group: ToolGroup) => getGroupToolNames(group).some(isToolEnabled)
const isGroupPending = (group: ToolGroup) => getGroupToolNames(group).some(isToolPending)

const getServerLabel = (serverName: string) => {
  return t(`mcp.inmemory.${serverName}.name`, serverName)
}

const getServerToolsCount = (serverName: string) => {
  return mcpStore.visibleTools.filter((tool) => tool.server.name === serverName).length
}

const getPluginServerLabel = (server: { name: string; descriptions?: string }) => {
  return server.descriptions || getServerLabel(server.name)
}

const getPluginServerToolsCount = (serverName: string) => {
  return mcpStore.pluginTools.filter((tool) => tool.server.name === serverName).length
}

const getToolModeLabel = (mode: ToolMode) => t(`chat.input.toolMode.options.${mode}`)

const persistToolModeOverride = async (override: ToolModeOverride) => {
  if (!isDeepchatContext.value || toolModeDisabled.value) return

  const previous = persistedToolModeOverride.value
  optimisticToolModeOverride.value = override
  toolModeSaving.value = true
  toolModeError.value = ''
  try {
    if (deepchatSessionId.value) {
      await sessionStore.setSessionToolMode(override)
    } else {
      draftStore.toolModeOverride = override
    }
  } catch (error) {
    console.warn('[McpIndicator] Failed to update tool mode:', error)
    optimisticToolModeOverride.value = previous
    toolModeError.value = t('chat.input.toolMode.updateFailed')
  } finally {
    toolModeSaving.value = false
    if (!toolModeError.value) optimisticToolModeOverride.value = undefined
  }
}

const setToolMode = (value: unknown) => {
  const parsed = ToolModeSchema.safeParse(value)
  if (!parsed.success || parsed.data === toolModeOverride.value) return
  void persistToolModeOverride(parsed.data)
}

const useModelDefaultToolMode = () => {
  if (toolModeOverride.value === null) return
  void persistToolModeOverride(null)
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
      toolClient.getConfigurableAgentToolDefinitions({
        chatMode: 'agent',
        conversationId: deepchatSessionId.value ?? undefined,
        agentWorkspacePath: workspacePath.value
      }),
      deepchatSessionId.value
        ? sessionClient.getSessionDisabledAgentTools(deepchatSessionId.value)
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

const openSettings = async () => {
  await router.push({ name: 'plugins-mcp' })
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
    const persisted = await sessionClient.updateSessionDisabledAgentTools(
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
  if (!item.configurable) return
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
  if (!shouldUpdateTools) {
    return
  }

  await persistDisabledTools(nextList, groupToolNames)
}

const handleSkillRuntimeChange = (payload: {
  conversationId?: string | null
  skills?: string[]
  change: 'activated' | 'deactivated'
}) => {
  if (!isDeepchatContext.value || !deepchatSessionId.value) {
    return
  }

  if (payload?.conversationId !== deepchatSessionId.value) {
    return
  }

  void loadDeepchatTools()
}

watch(
  () => [isDeepchatContext.value, deepchatSessionId.value, workspacePath.value] as const,
  () => {
    optimisticToolModeOverride.value = undefined
    toolModeError.value = ''
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

onMounted(() => {
  unsubscribeSkillSessionChanged = skillClient.onSessionChanged(handleSkillRuntimeChange)
})

onUnmounted(() => {
  unsubscribeSkillSessionChanged?.()
  unsubscribeSkillSessionChanged = null
})
</script>
