<template>
  <div v-if="isMarketView" data-testid="settings-mcp-page" class="w-full h-full">
    <McpBuiltinMarket embedded @back="closeMarketView" />
  </div>

  <div
    v-else-if="showMcpSkeleton || agentPolicyLoading"
    data-testid="settings-mcp-page"
    class="flex h-full w-full flex-col gap-4 p-4"
  >
    <Skeleton class="h-16 rounded-xl bg-muted/40" />
    <Skeleton class="h-24 rounded-xl bg-muted/30" />
    <Skeleton class="h-10 rounded-xl bg-muted/20" />
    <Skeleton class="min-h-0 flex-1 rounded-xl bg-muted/20" />
  </div>

  <div
    v-else
    ref="guideRootRef"
    data-testid="settings-mcp-page"
    class="w-full h-full min-h-0 flex flex-col"
  >
    <div class="shrink-0 px-4 pt-4">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div :dir="languageStore.dir" class="min-w-0">
            <h1 class="text-lg font-semibold">{{ t('settings.mcp.center.title') }}</h1>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.mcp.enabledDescription') }}
            </p>
          </div>
          <div
            ref="mcpActionsRef"
            class="flex shrink-0 items-center gap-3"
            @click="handleMcpGuideTargetInteract"
          >
            <DcButton v-if="mcpEnabled" size="sm" @click="openAddServerDialog">
              <Icon icon="lucide:plus" class="size-4" />
              {{ t('common.add') }}
            </DcButton>
            <DcButton variant="outline" size="sm" @click="openMarketView">
              <Icon icon="lucide:shopping-bag" class="size-4" />
              {{ t('routes.settings-mcp-market') }}
            </DcButton>
            <Switch
              dir="ltr"
              :model-value="mcpEnabled"
              :disabled="isAgentScope || mcpMasterSaving"
              @update:model-value="handleMcpEnabledChange"
            />
          </div>
        </div>
      </div>
      <Separator class="mt-3" />
    </div>

    <!-- Server list -->
    <div class="min-h-0 flex-1 overflow-hidden">
      <div v-if="mcpEnabled" class="h-full min-h-0">
        <div
          v-if="agentPolicyError"
          role="alert"
          class="m-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
        >
          <span class="text-sm text-destructive">{{ agentPolicyError }}</span>
          <DcButton size="sm" variant="outline" @click="loadAgentPolicy">
            {{ t('common.retry') }}
          </DcButton>
        </div>
        <McpServers
          v-else
          ref="mcpServersRef"
          :show-footer-add-button="false"
          :server-enabled-overrides="serverEnabledOverrides"
          :server-loading-overrides="serverLoadingOverrides"
          :agent-scoped-toggle="isAgentScope"
          :agent-scoped-busy="Boolean(agentToggleServerName)"
          @toggle-agent-server="handleToggleAgentServer"
        >
          <template #status-bar>
            <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span class="text-xs text-muted-foreground">
                {{ t('settings.mcp.totalServers') }}:
                <span class="font-medium text-foreground">{{ mcpStore.serverList.length }}</span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('settings.mcp.center.running') }}:
                <span class="font-medium text-foreground">{{ runningCount }}</span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('settings.mcp.center.builtIn') }}:
                <span class="font-medium text-foreground">{{ builtInCount }}</span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('settings.mcp.center.custom') }}:
                <span class="font-medium text-foreground">{{ customCount }}</span>
              </span>
            </div>
          </template>

          <template #footer-actions-after>
            <Dialog :open="npmAdvancedDialogOpen" @update:open="handleNpmDialogOpenChange">
              <DialogTrigger as-child>
                <DcButton
                  variant="outline"
                  size="sm"
                  class="h-8 max-w-[18rem] gap-1.5 px-3 text-xs"
                  :title="npmRegistryStatus.currentRegistry || 'Default'"
                >
                  <Icon icon="lucide:settings-2" class="h-3.5 w-3.5 shrink-0" />
                  <span class="hidden text-muted-foreground sm:inline">
                    {{ t('settings.mcp.npmRegistry.title') }}
                  </span>
                  <span class="truncate font-mono">
                    {{ npmRegistryStatus.currentRegistry || 'Default' }}
                  </span>
                </DcButton>
              </DialogTrigger>
              <DialogContent class="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{{ t('settings.mcp.npmRegistry.title') }}</DialogTitle>
                  <DialogDescription>
                    {{ t('settings.mcp.npmRegistry.advancedSettings') }}
                  </DialogDescription>
                </DialogHeader>
                <div class="flex flex-col gap-4">
                  <div class="flex items-center justify-between gap-3 text-sm">
                    <span class="text-muted-foreground">
                      {{ t('settings.mcp.npmRegistry.currentSource') }}
                    </span>
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate font-mono text-xs">
                        {{ npmRegistryStatus.currentRegistry || 'Default' }}
                      </span>
                      <DcButton
                        variant="ghost"
                        size="icon-sm"
                        icon="lucide:refresh-cw"
                        :label="t('settings.mcp.npmRegistry.refresh')"
                        :tooltip="t('settings.mcp.npmRegistry.refresh')"
                        :loading="refreshing"
                        :disabled="npmRegistryBusy"
                        @click="refreshNpmRegistry"
                      />
                    </div>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-muted-foreground">
                      {{ t('settings.mcp.npmRegistry.autoDetect') }}
                    </span>
                    <Switch
                      :model-value="npmRegistryStatus.autoDetectEnabled"
                      :disabled="npmRegistryBusy"
                      @update:model-value="setAutoDetectNpmRegistry"
                    />
                  </div>
                  <Input
                    v-model="customRegistryInput"
                    :placeholder="t('settings.mcp.npmRegistry.customSourcePlaceholder')"
                    class="font-mono"
                    :disabled="npmRegistryBusy"
                    :aria-invalid="npmRegistryFeedback?.kind === 'error'"
                    @update:model-value="clearNpmRegistryFeedback"
                  />
                  <p
                    v-if="npmRegistryFeedback"
                    :role="npmRegistryFeedback.kind === 'error' ? 'alert' : 'status'"
                    class="text-xs"
                    :class="
                      npmRegistryFeedback.kind === 'error'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    "
                  >
                    {{ npmRegistryFeedback.message }}
                  </p>
                  <div class="flex gap-2">
                    <DcSubmitButton
                      variant="outline"
                      :status="npmRegistrySaveStatus"
                      :disabled="
                        !customRegistryInput.trim() ||
                        customRegistryInput.trim() === npmRegistryStatus.customRegistry ||
                        npmRegistryBusy
                      "
                      class="flex-1"
                      @click="saveCustomNpmRegistry"
                    >
                      {{ t('common.save') }}
                    </DcSubmitButton>
                    <DcSubmitButton
                      v-if="npmRegistryStatus.customRegistry"
                      variant="outline"
                      :status="npmRegistryClearStatus"
                      :disabled="npmRegistryBusy"
                      class="flex-1"
                      @click="clearCustomNpmRegistry"
                    >
                      {{ t('common.clear') }}
                    </DcSubmitButton>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </template>
        </McpServers>
      </div>
      <div v-else class="p-8 text-center text-muted-foreground text-sm">
        {{ t('settings.mcp.enableToAccess') }}
      </div>
    </div>
  </div>

  <GuidedOnboardingOverlay
    :visible="showMcpGuide"
    :container-el="guideRootRef"
    :target-el="mcpActionsRef"
    :eyebrow="t('welcome.page.guide.title')"
    :title="t('welcome.page.guide.steps.mcp')"
    :description="t('settings.mcp.enabledDescription')"
    :step-index="mcpGuide.stepIndex.value"
    :total-steps="mcpGuide.totalSteps.value"
    :close-label="t('common.close')"
    :back-label="mcpGuide.canGoPrevious?.value ? t('common.back') : undefined"
    :secondary-label="t('settings.skills.syncPrompt.skip')"
    :expert-label="t('settings.skills.sync.skipAll')"
    :primary-label="t('common.next')"
    @close="mcpGuide.dismissGuide"
    @back="handleMcpGuideBack"
    @secondary="handleMcpGuideSkip"
    @expert="handleMcpGuideExpert"
    @primary="handleMcpGuidePrimary"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, onMounted, watch } from 'vue'
import McpServers from '@/components/mcp-config/components/McpServers.vue'
import McpBuiltinMarket from './McpBuiltinMarket.vue'
import { Switch } from '@shadcn/components/ui/switch'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { Skeleton } from '@shadcn/components/ui/skeleton'
import { Icon } from '@iconify/vue'
import { Separator } from '@shadcn/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { useMcpStore } from '@/stores/mcp'
import { useLanguageStore } from '@/stores/language'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { useRoute, useRouter } from 'vue-router'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { createWindowClient } from '@api/WindowClient'
import { continueGuidedOnboardingFromSettings } from '../lib/guidedOnboardingSettings'
import { createConfigClient } from '@api/ConfigClient'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

const props = withDefaults(
  defineProps<{
    scope?: 'global' | 'agent'
  }>(),
  {
    scope: 'global'
  }
)

const { t } = useI18n()
const languageStore = useLanguageStore()
const mcpStore = useMcpStore()
const agentStore = useAgentStore()
const sessionStore = useSessionStore()
const configClient = createConfigClient()
const route = useRoute()
const router = useRouter()
const windowClient = createWindowClient()
const mcpServersRef = ref<{ openAddServerDialog: () => void } | null>(null)
const guideRootRef = ref<HTMLElement | null>(null)
const mcpActionsRef = ref<HTMLElement | null>(null)
const mcpGuide = useGuidedOnboardingStep('mcp')
const showMcpGuide = computed(() => mcpGuide.showGuide.value && Boolean(mcpActionsRef.value))

const mcpEnabled = computed(() => mcpStore.mcpEnabled)
const isMarketView = computed(() => route.query.view === 'market')
const showMcpSkeleton = computed(() => mcpStore.configLoading && !mcpStore.config.ready)

const npmRegistryStatus = ref<{
  currentRegistry: string | null
  isFromCache: boolean
  lastChecked?: number
  autoDetectEnabled: boolean
  customRegistry?: string
}>({
  currentRegistry: null,
  isFromCache: false,
  lastChecked: undefined,
  autoDetectEnabled: true,
  customRegistry: undefined
})

type NpmRegistryOperation = 'refresh' | 'auto-detect' | 'save' | 'clear'
type NpmRegistryFeedback = Readonly<{
  kind: 'info' | 'error'
  message: string
}>

const npmRegistryOperation = ref<NpmRegistryOperation | null>(null)
const { status: npmRegistrySaveStatus, run: runSaveNpmRegistry } = useDcFormSubmit()
const { status: npmRegistryClearStatus, run: runClearNpmRegistry } = useDcFormSubmit()
const npmRegistryBusy = computed(
  () =>
    npmRegistryOperation.value !== null ||
    npmRegistrySaveStatus.value === 'submitting' ||
    npmRegistryClearStatus.value === 'submitting'
)
const refreshing = computed(() => npmRegistryOperation.value === 'refresh')
const npmRegistryFeedback = ref<NpmRegistryFeedback | null>(null)
const customRegistryInput = ref('')
const npmAdvancedDialogOpen = ref(false)
const targetAgent = ref<Agent | null>(null)
const targetAgentConfig = ref<DeepChatAgentConfig>({})
const agentPolicyLoading = ref(false)
const agentPolicyRequestId = ref(0)
const agentPolicyError = ref<string | null>(null)
const agentToggleServerName = ref<string | null>(null)
const mcpMasterSaving = ref(false)

const normalizeList = (value: string[] | null | undefined): string[] =>
  Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  )
const isAgentScope = computed(() => props.scope === 'agent')
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
const globallyAvailableServerIds = computed(() =>
  normalizeList(
    mcpStore.serverList
      .filter((server) => {
        const config = mcpStore.config.mcpServers[server.name]
        return config?.enabled !== false && !config?.disable
      })
      .map((server) => server.name)
  )
)
const agentEnabledMcpServerIds = computed(() => targetAgentConfig.value.enabledMcpServerIds)
const agentEnabledMcpServerSet = computed(() => {
  const enabledServerIds = agentEnabledMcpServerIds.value
  if (enabledServerIds === null || enabledServerIds === undefined) {
    return new Set(globallyAvailableServerIds.value)
  }
  return new Set(normalizeList(enabledServerIds))
})
const serverEnabledOverrides = computed<Record<string, boolean>>(() => {
  if (!isAgentScope.value) {
    return {}
  }

  return Object.fromEntries(
    mcpStore.serverList.map((server) => [
      server.name,
      agentEnabledMcpServerSet.value.has(server.name)
    ])
  )
})
const serverLoadingOverrides = computed<Record<string, boolean>>(() =>
  agentToggleServerName.value ? { [agentToggleServerName.value]: true } : {}
)
const runningCount = computed(() => mcpStore.serverList.filter((server) => server.isRunning).length)
const builtInCount = computed(
  () =>
    mcpStore.serverList.filter((server) => {
      const config = mcpStore.config.mcpServers[server.name]
      return config?.type === 'inmemory' || config?.source === 'deepchat'
    }).length
)
const customCount = computed(() => Math.max(mcpStore.serverList.length - builtInCount.value, 0))

const handleMcpGuidePrimary = async () => {
  if (mcpGuide.currentStepId.value !== 'mcp') {
    return
  }

  const stepStatus = mcpGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  const state = await mcpGuide.completeStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleMcpGuideTargetInteract = async () => {
  await handleMcpGuidePrimary()
}

const handleMcpGuideBack = async () => {
  const state = await mcpGuide.activatePreviousStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleMcpGuideSkip = async () => {
  const state = await mcpGuide.skipStep()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleMcpGuideExpert = async () => {
  const state = await mcpGuide.forceComplete()
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    windowClient
  })
}

const handleMcpEnabledChange = async (enabled: boolean) => {
  if (mcpMasterSaving.value) return
  mcpMasterSaving.value = true
  let success = false
  try {
    success = await mcpStore.setMcpEnabled(enabled)
  } catch (error) {
    console.error('[McpSettings] Failed to update the MCP master switch:', error)
  } finally {
    mcpMasterSaving.value = false
  }
  if (!success) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.masterToggleFailed',
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed')
    })
  }
}

watch(targetAgentId, () => {
  void loadAgentPolicy()
})

const loadAgentPolicy = async () => {
  if (!isAgentScope.value) {
    agentPolicyRequestId.value += 1
    targetAgent.value = null
    targetAgentConfig.value = {}
    agentPolicyLoading.value = false
    agentPolicyError.value = null
    return
  }

  const requestId = ++agentPolicyRequestId.value
  const requestedAgentId = targetAgentId.value
  agentPolicyLoading.value = true
  agentPolicyError.value = null
  try {
    const agents = await configClient.listAgents({
      agentType: 'deepchat',
      ids: [requestedAgentId]
    })
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    const agent = agents[0] ?? null
    if (!agent) {
      targetAgent.value = null
      targetAgentConfig.value = {}
      agentPolicyError.value = t('settings.pluginsHub.agentScopeUnsupported')
      return
    }

    const effectiveConfig = await configClient.resolveDeepChatAgentConfig(requestedAgentId)
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    targetAgent.value = agent
    targetAgentConfig.value = effectiveConfig ?? agent?.config ?? {}
  } catch (error) {
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    targetAgent.value = null
    targetAgentConfig.value = {}
    console.error('[McpSettings] Failed to load agent MCP policy:', error)
    agentPolicyError.value = t('common.error.requestFailed')
  } finally {
    if (requestId === agentPolicyRequestId.value && requestedAgentId === targetAgentId.value) {
      agentPolicyLoading.value = false
    }
  }
}

const buildNextAgentMcpServerIds = (serverName: string, enabled: boolean): string[] => {
  const currentPolicy = agentEnabledMcpServerIds.value
  const visibleServerIds = globallyAvailableServerIds.value
  const nextSet =
    currentPolicy === null || currentPolicy === undefined
      ? new Set(visibleServerIds)
      : new Set(normalizeList(currentPolicy))

  if (enabled && visibleServerIds.includes(serverName)) {
    nextSet.add(serverName)
  } else {
    nextSet.delete(serverName)
  }

  return normalizeList(Array.from(nextSet))
}

const handleToggleAgentServer = async (serverName: string, enabled: boolean) => {
  if (agentToggleServerName.value) return
  const agent = targetAgent.value
  if (!agent || !isDeepChatTarget.value) {
    agentPolicyError.value = t('settings.pluginsHub.agentScopeUnsupported')
    return
  }

  const previousConfig = targetAgentConfig.value
  const enabledMcpServerIds = buildNextAgentMcpServerIds(serverName, enabled)
  const requestedAgentId = agent.id
  agentToggleServerName.value = serverName
  targetAgentConfig.value = {
    ...previousConfig,
    enabledMcpServerIds
  }
  try {
    const updatedAgent = await configClient.updateDeepChatAgent(requestedAgentId, {
      config: {
        enabledMcpServerIds
      }
    })
    if (!updatedAgent) {
      throw new Error(`Agent "${requestedAgentId}" no longer exists`)
    }

    if (targetAgentId.value !== requestedAgentId) {
      return
    }

    targetAgent.value = updatedAgent
    targetAgentConfig.value = {
      ...targetAgentConfig.value,
      ...updatedAgent.config,
      enabledMcpServerIds
    }
    notifyRenderer({
      kind: 'success',
      code: 'settings.agentMcpPolicy.saved',
      title: t('settings.mcp.saveSuccess')
    })
    try {
      await agentStore.refreshAgentsByIds('deepchat', [requestedAgentId])
    } catch (refreshError) {
      console.warn('[McpSettings] Agent cache refresh failed after MCP policy save:', refreshError)
    }
  } catch (error) {
    console.error('[McpSettings] Failed to save agent MCP policy:', error)
    if (targetAgentId.value === requestedAgentId) {
      targetAgentConfig.value = previousConfig
    }
    notifyRenderer({
      kind: 'error',
      code: 'settings.agentMcpPolicy.saveFailed',
      title: t('settings.mcp.saveFailed'),
      description: t('common.error.requestFailed')
    })
  } finally {
    agentToggleServerName.value = null
  }
}

const openAddServerDialog = () => {
  mcpServersRef.value?.openAddServerDialog()
}

const loadNpmRegistryStatus = async (reportError = true): Promise<boolean> => {
  try {
    const status = await mcpStore.getNpmRegistryStatus()
    npmRegistryStatus.value = status
    customRegistryInput.value = status.customRegistry || ''
    return true
  } catch (error) {
    console.error('Failed to load npm registry status:', error)
    if (reportError) {
      npmRegistryFeedback.value = {
        kind: 'error',
        message: t('settings.mcp.npmRegistry.updateFailed')
      }
    }
    return false
  }
}

const refreshNpmRegistry = async () => {
  if (npmRegistryBusy.value) return
  npmRegistryOperation.value = 'refresh'
  npmRegistryFeedback.value = null
  try {
    const registry = await mcpStore.refreshNpmRegistry()
    npmRegistryStatus.value = {
      ...npmRegistryStatus.value,
      currentRegistry: registry
    }
    await loadNpmRegistryStatus(false)
    npmRegistryFeedback.value = null
  } catch (error) {
    console.error('Failed to refresh npm registry:', error)
    npmRegistryFeedback.value = {
      kind: 'error',
      message: t('settings.mcp.npmRegistry.refreshFailed')
    }
  } finally {
    npmRegistryOperation.value = null
  }
}

const setAutoDetectNpmRegistry = async (enabled: boolean) => {
  if (npmRegistryBusy.value) return
  npmRegistryOperation.value = 'auto-detect'
  npmRegistryFeedback.value = null
  try {
    await mcpStore.setAutoDetectNpmRegistry(enabled)
    npmRegistryStatus.value = {
      ...npmRegistryStatus.value,
      autoDetectEnabled: enabled
    }
    await loadNpmRegistryStatus(false)
    npmRegistryFeedback.value = null
  } catch (error) {
    console.error('Failed to set auto detect npm registry:', error)
    npmRegistryFeedback.value = {
      kind: 'error',
      message: t('settings.mcp.npmRegistry.updateFailed')
    }
  } finally {
    npmRegistryOperation.value = null
  }
}

const normalizeNpmRegistryUrl = (registry: string): string => {
  let normalized = registry.trim()
  if (!normalized.endsWith('/')) {
    normalized += '/'
  }
  return normalized
}

const validateCustomRegistry = async (registry: string): Promise<boolean> => {
  try {
    if (!registry.startsWith('http://') && !registry.startsWith('https://')) {
      npmRegistryFeedback.value = {
        kind: 'error',
        message: t('settings.mcp.npmRegistry.invalidUrlDesc')
      }
      return false
    }
    const normalizedRegistry = normalizeNpmRegistryUrl(registry)
    const testPackage = 'tiny-runtime-injector'
    const testUrl = `${normalizedRegistry}${testPackage}`
    npmRegistryFeedback.value = {
      kind: 'info',
      message: t('settings.mcp.npmRegistry.testing')
    }
    const response = await fetch(testUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return true
  } catch (error) {
    console.error('Custom registry validation failed:', error)
    npmRegistryFeedback.value = {
      kind: 'error',
      message: t('settings.mcp.npmRegistry.testFailed')
    }
    return false
  }
}

const saveCustomNpmRegistry = async () => {
  if (npmRegistryBusy.value) return
  const registry = customRegistryInput.value.trim()
  if (!registry) return

  try {
    await runSaveNpmRegistry(async () => {
      const isValid = await validateCustomRegistry(registry)
      if (!isValid) {
        throw new Error('registry validation failed')
      }
      try {
        await mcpStore.setCustomNpmRegistry(registry)
        const normalizedRegistry = normalizeNpmRegistryUrl(registry)
        npmRegistryStatus.value = {
          ...npmRegistryStatus.value,
          currentRegistry: normalizedRegistry,
          isFromCache: false,
          customRegistry: normalizedRegistry
        }
        customRegistryInput.value = normalizedRegistry
        await loadNpmRegistryStatus(false)
        npmRegistryFeedback.value = null
      } catch (error) {
        console.error('Failed to save custom npm registry:', error)
        npmRegistryFeedback.value = {
          kind: 'error',
          message: t('settings.mcp.npmRegistry.updateFailed')
        }
        throw error
      }
    })
  } catch {
    // 校验/持久化失败已通过 npmRegistryFeedback 内联展示，按钮态已置 ⚠
  }
}

const clearCustomNpmRegistry = async () => {
  if (npmRegistryBusy.value) return
  try {
    await runClearNpmRegistry(async () => {
      try {
        await mcpStore.setCustomNpmRegistry(undefined)
        customRegistryInput.value = ''
        npmRegistryStatus.value = {
          ...npmRegistryStatus.value,
          customRegistry: undefined
        }
        npmRegistryFeedback.value = {
          kind: 'info',
          message: t('settings.mcp.npmRegistry.redetectingOptimal')
        }
        try {
          await mcpStore.clearNpmRegistryCache()
          const registry = await mcpStore.refreshNpmRegistry()
          npmRegistryStatus.value = {
            ...npmRegistryStatus.value,
            currentRegistry: registry,
            isFromCache: true
          }
          await loadNpmRegistryStatus(false)
          npmRegistryFeedback.value = null
        } catch (detectError) {
          console.error('Failed to re-detect optimal registry:', detectError)
          await loadNpmRegistryStatus(false)
          npmRegistryFeedback.value = {
            kind: 'error',
            message: t('settings.mcp.npmRegistry.redetectFailedDesc')
          }
          throw detectError
        }
      } catch (error) {
        console.error('Failed to clear custom npm registry:', error)
        npmRegistryFeedback.value = {
          kind: 'error',
          message: t('settings.mcp.npmRegistry.updateFailed')
        }
        throw error
      }
    })
  } catch {
    // 失败已通过 npmRegistryFeedback 内联展示，按钮态已置 ⚠
  }
}

const clearNpmRegistryFeedback = () => {
  if (!npmRegistryBusy.value) {
    npmRegistryFeedback.value = null
  }
}

const handleNpmDialogOpenChange = (open: boolean) => {
  if (!open && npmRegistryBusy.value) return
  npmAdvancedDialogOpen.value = open
  if (!open) npmRegistryFeedback.value = null
}

onMounted(() => {
  void loadNpmRegistryStatus()
  void loadAgentPolicy()
})

const closeMarketView = async () => {
  const nextQuery = { ...route.query }
  delete nextQuery.view

  const routeName =
    typeof router.hasRoute === 'function' && router.hasRoute('plugins-mcp')
      ? 'plugins-mcp'
      : 'settings-mcp'
  await router.replace({
    name: routeName,
    query: nextQuery
  })
}

const openMarketView = async () => {
  const routeName =
    typeof router.hasRoute === 'function' && router.hasRoute('plugins-mcp')
      ? 'plugins-mcp'
      : 'settings-mcp'
  await router.push({
    name: routeName,
    query: {
      ...route.query,
      view: 'market'
    }
  })
}
</script>
