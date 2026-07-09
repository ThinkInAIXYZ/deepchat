<template>
  <SettingsPageShell
    :title="t('routes.settings-memory')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    :description="t('settings.memory.description')"
    data-testid="settings-memory-page"
  >
    <div v-if="loading" class="py-16 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="loadError"
      class="space-y-3 rounded-lg border border-destructive/40 py-10 text-center text-sm text-destructive"
    >
      <div>{{ loadError }}</div>
      <Button variant="outline" size="sm" @click="() => reload()">
        {{ t('common.reset') }}
      </Button>
    </div>

    <div
      v-else-if="agents.length === 0"
      class="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground"
    >
      {{ t('settings.memory.empty') }}
    </div>

    <div v-else class="flex min-h-0 w-full flex-col gap-4">
      <div
        class="flex min-h-11 flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:flex-row sm:items-center"
      >
        <div class="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <span class="text-[11px] font-medium text-muted-foreground sm:shrink-0">
            {{ t('settings.memory.agentPicker') }}
          </span>
          <Select :model-value="selectedAgentId" @update:model-value="onSelect">
            <SelectTrigger
              class="h-8 w-full min-w-40 sm:w-48"
              data-testid="settings-memory-agent-picker"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="agent in agents" :key="agent.id" :value="agent.id">
                {{ agentLabel(agent) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          class="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"
          data-testid="settings-memory-status-summary"
          :title="statusSummaryTitle"
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="statusDotClass" />
          <span class="block min-w-0 truncate whitespace-nowrap">
            <span>
              {{
                memoryEnabled
                  ? t('settings.memory.redesign.statusEnabled')
                  : t('settings.memory.redesign.statusDisabled')
              }}
            </span>
            <span class="mx-1.5 text-muted-foreground">·</span>
            <span>{{ memoryCountLabel }}</span>
            <template v-if="memoryEnabled">
              <span class="mx-1.5 text-muted-foreground">·</span>
              <span
                :class="degraded ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'"
              >
                {{ embeddingStatusLabel }}
              </span>
            </template>
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          class="h-8 shrink-0 justify-center self-start sm:self-auto"
          data-testid="settings-memory-configure"
          :aria-expanded="configOpen"
          @click="configOpen = !configOpen"
        >
          <Icon icon="lucide:settings-2" class="mr-1.5 h-3.5 w-3.5" />
          {{ configureActionLabel }}
        </Button>
      </div>

      <MemoryConfigInlinePanel
        v-model:open="configOpen"
        :agent-id="selectedAgentId"
        @saved="handleConfigSaved"
      />

      <MemoryInboxBar
        :agent-id="selectedAgentId"
        :conflict-count="status?.conflictCount ?? 0"
        :draft-count="status?.personaDraftCount ?? 0"
        :refresh-token="refreshToken"
      />

      <Tabs v-model="activeTab" class="flex min-h-0 w-full flex-1 flex-col">
        <TabsList
          class="grid w-full max-w-lg"
          :class="personaTabVisible ? 'grid-cols-3' : 'grid-cols-2'"
        >
          <TabsTrigger value="memories">
            {{ t('settings.memory.redesign.tabMemories') }}
          </TabsTrigger>
          <TabsTrigger v-if="personaTabVisible" value="persona">
            {{ t('settings.memory.redesign.tabPersona') }}
            <Badge
              v-if="(status?.personaDraftCount ?? 0) > 0"
              variant="secondary"
              class="ml-1.5 text-[10px]"
            >
              {{ status?.personaDraftCount }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="diagnostics">
            {{ t('settings.memory.redesign.tabDiagnostics') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories" class="mt-4 min-h-0 flex-1">
          <MemoryListView
            :agent-id="selectedAgentId"
            :memory-enabled="memoryEnabled"
            :refresh-token="refreshToken"
            @enable="configOpen = true"
          />
        </TabsContent>

        <TabsContent v-if="personaTabVisible" value="persona" class="mt-4 min-h-0 flex-1">
          <MemoryPersonaPanel
            :agent-id="selectedAgentId"
            :persona-evolution-enabled="personaEvolutionEnabled"
            :refresh-token="refreshToken"
          />
        </TabsContent>

        <TabsContent value="diagnostics" class="mt-4 min-h-0 flex-1">
          <MemoryDiagnosticsPanel
            :agent-id="selectedAgentId"
            :status="status"
            :refresh-token="refreshToken"
          />
        </TabsContent>
      </Tabs>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { createConfigClient } from '@api/ConfigClient'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryStatusDto } from '@shared/contracts/routes'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import MemoryConfigInlinePanel from './MemoryConfigInlinePanel.vue'
import MemoryDiagnosticsPanel from './MemoryDiagnosticsPanel.vue'
import MemoryInboxBar from './MemoryInboxBar.vue'
import MemoryListView from './MemoryListView.vue'
import MemoryPersonaPanel from './MemoryPersonaPanel.vue'

const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const configClient = createConfigClient()
const memoryClient = createMemoryClient()

const loading = ref(true)
const agents = ref<Agent[]>([])
const selectedAgentId = ref('')
const activeTab = ref<'memories' | 'persona' | 'diagnostics'>('memories')
const resolvedSelected = ref<DeepChatAgentConfig | null>(null)
const resolvedAgentId = ref('')
const status = ref<MemoryStatusDto | null>(null)
const loadError = ref<string | null>(null)
const configOpen = ref(false)
const refreshToken = ref(0)
let statusRequestId = 0
let disposeUpdated: (() => void) | null = null

const configReady = computed(() => resolvedAgentId.value === selectedAgentId.value)
const memoryEnabled = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.memoryEnabled)
)
const hasEmbeddingConfigured = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.memoryEmbedding)
)
const personaEvolutionEnabled = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.personaEvolutionEnabled)
)
const embeddingLabel = computed(() => {
  if (!configReady.value) return null
  return resolvedSelected.value?.memoryEmbedding?.modelId ?? null
})
const activeMemoryCount = computed(() => status.value?.activeMemoryCount ?? 0)
const archivedMemoryCount = computed(() => status.value?.archivedMemoryCount ?? 0)
const degraded = computed(() => memoryEnabled.value && !hasEmbeddingConfigured.value)
const memoryCountLabel = computed(() =>
  t('settings.memory.redesign.memoryCount', {
    active: activeMemoryCount.value,
    archived: archivedMemoryCount.value
  })
)
const embeddingStatusLabel = computed(() =>
  hasEmbeddingConfigured.value
    ? t('settings.memory.redesign.embeddingModel', { model: embeddingLabel.value })
    : t('settings.memory.redesign.embeddingMissing')
)
const statusSummaryTitle = computed(() => {
  const parts = [
    memoryEnabled.value
      ? t('settings.memory.redesign.statusEnabled')
      : t('settings.memory.redesign.statusDisabled'),
    memoryCountLabel.value
  ]
  if (memoryEnabled.value) parts.push(embeddingStatusLabel.value)
  return parts.join(' · ')
})
const statusDotClass = computed(() =>
  memoryEnabled.value ? (degraded.value ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-muted-foreground'
)
const configureActionLabel = computed(() =>
  memoryEnabled.value
    ? t('settings.memory.redesign.configure')
    : t('settings.memory.redesign.enableMemory')
)
const personaTabVisible = computed(
  () =>
    personaEvolutionEnabled.value ||
    (status.value?.personaVersionCount ?? 0) > 0 ||
    (status.value?.personaDraftCount ?? 0) > 0
)

function agentLabel(agent: Agent): string {
  return agent.id === BUILTIN_DEEPCHAT_AGENT_ID
    ? agent.name || t('routes.settings-memory')
    : agent.name
}

async function loadAgents(preferred?: string | null): Promise<void> {
  const list = await configClient.listAgents()
  agents.value = list
    .filter((agent) => agent.type === 'deepchat')
    .sort((a, b) =>
      a.id === BUILTIN_DEEPCHAT_AGENT_ID
        ? -1
        : b.id === BUILTIN_DEEPCHAT_AGENT_ID
          ? 1
          : a.name.localeCompare(b.name)
    )
  const ids = new Set(agents.value.map((agent) => agent.id))
  selectedAgentId.value =
    preferred && ids.has(preferred)
      ? preferred
      : selectedAgentId.value && ids.has(selectedAgentId.value)
        ? selectedAgentId.value
        : ids.has(BUILTIN_DEEPCHAT_AGENT_ID)
          ? BUILTIN_DEEPCHAT_AGENT_ID
          : (agents.value[0]?.id ?? '')
}

async function loadResolved(): Promise<void> {
  const agentId = selectedAgentId.value
  if (!agentId) {
    resolvedSelected.value = null
    resolvedAgentId.value = ''
    return
  }
  try {
    const config = await configClient.resolveDeepChatAgentConfig(agentId)
    if (selectedAgentId.value !== agentId) return
    resolvedSelected.value = config
    resolvedAgentId.value = agentId
  } catch {
    if (selectedAgentId.value !== agentId) return
    resolvedSelected.value = null
    resolvedAgentId.value = agentId
  }
}

async function loadStatus(): Promise<void> {
  const agentId = selectedAgentId.value
  if (!agentId) {
    status.value = null
    return
  }
  const requestId = ++statusRequestId
  try {
    const next = await memoryClient.getStatus(agentId)
    if (requestId !== statusRequestId || selectedAgentId.value !== agentId) return
    status.value = next
  } catch {
    if (requestId !== statusRequestId || selectedAgentId.value !== agentId) return
    status.value = null
  }
}

function onSelect(value: unknown): void {
  const id = typeof value === 'string' ? value : ''
  if (!id || id === selectedAgentId.value) return
  selectedAgentId.value = id
  void router.replace({ query: { ...route.query, agentId: id } })
}

async function reload(preferred?: string | null): Promise<void> {
  loading.value = true
  loadError.value = null
  const previousAgentId = selectedAgentId.value
  try {
    await loadAgents(preferred ?? selectedAgentId.value)
    // If the selection changed, the selectedAgentId watcher below already
    // owns the resolve+status fetch; only fetch here when it stayed put
    // (the watcher won't fire in that case).
    if (selectedAgentId.value === previousAgentId) {
      await Promise.all([loadResolved(), loadStatus()])
    }
  } catch (error) {
    agents.value = []
    resolvedSelected.value = null
    resolvedAgentId.value = ''
    status.value = null
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function refreshSelected(): Promise<void> {
  refreshToken.value += 1
  await Promise.all([loadResolved(), loadStatus()])
}

function handleConfigSaved(): void {
  void refreshSelected()
}

watch(selectedAgentId, () => {
  status.value = null
  // Children already react to the agentId prop change on their own; don't
  // also bump refreshToken here or they'd reload twice per switch.
  void Promise.all([loadResolved(), loadStatus()])
})

watch(
  () => route.query.agentId,
  (value) => {
    if (typeof value === 'string' && agents.value.some((agent) => agent.id === value)) {
      selectedAgentId.value = value
    }
  }
)

watch(personaTabVisible, (visible) => {
  if (!visible && activeTab.value === 'persona') activeTab.value = 'memories'
})

onMounted(() => {
  const fromQuery = typeof route.query.agentId === 'string' ? route.query.agentId : null
  void reload(fromQuery)
  disposeUpdated = memoryClient.onUpdated((payload) => {
    if (payload.agentId !== selectedAgentId.value) return
    void refreshSelected()
  })
})

onUnmounted(() => {
  disposeUpdated?.()
  disposeUpdated = null
})
</script>
