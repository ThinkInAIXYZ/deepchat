<template>
  <div v-if="isMarketView" data-testid="settings-mcp-page" class="w-full h-full">
    <McpBuiltinMarket embedded @back="closeMarketView" />
  </div>

  <div
    v-else-if="showMcpSkeleton || agentPolicyLoading"
    data-testid="settings-mcp-page"
    class="w-full h-full flex flex-col p-4 gap-4 animate-pulse"
  >
    <div class="h-16 rounded-xl bg-muted/40"></div>
    <div class="h-24 rounded-xl bg-muted/30"></div>
    <div class="h-10 rounded-xl bg-muted/20"></div>
    <div class="flex-1 rounded-xl bg-muted/20"></div>
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
            <Button v-if="mcpEnabled" size="sm" @click="openAddServerDialog">
              <Icon icon="lucide:plus" class="size-4" />
              {{ t('common.add') }}
            </Button>
            <Button variant="outline" size="sm" @click="openMarketView">
              <Icon icon="lucide:shopping-bag" class="size-4" />
              {{ t('routes.settings-mcp-market') }}
            </Button>
            <Switch
              dir="ltr"
              :model-value="mcpEnabled"
              :disabled="isAgentScope"
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
        <McpServers
          ref="mcpServersRef"
          :show-footer-add-button="false"
          :server-enabled-overrides="serverEnabledOverrides"
          :agent-scoped-toggle="isAgentScope"
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
            <Dialog v-model:open="npmAdvancedDialogOpen">
              <DialogTrigger as-child>
                <Button
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
                </Button>
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
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        :disabled="refreshing"
                        @click="refreshNpmRegistry"
                      >
                        <Icon
                          :icon="refreshing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                          :class="refreshing ? 'size-4 animate-spin' : 'size-4'"
                        />
                      </Button>
                    </div>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-muted-foreground">
                      {{ t('settings.mcp.npmRegistry.autoDetect') }}
                    </span>
                    <Switch
                      :model-value="npmRegistryStatus.autoDetectEnabled"
                      @update:model-value="setAutoDetectNpmRegistry"
                    />
                  </div>
                  <Input
                    v-model="customRegistryInput"
                    :placeholder="t('settings.mcp.npmRegistry.customSourcePlaceholder')"
                    class="font-mono"
                  />
                  <div class="flex gap-2">
                    <Button
                      variant="outline"
                      :disabled="
                        !customRegistryInput.trim() ||
                        customRegistryInput.trim() === npmRegistryStatus.customRegistry
                      "
                      class="flex-1"
                      @click="saveCustomNpmRegistry"
                    >
                      {{ t('common.save') }}
                    </Button>
                    <Button
                      v-if="npmRegistryStatus.customRegistry"
                      variant="outline"
                      class="flex-1"
                      @click="clearCustomNpmRegistry"
                    >
                      {{ t('common.clear') }}
                    </Button>
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
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
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
import { useMcpStore } from '@/stores/mcp'
import { useLanguageStore } from '@/stores/language'
import { useAgentStore } from '@/stores/ui/agent'
import { useSessionStore } from '@/stores/ui/session'
import { useToast } from '@/components/use-toast'
import { useRoute, useRouter } from 'vue-router'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { createWindowClient } from '@api/WindowClient'
import { continueGuidedOnboardingFromSettings } from '../lib/guidedOnboardingSettings'
import { createConfigClient } from '@api/ConfigClient'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'

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
const { toast } = useToast()
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

const refreshing = ref(false)
const customRegistryInput = ref('')
const npmAdvancedDialogOpen = ref(false)
const targetAgent = ref<Agent | null>(null)
const targetAgentConfig = ref<DeepChatAgentConfig>({})
const agentPolicyLoading = ref(false)
const agentPolicyRequestId = ref(0)

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
  await mcpStore.setMcpEnabled(enabled)
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
    return
  }

  const requestId = ++agentPolicyRequestId.value
  const requestedAgentId = targetAgentId.value
  agentPolicyLoading.value = true
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
      return
    }

    const effectiveConfig = await configClient.resolveDeepChatAgentConfig(requestedAgentId)
    if (requestId !== agentPolicyRequestId.value || requestedAgentId !== targetAgentId.value) {
      return
    }

    targetAgent.value = agent
    targetAgentConfig.value = effectiveConfig ?? agent?.config ?? {}
  } catch (error) {
    if (requestId !== agentPolicyRequestId.value) {
      return
    }

    targetAgent.value = null
    targetAgentConfig.value = {}
    toast({
      title: t('settings.pluginsHub.agentScopeUnsupported'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    if (requestId === agentPolicyRequestId.value) {
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
  if (!targetAgent.value || !isDeepChatTarget.value) {
    toast({
      title: t('settings.pluginsHub.agentScopeUnsupported'),
      variant: 'destructive'
    })
    return
  }

  try {
    const enabledMcpServerIds = buildNextAgentMcpServerIds(serverName, enabled)
    const updatedAgent = await configClient.updateDeepChatAgent(targetAgent.value.id, {
      config: {
        enabledMcpServerIds
      }
    })
    targetAgent.value = updatedAgent ?? targetAgent.value
    targetAgentConfig.value = {
      ...targetAgentConfig.value,
      ...updatedAgent?.config,
      enabledMcpServerIds
    }
    await agentStore.refreshAgentsByIds('deepchat', [targetAgent.value.id])
    toast({
      title: t('settings.mcp.saveSuccess')
    })
  } catch (error) {
    toast({
      title: t('settings.mcp.saveFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const openAddServerDialog = () => {
  mcpServersRef.value?.openAddServerDialog()
}

const loadNpmRegistryStatus = async () => {
  try {
    const status = await mcpStore.getNpmRegistryStatus()
    npmRegistryStatus.value = status
    customRegistryInput.value = status.customRegistry || ''
  } catch (error) {
    console.error('Failed to load npm registry status:', error)
  }
}

const refreshNpmRegistry = async () => {
  try {
    refreshing.value = true
    await mcpStore.refreshNpmRegistry()
    await loadNpmRegistryStatus()
    toast({
      title: t('settings.mcp.npmRegistry.refreshSuccess'),
      description: t('settings.mcp.npmRegistry.refreshSuccessDesc')
    })
  } catch (error) {
    console.error('Failed to refresh npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.refreshFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    refreshing.value = false
  }
}

const setAutoDetectNpmRegistry = async (enabled: boolean) => {
  try {
    await mcpStore.setAutoDetectNpmRegistry(enabled)
    await loadNpmRegistryStatus()
    toast({
      title: t('settings.mcp.npmRegistry.autoDetectUpdated'),
      description: enabled
        ? t('settings.mcp.npmRegistry.autoDetectEnabled')
        : t('settings.mcp.npmRegistry.autoDetectDisabled')
    })
  } catch (error) {
    console.error('Failed to set auto detect npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
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
      toast({
        title: t('settings.mcp.npmRegistry.invalidUrl'),
        description: t('settings.mcp.npmRegistry.invalidUrlDesc'),
        variant: 'destructive'
      })
      return false
    }
    const normalizedRegistry = normalizeNpmRegistryUrl(registry)
    const testPackage = 'tiny-runtime-injector'
    const testUrl = `${normalizedRegistry}${testPackage}`
    toast({
      title: t('settings.mcp.npmRegistry.testing'),
      description: t('settings.mcp.npmRegistry.testingDesc', { registry: normalizedRegistry })
    })
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
    toast({
      title: t('settings.mcp.npmRegistry.testFailed'),
      description: t('settings.mcp.npmRegistry.testFailedDesc', {
        registry: normalizeNpmRegistryUrl(registry),
        error: error instanceof Error ? error.message : String(error)
      }),
      variant: 'destructive'
    })
    return false
  }
}

const saveCustomNpmRegistry = async () => {
  try {
    const registry = customRegistryInput.value.trim()
    if (!registry) {
      return
    }
    const isValid = await validateCustomRegistry(registry)
    if (!isValid) {
      return
    }
    await mcpStore.setCustomNpmRegistry(registry)
    await loadNpmRegistryStatus()
    const normalizedRegistry = npmRegistryStatus.value.customRegistry
    if (normalizedRegistry) {
      customRegistryInput.value = normalizedRegistry
    }
    toast({
      title: t('settings.mcp.npmRegistry.customSourceSet'),
      description: t('settings.mcp.npmRegistry.customSourceSetDesc', {
        registry: normalizedRegistry || registry
      })
    })
  } catch (error) {
    console.error('Failed to save custom npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const clearCustomNpmRegistry = async () => {
  try {
    await mcpStore.setCustomNpmRegistry(undefined)
    customRegistryInput.value = ''
    await mcpStore.clearNpmRegistryCache()
    toast({
      title: t('settings.mcp.npmRegistry.customSourceCleared'),
      description: t('settings.mcp.npmRegistry.redetectingOptimal')
    })
    try {
      await mcpStore.refreshNpmRegistry()
      await loadNpmRegistryStatus()
      toast({
        title: t('settings.mcp.npmRegistry.redetectComplete'),
        description: t('settings.mcp.npmRegistry.redetectCompleteDesc')
      })
      npmAdvancedDialogOpen.value = false
    } catch (detectError) {
      console.error('Failed to re-detect optimal registry:', detectError)
      await loadNpmRegistryStatus()
      toast({
        title: t('settings.mcp.npmRegistry.redetectFailed'),
        description: t('settings.mcp.npmRegistry.redetectFailedDesc'),
        variant: 'destructive'
      })
      npmAdvancedDialogOpen.value = false
    }
  } catch (error) {
    console.error('Failed to clear custom npm registry:', error)
    toast({
      title: t('settings.mcp.npmRegistry.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

onMounted(() => {
  loadNpmRegistryStatus()
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
