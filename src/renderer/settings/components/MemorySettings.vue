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
      <DcButton variant="outline" size="sm" @click="() => reload()">
        {{ t('settings.memory.redesign.refresh') }}
      </DcButton>
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
          <Select
            :model-value="selectedAgentId"
            :disabled="configSaving"
            @update:model-value="onSelect"
          >
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

        <DcButton
          variant="ghost"
          size="sm"
          class="h-8 shrink-0 justify-center self-start sm:self-auto"
          data-testid="settings-memory-configure"
          :disabled="configSaving"
          :aria-expanded="configOpen"
          @click="toggleConfig"
        >
          <Icon icon="lucide:settings-2" class="mr-1.5 h-3.5 w-3.5" />
          {{ configureActionLabel }}
        </DcButton>
      </div>

      <MemoryInlineFeedback
        v-if="pageFeedback"
        :feedback="pageFeedback"
        @clear="clearPageFeedback"
      />

      <MemoryConfigInlinePanel
        ref="configPanelRef"
        v-model:open="configOpen"
        :agent-id="selectedAgentId"
        @pending-change="configSaving = $event"
        @saved="handleConfigSaved"
      />

      <div v-show="!configOpen" class="flex min-h-0 flex-1 flex-col gap-4">
        <MemoryInboxBar
          :agent-id="selectedAgentId"
          :conflict-count="status?.conflictCount ?? 0"
          :draft-count="status?.personaDraftCount ?? 0"
          :directive-draft-count="status?.directiveDraftCount ?? 0"
          :refresh-token="refreshToken"
        />

        <Tabs
          :model-value="activeTab"
          class="flex min-h-0 w-full flex-1 flex-col"
          @update:model-value="onTabChange"
        >
          <TabsList
            class="grid w-full max-w-2xl"
            :class="personaTabVisible ? 'grid-cols-4' : 'grid-cols-3'"
          >
            <TabsTrigger value="memories">
              {{ t('settings.memory.redesign.tabMemories') }}
            </TabsTrigger>
            <TabsTrigger v-if="personaTabVisible" value="persona">
              {{ t('settings.memory.redesign.tabPersona') }}
              <DcBadge
                v-if="(status?.personaDraftCount ?? 0) > 0"
                variant="secondary"
                class="ml-1.5 text-[10px]"
              >
                {{ status?.personaDraftCount }}
              </DcBadge>
            </TabsTrigger>
            <TabsTrigger value="directives">
              {{ t('settings.memory.redesign.tabDirectives') }}
              <DcBadge
                v-if="(status?.directiveDraftCount ?? 0) > 0"
                variant="secondary"
                class="ml-1.5 text-[10px]"
              >
                {{ status?.directiveDraftCount }}
              </DcBadge>
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
              @enable="openConfig"
            />
          </TabsContent>

          <TabsContent v-if="personaTabVisible" value="persona" class="mt-4 min-h-0 flex-1">
            <MemoryPersonaPanel
              :agent-id="selectedAgentId"
              :persona-evolution-enabled="personaEvolutionEnabled"
              :refresh-token="refreshToken"
            />
          </TabsContent>

          <TabsContent value="directives" class="mt-4 min-h-0 flex-1">
            <MemoryDirectivesPanel
              :agent-id="selectedAgentId"
              :memory-enabled="memoryEnabled"
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
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcBadge } from '@dc-ui/components/badge'
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
import MemoryDirectivesPanel from './MemoryDirectivesPanel.vue'
import MemoryInboxBar from './MemoryInboxBar.vue'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import MemoryListView from './MemoryListView.vue'
import MemoryPersonaPanel from './MemoryPersonaPanel.vue'
import { useMemoryInlineFeedback } from '../lib/useMemoryInlineFeedback'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'
type MemoryTab = 'memories' | 'persona' | 'directives' | 'diagnostics'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const configClient = createConfigClient()
const memoryClient = createMemoryClient()
const pageFeedbackController = useMemoryInlineFeedback('MemorySettings')
const pageFeedback = pageFeedbackController.feedback
const clearPageFeedback = pageFeedbackController.clear

const loading = ref(true)
const agents = ref<Agent[]>([])
const selectedAgentId = ref('')
const activeTab = ref<MemoryTab>('memories')
const resolvedSelected = ref<DeepChatAgentConfig | null>(null)
const resolvedAgentId = ref('')
const status = ref<MemoryStatusDto | null>(null)
const loadError = ref<string | null>(null)
const configOpen = ref(false)
const configSaving = ref(false)
const configPanelRef = ref<{ requestClose: () => Promise<void> } | null>(null)
const refreshToken = ref(0)
let statusRequestId = 0
let disposeUpdated: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

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
  } catch (error) {
    if (selectedAgentId.value !== agentId) return
    if (resolvedAgentId.value !== agentId) {
      resolvedSelected.value = null
      resolvedAgentId.value = agentId
    }
    pageFeedbackController.fail(error)
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
  } catch (error) {
    if (requestId !== statusRequestId || selectedAgentId.value !== agentId) return
    pageFeedbackController.fail(error)
  }
}

async function onSelect(value: unknown): Promise<void> {
  if (configSaving.value) return
  const id = typeof value === 'string' ? value : ''
  if (!id || id === selectedAgentId.value) return
  if (!(await settingsLeaveGuard.requestLeave())) return
  selectedAgentId.value = id
  void router.replace({ query: { ...route.query, agentId: id } })
}

function toggleConfig(): void {
  if (configOpen.value) void configPanelRef.value?.requestClose()
  else void openConfig()
}

async function openConfig(): Promise<void> {
  if (await settingsLeaveGuard.requestLeave()) configOpen.value = true
}

function isMemoryTab(value: unknown): value is MemoryTab {
  return (
    value === 'memories' || value === 'persona' || value === 'directives' || value === 'diagnostics'
  )
}

async function onTabChange(value: unknown): Promise<void> {
  if (!isMemoryTab(value) || value === activeTab.value) return
  if (await settingsLeaveGuard.requestLeave()) activeTab.value = value
}

async function reload(preferred?: string | null): Promise<void> {
  loading.value = true
  loadError.value = null
  clearPageFeedback()
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
    console.error('[MemorySettings] Failed to load agents', error)
    agents.value = []
    resolvedSelected.value = null
    resolvedAgentId.value = ''
    status.value = null
    loadError.value = t('settings.memory.redesign.configLoadFailed')
  } finally {
    loading.value = false
  }
}

async function refreshSelected(): Promise<void> {
  refreshToken.value += 1
  clearPageFeedback()
  await Promise.all([loadResolved(), loadStatus()])
}

function queueRefreshSelected(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshSelected()
  }, 100)
}

function handleConfigSaved(): void {
  void refreshSelected()
}

watch(selectedAgentId, () => {
  clearPageFeedback()
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  status.value = null
  // Children already react to the agentId prop change on their own; don't
  // also bump refreshToken here or they'd reload twice per switch.
  void Promise.all([loadResolved(), loadStatus()])
})

watch(
  () => route.query.agentId,
  (value) => {
    if (
      !configSaving.value &&
      typeof value === 'string' &&
      agents.value.some((agent) => agent.id === value)
    ) {
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
    queueRefreshSelected()
  })
})

onUnmounted(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  disposeUpdated?.()
  disposeUpdated = null
})
</script>
