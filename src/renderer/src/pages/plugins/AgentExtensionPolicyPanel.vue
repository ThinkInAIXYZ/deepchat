<template>
  <section
    data-testid="agent-extension-policy-panel"
    :class="[
      'shrink-0 bg-muted/20 px-5 py-3',
      props.standalone ? 'h-full overflow-y-auto' : 'border-b border-border/70'
    ]"
  >
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:sliders-horizontal" class="size-4 text-muted-foreground" />
            <h2 class="truncate text-sm font-semibold">
              {{ t('settings.pluginsHub.agentScopeTitle') }}
            </h2>
            <span
              v-if="targetAgent"
              class="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {{ targetAgent.name }}
            </span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ panelDescription }}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" :disabled="loading || saving" @click="loadPolicy">
            <Icon
              icon="lucide:refresh-cw"
              class="mr-1.5 size-3.5"
              :class="loading ? 'animate-spin' : ''"
            />
            {{ t('settings.pluginsHub.agentScopeRefresh') }}
          </Button>
          <Button
            data-testid="agent-extension-policy-save"
            size="sm"
            :disabled="!targetAgent || loading || saving || !isDeepChatTarget"
            @click="savePolicy"
          >
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>

      <div
        v-if="errorMessage"
        class="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive"
      >
        {{ errorMessage }}
      </div>

      <div v-if="isDeepChatTarget" :class="categoryGridClass">
        <div
          v-for="category in visibleCategories"
          :key="category.kind"
          class="space-y-3 rounded-xl border border-border bg-background p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ category.title }}</div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ policySummary(category.kind) }}
              </p>
            </div>
            <Button
              :data-testid="`agent-extension-${category.kind}-mode`"
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="toggleMode(category.kind)"
            >
              {{ modeLabel(getMode(category.kind)) }}
            </Button>
          </div>

          <div v-if="getMode(category.kind) === 'custom'" class="space-y-2">
            <div class="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs"
                @click="selectAll(category.kind)"
              >
                {{ t('settings.pluginsHub.agentScopeSelectAll') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs"
                @click="clearAll(category.kind)"
              >
                {{ t('settings.pluginsHub.agentScopeClearAll') }}
              </Button>
            </div>

            <div
              v-if="category.options.length === 0"
              class="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
            >
              {{ category.emptyText }}
            </div>
            <div v-else class="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
              <Button
                v-for="option in category.options"
                :key="option.id"
                type="button"
                variant="outline"
                size="sm"
                class="h-8 max-w-full rounded-xl px-3 text-xs shadow-none transition-colors"
                :class="
                  isSelected(category.kind, option.id)
                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                "
                :title="option.label"
                @click="toggleSelection(category.kind, option.id)"
              >
                <span class="truncate">{{ option.label }}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { createConfigClient } from '@api/ConfigClient'
import { createMcpClient } from '@api/McpClient'
import { createPluginClient } from '@api/PluginClient'
import { createSkillClient } from '@api/SkillClient'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { MCPServerConfig } from '@shared/presenter'
import type { PluginListItem } from '@shared/types/plugin'
import type { SkillMetadata } from '@shared/types/skill'

type PolicyKind = 'plugins' | 'skills' | 'mcp'
type PolicyMode = 'inherit' | 'custom'
type PolicyOption = {
  id: string
  label: string
}
type McpServerOption = {
  id: string
  config: MCPServerConfig
}

const props = withDefaults(
  defineProps<{
    kinds?: PolicyKind[]
    standalone?: boolean
  }>(),
  {
    kinds: () => ['plugins', 'skills', 'mcp'],
    standalone: false
  }
)

const { t } = useI18n()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const configClient = createConfigClient()
const mcpClient = createMcpClient()
const pluginClient = createPluginClient()
const skillClient = createSkillClient()

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const targetAgent = ref<Agent | null>(null)
const plugins = ref<PluginListItem[]>([])
const skills = ref<SkillMetadata[]>([])
const mcpServers = ref<McpServerOption[]>([])
const pluginMode = ref<PolicyMode>('inherit')
const skillMode = ref<PolicyMode>('inherit')
const mcpMode = ref<PolicyMode>('inherit')
const selectedPluginIds = ref<string[]>([])
const selectedSkillNames = ref<string[]>([])
const selectedMcpServerIds = ref<string[]>([])

const normalizeList = (value: string[] | null | undefined): string[] =>
  Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  )
const modeFromConfig = (value: string[] | null | undefined): PolicyMode =>
  value === null || value === undefined ? 'inherit' : 'custom'
const valueForSave = (mode: PolicyMode, values: string[]): string[] | null =>
  mode === 'inherit' ? null : normalizeList(values)
const isPluginOwnedMcpServer = (config: MCPServerConfig): boolean =>
  Boolean(config.ownerPluginId?.trim() || (config.source === 'plugin' && config.sourceId?.trim()))

const targetAgentId = computed(() => {
  const activeSessionAgentId = sessionStore.activeSession?.agentId?.trim()
  if (activeSessionAgentId) {
    return activeSessionAgentId
  }

  const selectedAgentId = agentStore.selectedAgentId?.trim()
  if (selectedAgentId) {
    return selectedAgentId
  }

  return 'deepchat'
})
const isDeepChatTarget = computed(() =>
  Boolean(targetAgent.value && targetAgent.value.type === 'deepchat')
)
const pluginOptions = computed<PolicyOption[]>(() =>
  plugins.value
    .filter((plugin) => plugin.installed !== false && plugin.enabled)
    .map((plugin) => ({ id: plugin.id, label: plugin.name }))
    .sort((left, right) => left.label.localeCompare(right.label))
)
const skillOptions = computed<PolicyOption[]>(() =>
  skills.value
    .map((skill) => ({ id: skill.name, label: skill.name }))
    .sort((left, right) => left.label.localeCompare(right.label))
)
const mcpOptions = computed<PolicyOption[]>(() =>
  mcpServers.value
    .filter(
      (server) =>
        server.config.enabled !== false &&
        !server.config.disable &&
        !isPluginOwnedMcpServer(server.config)
    )
    .map((server) => ({ id: server.id, label: server.config.descriptions || server.id }))
    .sort((left, right) => left.label.localeCompare(right.label))
)
const categories = computed(() => [
  {
    kind: 'plugins' as const,
    title: t('settings.pluginsHub.agentScopePlugins'),
    emptyText: t('settings.pluginsHub.agentScopeNoPlugins'),
    options: pluginOptions.value
  },
  {
    kind: 'skills' as const,
    title: t('settings.pluginsHub.agentScopeSkills'),
    emptyText: t('settings.pluginsHub.agentScopeNoSkills'),
    options: skillOptions.value
  },
  {
    kind: 'mcp' as const,
    title: t('settings.pluginsHub.agentScopeMcp'),
    emptyText: t('settings.pluginsHub.agentScopeNoMcp'),
    options: mcpOptions.value
  }
])
const visibleCategories = computed(() => {
  const allowed = new Set(props.kinds)
  return categories.value.filter((category) => allowed.has(category.kind))
})
const categoryGridClass = computed(() =>
  props.standalone || visibleCategories.value.length === 1
    ? 'grid gap-3'
    : 'grid gap-3 lg:grid-cols-3'
)
const panelDescription = computed(() => {
  if (loading.value) {
    return t('common.loading')
  }
  if (!targetAgent.value) {
    return t('settings.pluginsHub.agentScopeNoAgent')
  }
  if (!isDeepChatTarget.value) {
    return t('settings.pluginsHub.agentScopeUnsupported')
  }
  return t('settings.pluginsHub.agentScopeDescription')
})

function optionIds(kind: PolicyKind): string[] {
  if (kind === 'plugins') return pluginOptions.value.map((option) => option.id)
  if (kind === 'skills') return skillOptions.value.map((option) => option.id)
  return mcpOptions.value.map((option) => option.id)
}

function getMode(kind: PolicyKind): PolicyMode {
  if (kind === 'plugins') return pluginMode.value
  if (kind === 'skills') return skillMode.value
  return mcpMode.value
}

function setMode(kind: PolicyKind, mode: PolicyMode): void {
  if (kind === 'plugins') pluginMode.value = mode
  else if (kind === 'skills') skillMode.value = mode
  else mcpMode.value = mode
}

function selectedValues(kind: PolicyKind): string[] {
  if (kind === 'plugins') return selectedPluginIds.value
  if (kind === 'skills') return selectedSkillNames.value
  return selectedMcpServerIds.value
}

function setSelectedValues(kind: PolicyKind, values: string[]): void {
  const normalized = normalizeList(values)
  if (kind === 'plugins') selectedPluginIds.value = normalized
  else if (kind === 'skills') selectedSkillNames.value = normalized
  else selectedMcpServerIds.value = normalized
}

function modeLabel(mode: PolicyMode): string {
  return mode === 'inherit'
    ? t('settings.pluginsHub.agentScopeInherited')
    : t('settings.pluginsHub.agentScopeCustom')
}

function policySummary(kind: PolicyKind): string {
  const mode = getMode(kind)
  if (mode === 'inherit') {
    return t('settings.pluginsHub.agentScopeInheritedSummary', { count: optionIds(kind).length })
  }

  const count = selectedValues(kind).length
  return count === 0
    ? t('settings.pluginsHub.agentScopeDenyAllSummary')
    : t('settings.pluginsHub.agentScopeSelectedSummary', { count })
}

function toggleMode(kind: PolicyKind): void {
  if (getMode(kind) === 'inherit') {
    setSelectedValues(kind, optionIds(kind))
    setMode(kind, 'custom')
    return
  }

  setMode(kind, 'inherit')
}

function isSelected(kind: PolicyKind, id: string): boolean {
  return selectedValues(kind).includes(id)
}

function toggleSelection(kind: PolicyKind, id: string): void {
  const next = new Set(selectedValues(kind))
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setSelectedValues(kind, Array.from(next))
}

function selectAll(kind: PolicyKind): void {
  setSelectedValues(kind, optionIds(kind))
}

function clearAll(kind: PolicyKind): void {
  setSelectedValues(kind, [])
}

function applyConfig(config: DeepChatAgentConfig | null | undefined): void {
  pluginMode.value = modeFromConfig(config?.enabledPluginIds)
  skillMode.value = modeFromConfig(config?.enabledSkillNames)
  mcpMode.value = modeFromConfig(config?.enabledMcpServerIds)
  selectedPluginIds.value = normalizeList(config?.enabledPluginIds)
  selectedSkillNames.value = normalizeList(config?.enabledSkillNames)
  selectedMcpServerIds.value = normalizeList(config?.enabledMcpServerIds)
}

async function loadPolicy(): Promise<void> {
  const agentId = targetAgentId.value
  loading.value = true
  errorMessage.value = ''
  try {
    const [agents, pluginList, skillList, serverMap] = await Promise.all([
      configClient.listAgents({ ids: [agentId] }),
      pluginClient.listPlugins().catch(() => []),
      skillClient.getMetadataList().catch(() => []),
      mcpClient.getMcpServers().catch(() => ({}))
    ])

    targetAgent.value = agents[0] ?? null
    plugins.value = Array.isArray(pluginList) ? pluginList : []
    skills.value = Array.isArray(skillList) ? skillList : []
    mcpServers.value = Object.entries(serverMap ?? {}).map(([id, config]) => ({ id, config }))
    applyConfig(targetAgent.value?.config)
  } catch (error) {
    targetAgent.value = null
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function savePolicy(): Promise<void> {
  const agent = targetAgent.value
  if (!agent || agent.type !== 'deepchat') {
    return
  }

  saving.value = true
  errorMessage.value = ''
  try {
    const config: DeepChatAgentConfig = {}
    const kinds = new Set(props.kinds)
    if (kinds.has('plugins')) {
      config.enabledPluginIds = valueForSave(pluginMode.value, selectedPluginIds.value)
    }
    if (kinds.has('skills')) {
      config.enabledSkillNames = valueForSave(skillMode.value, selectedSkillNames.value)
    }
    if (kinds.has('mcp')) {
      config.enabledMcpServerIds = valueForSave(mcpMode.value, selectedMcpServerIds.value)
    }

    const updated = await configClient.updateDeepChatAgent(agent.id, {
      config
    })
    if (updated) {
      targetAgent.value = updated
      applyConfig(updated.config)
      void agentStore.refreshAgentsByIds('deepchat', [updated.id])
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

watch(targetAgentId, () => void loadPolicy(), { immediate: true })
</script>
