<template>
  <div class="w-full h-full flex flex-col">
    <div class="shrink-0 px-4 pt-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">{{ t('settings.acp.enabledTitle') }}</div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.acp.enabledDescription') }}
          </p>
        </div>
        <Switch
          dir="ltr"
          :model-value="acpEnabled"
          class="scale-125"
          :disabled="toggling"
          @update:model-value="handleToggle"
        />
      </div>
      <div v-if="acpEnabled" class="flex items-center justify-between mt-4">
        <div>
          <div class="font-medium">{{ t('settings.acp.useBuiltinRuntimeTitle') }}</div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.acp.useBuiltinRuntimeDescription') }}
          </p>
        </div>
        <Switch
          dir="ltr"
          :model-value="useBuiltinRuntime"
          class="scale-125"
          :disabled="togglingUseBuiltinRuntime"
          @update:model-value="handleUseBuiltinRuntimeToggle"
        />
      </div>
      <Separator class="mt-3" />
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="acpEnabled" class="p-4 space-y-6">
        <section class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">
                {{ t('settings.acp.builtinSectionTitle') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.builtinSectionDescription') }}
              </p>
            </div>
          </div>

          <div
            v-if="loading && !builtins.length"
            class="text-sm text-muted-foreground text-center py-8"
          >
            {{ t('settings.acp.loading') }}
          </div>

          <div v-else class="grid gap-3 md:grid-cols-2">
            <Card v-for="agent in builtins" :key="agent.id">
              <CardHeader class="pb-2">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle class="text-base flex items-center gap-2">
                      <span>{{ agent.name }}</span>
                      <Badge v-if="!agent.enabled" variant="outline">
                        {{ t('settings.acp.disabledBadge') }}
                      </Badge>
                    </CardTitle>
                    <CardDescription class="text-xs">
                      {{ t('settings.acp.builtinHint', { name: agent.name }) }}
                    </CardDescription>
                  </div>
                  <Switch
                    :model-value="agent.enabled"
                    :disabled="isBuiltinPending(agent.id) || loading"
                    @update:model-value="(value) => handleBuiltinToggle(agent, value)"
                  />
                </div>
              </CardHeader>
              <CardContent class="space-y-3 text-sm">
                <div class="space-y-1">
                  <div class="text-xs font-semibold text-muted-foreground">
                    {{ t('settings.acp.activeProfile') }}
                  </div>
                  <Select
                    :model-value="agent.activeProfileId || undefined"
                    :disabled="!agent.enabled || isBuiltinPending(agent.id)"
                    @update:model-value="
                      (value) =>
                        typeof value === 'string' && handleActiveProfileChange(agent, value)
                    "
                  >
                    <SelectTrigger class="w-full">
                      <SelectValue :placeholder="t('settings.acp.profilePlaceholder')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="profile in agent.profiles"
                        :key="profile.id"
                        :value="profile.id"
                      >
                        {{ profile.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="text-xs text-muted-foreground space-y-1 overflow-hidden">
                  <div class="flex items-start gap-1 overflow-hidden">
                    <span class="font-semibold">CMD:</span>
                    <span class="truncate" :title="getActiveProfile(agent)?.command || undefined">
                      {{ getActiveProfile(agent)?.command ?? '—' }}
                    </span>
                  </div>
                  <div class="flex items-start gap-1 overflow-hidden">
                    <span class="font-semibold">ARGS:</span>
                    <span class="truncate" :title="formatArgs(getActiveProfile(agent)?.args)">
                      {{ formatArgs(getActiveProfile(agent)?.args) }}
                    </span>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" @click="openBuiltinProfileDialog(agent)">
                    {{ t('settings.acp.addProfile') }}
                  </Button>
                  <Button size="sm" variant="ghost" @click="openProfileManager(agent)">
                    {{ t('settings.acp.manageProfiles') }}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="isInitializing(agent.id, true)"
                    @click="handleInitializeAgent(agent.id, true)"
                  >
                    {{
                      isInitializing(agent.id, true)
                        ? t('settings.acp.initializing')
                        : t('settings.acp.initialize')
                    }}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator />

        <section class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">
                {{ t('settings.acp.customSectionTitle') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.customSectionDescription') }}
              </p>
            </div>
            <Button size="sm" @click="openCustomAgentDialog()">
              {{ t('settings.acp.addCustomAgent') }}
            </Button>
          </div>

          <div
            v-if="loading && !customAgents.length"
            class="text-sm text-muted-foreground text-center py-8"
          >
            {{ t('settings.acp.loading') }}
          </div>
          <div
            v-else-if="!customAgents.length"
            class="text-sm text-muted-foreground text-center py-8"
          >
            {{ t('settings.acp.customEmpty') }}
          </div>
          <div v-else class="space-y-3">
            <Card v-for="agent in customAgents" :key="agent.id">
              <CardHeader class="pb-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <CardTitle class="text-base truncate" :title="agent.name">
                      {{ agent.name }}
                    </CardTitle>
                    <CardDescription
                      class="text-xs text-muted-foreground truncate"
                      :title="agent.command"
                    >
                      {{ agent.command }}
                    </CardDescription>
                  </div>
                  <Switch
                    :model-value="agent.enabled"
                    :disabled="isCustomPending(agent.id)"
                    @update:model-value="(value) => handleCustomToggle(agent, value)"
                  />
                </div>
              </CardHeader>
              <CardContent class="text-xs space-y-1 text-muted-foreground overflow-hidden">
                <div class="flex items-start gap-1 overflow-hidden">
                  <span class="font-semibold">CMD:</span>
                  <span class="truncate" :title="agent.command">{{ agent.command }}</span>
                </div>
                <div class="flex items-start gap-1 overflow-hidden">
                  <span class="font-semibold">ARGS:</span>
                  <span class="truncate" :title="formatArgs(agent.args)">
                    {{ formatArgs(agent.args) }}
                  </span>
                </div>
                <div class="flex gap-2 pt-2">
                  <Button size="sm" variant="ghost" @click="openCustomAgentDialog(agent)">
                    {{ t('common.edit') }}
                  </Button>
                  <Button size="sm" variant="ghost" @click="deleteCustomAgent(agent)">
                    {{ t('common.delete') }}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="isInitializing(agent.id, false)"
                    @click="handleInitializeAgent(agent.id, false)"
                  >
                    {{
                      isInitializing(agent.id, false)
                        ? t('settings.acp.initializing')
                        : t('settings.acp.initialize')
                    }}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
      <div v-else class="p-6 text-sm text-muted-foreground text-center">
        {{ t('settings.acp.enableToAccess') }}
      </div>
    </div>

    <AcpProfileManagerDialog
      :open="profileManagerState.open"
      :agent="profileManagerAgent"
      @update:open="(value) => (profileManagerState.open = value)"
      @add-profile="handleManagerAdd"
      @edit-profile="handleManagerEdit"
      @delete-profile="handleManagerDelete"
      @set-active="handleManagerActivate"
    />

    <AcpProfileDialog
      :open="profileDialogState.open"
      :title="profileDialogState.title"
      :description="profileDialogState.description"
      :kind="profileDialogState.kind"
      :profile="profileDialogState.profile"
      :saving="savingProfile"
      :confirm-label="profileDialogState.confirmLabel"
      @update:open="(value) => (profileDialogState.open = value)"
      @save="handleProfileSave"
    />

    <AcpTerminalDialog
      :open="terminalDialogOpen"
      @update:open="(value) => (terminalDialogOpen = value)"
      @dependencies-required="handleDependenciesRequired"
    />

    <AcpDependencyDialog
      :open="dependencyDialogOpen"
      :dependencies="missingDependencies"
      @update:open="(value) => (dependencyDialogOpen = value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type {
  AcpAgentProfile,
  AcpBuiltinAgent,
  AcpBuiltinAgentId,
  AcpCustomAgent
} from '@shared/presenter'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Separator } from '@shadcn/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import AcpProfileDialog from './AcpProfileDialog.vue'
import AcpProfileManagerDialog from './AcpProfileManagerDialog.vue'
import AcpTerminalDialog from './AcpTerminalDialog.vue'
import AcpDependencyDialog from './AcpDependencyDialog.vue'

const { t } = useI18n()
const { toast } = useToast()

const configPresenter = usePresenter('configPresenter')
const llmProviderPresenter = usePresenter('llmproviderPresenter')

const acpEnabled = ref(false)
const toggling = ref(false)
const useBuiltinRuntime = ref(false)
const togglingUseBuiltinRuntime = ref(false)
const loading = ref(false)
const builtins = ref<AcpBuiltinAgent[]>([])
const customAgents = ref<AcpCustomAgent[]>([])
const savingProfile = ref(false)

const builtinPending = reactive<Record<string, boolean>>({})
const customPending = reactive<Record<string, boolean>>({})
const initializing = reactive<Record<string, boolean>>({})
const terminalDialogOpen = ref(false)
const dependencyDialogOpen = ref(false)
const missingDependencies = ref<
  Array<{
    name: string
    description: string
    platform?: string[]
    checkCommand?: string
    checkPaths?: string[]
    installCommands?: {
      winget?: string
      chocolatey?: string
      scoop?: string
    }
    downloadUrl?: string
    requiredFor?: string[]
  }>
>([])

const profileDialogState = reactive({
  open: false,
  mode: 'builtin-add' as ProfileDialogMode,
  kind: 'builtin' as ProfileKind,
  title: '',
  description: '',
  confirmLabel: '',
  builtinId: null as AcpBuiltinAgentId | null,
  customId: null as string | null,
  profileId: null as string | null,
  profile: null as ProfilePayload | null
})

const profileManagerState = reactive({
  open: false,
  agentId: null as AcpBuiltinAgentId | null
})

const profileManagerAgent = computed(() =>
  profileManagerState.agentId
    ? (builtins.value.find((agent) => agent.id === profileManagerState.agentId) ?? null)
    : null
)

const activeProfileMap = computed<Record<string, AcpAgentProfile | null>>(() => {
  const map: Record<string, AcpAgentProfile | null> = {}
  builtins.value.forEach((agent) => {
    const profile =
      agent.profiles.find((item) => item.id === agent.activeProfileId) ?? agent.profiles[0] ?? null
    map[agent.id] = profile
  })
  return map
})

const isBuiltinPending = (id: string) => Boolean(builtinPending[id])
const isCustomPending = (id: string) => Boolean(customPending[id])

const setBuiltinPending = (id: string, state: boolean) => {
  if (state) builtinPending[id] = true
  else delete builtinPending[id]
}

const setCustomPending = (id: string, state: boolean) => {
  if (state) customPending[id] = true
  else delete customPending[id]
}

type ProfileKind = 'builtin' | 'custom'
type ProfileDialogMode = 'builtin-add' | 'builtin-edit' | 'custom-add' | 'custom-edit'
type ProfilePayload = Omit<AcpAgentProfile, 'id'>

const getActiveProfile = (agent: AcpBuiltinAgent) => activeProfileMap.value[agent.id]

const formatArgs = (args?: string[] | null) => {
  if (!args || !args.length) {
    return t('settings.acp.none')
  }
  const filtered = args
    .map((arg) => arg?.trim())
    .filter((arg): arg is string => Boolean(arg && arg.length))
  if (!filtered.length) {
    return t('settings.acp.none')
  }
  return filtered.join(' ')
}

const handleError = (error: unknown, descriptionKey?: string) => {
  console.error('[ACP] settings error:', error)
  toast({
    title: t('settings.acp.saveFailed'),
    description: descriptionKey
      ? t(descriptionKey)
      : error instanceof Error
        ? error.message
        : String(error),
    variant: 'destructive'
  })
}

const loadAcpEnabled = async () => {
  try {
    acpEnabled.value = await configPresenter.getAcpEnabled()
  } catch (error) {
    handleError(error)
  }
}

const loadAcpUseBuiltinRuntime = async () => {
  try {
    useBuiltinRuntime.value = await configPresenter.getAcpUseBuiltinRuntime()
  } catch (error) {
    handleError(error)
  }
}

const handleUseBuiltinRuntimeToggle = async (enabled: boolean) => {
  if (togglingUseBuiltinRuntime.value) return
  togglingUseBuiltinRuntime.value = true
  try {
    await configPresenter.setAcpUseBuiltinRuntime(enabled)
    useBuiltinRuntime.value = enabled
  } catch (error) {
    handleError(error)
    useBuiltinRuntime.value = !enabled
  } finally {
    togglingUseBuiltinRuntime.value = false
  }
}

const loadAcpData = async () => {
  if (!acpEnabled.value) {
    builtins.value = []
    customAgents.value = []
    return
  }
  loading.value = true
  try {
    const [builtinList, customList] = await Promise.all([
      configPresenter.getAcpBuiltinAgents(),
      configPresenter.getAcpCustomAgents()
    ])
    builtins.value = builtinList
    customAgents.value = customList
  } catch (error) {
    handleError(error)
  } finally {
    loading.value = false
  }
}

const refreshAfterMutation = async () => {
  await llmProviderPresenter.refreshModels('acp')
  await loadAcpData()
}

const handleToggle = async (enabled: boolean) => {
  if (toggling.value) return
  toggling.value = true
  try {
    await configPresenter.setAcpEnabled(enabled)
    acpEnabled.value = enabled
    if (enabled) {
      await refreshAfterMutation()
    } else {
      builtins.value = []
      customAgents.value = []
      await llmProviderPresenter.refreshModels('acp')
    }
  } catch (error) {
    handleError(error)
    acpEnabled.value = !enabled
  } finally {
    toggling.value = false
  }
}

const handleBuiltinToggle = async (agent: AcpBuiltinAgent, enabled: boolean) => {
  setBuiltinPending(agent.id, true)
  try {
    await configPresenter.setAcpBuiltinEnabled(agent.id, enabled)
    await refreshAfterMutation()
  } catch (error) {
    handleError(error)
  } finally {
    setBuiltinPending(agent.id, false)
  }
}

const handleActiveProfileChange = async (agent: AcpBuiltinAgent, profileId: string) => {
  setBuiltinPending(agent.id, true)
  try {
    await configPresenter.setAcpBuiltinActiveProfile(agent.id, profileId)
    await refreshAfterMutation()
    toast({ title: t('settings.acp.profileSwitched') })
  } catch (error) {
    handleError(error)
  } finally {
    setBuiltinPending(agent.id, false)
  }
}

const ensureProfilePayload = (input?: Partial<ProfilePayload> | null): ProfilePayload => ({
  name: input?.name ?? '',
  command: input?.command ?? '',
  args: input?.args && input.args.length ? [...input.args] : undefined,
  env: input?.env ? { ...input.env } : undefined
})

const openBuiltinProfileDialog = (agent: AcpBuiltinAgent, profile?: AcpAgentProfile) => {
  profileDialogState.mode = profile ? 'builtin-edit' : 'builtin-add'
  profileDialogState.kind = 'builtin'
  profileDialogState.title = profile
    ? t('settings.acp.profileDialog.editBuiltinTitle', { name: agent.name })
    : t('settings.acp.profileDialog.addBuiltinTitle', { name: agent.name })
  profileDialogState.description = t('settings.acp.profileDialog.builtinHint')
  profileDialogState.confirmLabel = t('common.save')
  profileDialogState.builtinId = agent.id
  profileDialogState.customId = null
  profileDialogState.profileId = profile?.id ?? null
  profileDialogState.profile = ensureProfilePayload(profile ?? getActiveProfile(agent) ?? null)
  profileDialogState.open = true
}

const openCustomAgentDialog = (agent?: AcpCustomAgent) => {
  profileDialogState.mode = agent ? 'custom-edit' : 'custom-add'
  profileDialogState.kind = 'custom'
  profileDialogState.title = agent
    ? t('settings.acp.profileDialog.editCustomTitle')
    : t('settings.acp.profileDialog.addCustomTitle')
  profileDialogState.description = t('settings.acp.profileDialog.customHint')
  profileDialogState.confirmLabel = t('common.save')
  profileDialogState.builtinId = null
  profileDialogState.customId = agent?.id ?? null
  profileDialogState.profileId = null
  profileDialogState.profile = ensureProfilePayload(agent ?? null)
  profileDialogState.open = true
}

const handleProfileSave = async (payload: ProfilePayload) => {
  if (!profileDialogState.open) return
  savingProfile.value = true
  try {
    switch (profileDialogState.mode) {
      case 'builtin-add':
        await configPresenter.addAcpBuiltinProfile(profileDialogState.builtinId!, payload, {
          activate: true
        })
        break
      case 'builtin-edit':
        await configPresenter.updateAcpBuiltinProfile(
          profileDialogState.builtinId!,
          profileDialogState.profileId!,
          payload
        )
        break
      case 'custom-add':
        await configPresenter.addCustomAcpAgent({
          id: profileDialogState.customId ?? undefined,
          name: payload.name,
          command: payload.command,
          args: payload.args,
          env: payload.env
        })
        break
      case 'custom-edit':
        await configPresenter.updateCustomAcpAgent(profileDialogState.customId!, payload)
        break
    }
    await refreshAfterMutation()
    profileDialogState.open = false
    toast({ title: t('settings.acp.saveSuccess') })
  } catch (error) {
    handleError(error)
  } finally {
    savingProfile.value = false
  }
}

const openProfileManager = (agent: AcpBuiltinAgent) => {
  profileManagerState.agentId = agent.id
  profileManagerState.open = true
}

const handleManagerAdd = (agentId: AcpBuiltinAgentId) => {
  const agent = builtins.value.find((item) => item.id === agentId)
  if (agent) {
    openBuiltinProfileDialog(agent)
  }
}

const handleManagerEdit = ({
  agentId,
  profile
}: {
  agentId: AcpBuiltinAgentId
  profile: AcpAgentProfile
}) => {
  const agent = builtins.value.find((item) => item.id === agentId)
  if (agent) {
    openBuiltinProfileDialog(agent, profile)
  }
}

const handleManagerDelete = async ({
  agentId,
  profile
}: {
  agentId: AcpBuiltinAgentId
  profile: AcpAgentProfile
}) => {
  const confirmed = window.confirm(
    t('settings.acp.profileManager.deleteConfirm', { name: profile.name })
  )
  if (!confirmed) return

  try {
    const removed = await configPresenter.removeAcpBuiltinProfile(agentId, profile.id)
    if (!removed) {
      toast({
        title: t('settings.acp.profileManager.cannotDeleteTitle'),
        description: t('settings.acp.profileManager.cannotDeleteDesc'),
        variant: 'destructive'
      })
      return
    }
    await refreshAfterMutation()
    toast({ title: t('settings.acp.deleteSuccess') })
  } catch (error) {
    handleError(error)
  }
}

const handleManagerActivate = async ({
  agentId,
  profileId
}: {
  agentId: AcpBuiltinAgentId
  profileId: string
}) => {
  const agent = builtins.value.find((item) => item.id === agentId)
  if (!agent) return
  await handleActiveProfileChange(agent, profileId)
}

const handleCustomToggle = async (agent: AcpCustomAgent, enabled: boolean) => {
  setCustomPending(agent.id, true)
  try {
    await configPresenter.setCustomAcpAgentEnabled(agent.id, enabled)
    await refreshAfterMutation()
  } catch (error) {
    handleError(error)
  } finally {
    setCustomPending(agent.id, false)
  }
}

const deleteCustomAgent = async (agent: AcpCustomAgent) => {
  const confirmed = window.confirm(t('settings.acp.customDeleteConfirm', { name: agent.name }))
  if (!confirmed) return
  try {
    await configPresenter.removeCustomAcpAgent(agent.id)
    await refreshAfterMutation()
    toast({ title: t('settings.acp.deleteSuccess') })
  } catch (error) {
    handleError(error)
  }
}

const isInitializing = (agentId: string, isBuiltin: boolean): boolean => {
  const key = `${isBuiltin ? 'builtin' : 'custom'}-${agentId}`
  return Boolean(initializing[key])
}

const setInitializing = (agentId: string, isBuiltin: boolean, state: boolean) => {
  const key = `${isBuiltin ? 'builtin' : 'custom'}-${agentId}`
  if (state) {
    initializing[key] = true
  } else {
    delete initializing[key]
  }
}

const handleDependenciesRequired = (dependencies: typeof missingDependencies.value) => {
  console.log('[AcpSettings] Dependencies required:', dependencies)
  missingDependencies.value = dependencies
  dependencyDialogOpen.value = true
  terminalDialogOpen.value = false
}

const handleInitializeAgent = async (agentId: string, isBuiltin: boolean) => {
  if (isInitializing(agentId, isBuiltin)) return

  setInitializing(agentId, isBuiltin, true)
  try {
    // Open terminal dialog first
    console.log('[AcpSettings] Opening terminal dialog for agent initialization')
    terminalDialogOpen.value = true

    // Wait for dialog to open, terminal to initialize, and IPC listeners to be set up
    // The terminal initialization takes ~150ms + fitting attempts
    // The main process delays start event by 500ms to ensure listeners are ready
    // So we wait a bit longer to ensure everything is ready
    await new Promise((resolve) => setTimeout(resolve, 600))

    console.log('[AcpSettings] Starting agent initialization')
    // Start initialization (output will be streamed to terminal)
    await configPresenter.initializeAcpAgent(agentId, isBuiltin)

    // Note: Success/error will be shown in terminal, not via toast
  } catch (error) {
    console.error('[AcpSettings] Agent initialization failed:', error)
    handleError(error, 'settings.acp.initializeFailed')
    terminalDialogOpen.value = false
  } finally {
    setInitializing(agentId, isBuiltin, false)
  }
}

watch(
  () => profileDialogState.open,
  (open) => {
    if (!open) {
      profileDialogState.builtinId = null
      profileDialogState.customId = null
      profileDialogState.profileId = null
      profileDialogState.profile = null
    }
  }
)

watch(
  () => profileManagerState.open,
  (open) => {
    if (!open) {
      profileManagerState.agentId = null
    }
  }
)

onMounted(async () => {
  await loadAcpEnabled()
  await loadAcpUseBuiltinRuntime()
  await loadAcpData()
})
</script>
