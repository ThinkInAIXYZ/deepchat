<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { DcEmpty } from '@dc-ui/components/empty'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { DcCopyButton } from '@dc-ui/components'
import { DcSheetPanel } from '@dc-ui/components/sheet-panel'
import { DcStatusPill } from '@dc-ui/components/status-pill'
import { useMcpStore } from '@/stores/mcp'
import { useI18n } from 'vue-i18n'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useRouter } from 'vue-router'
import McpServerCard from './McpServerCard.vue'
import McpEnterpriseProfiles from './McpEnterpriseProfiles.vue'
import McpServerForm from '../McpServerForm.vue'
import McpToolPanel from './McpToolPanel.vue'
import McpPromptPanel from './McpPromptPanel.vue'
import McpResourceViewer from './McpResourceViewer.vue'
import type { MCPServerConfig, McpCredentialBinding, McpCredentialInput } from '@shared/types/mcp'
import { createMcpClient } from '@api/McpClient'

const mcpStore = useMcpStore()
const { t } = useI18n()
const router = useRouter()
const mcpClient = createMcpClient()
const props = withDefaults(
  defineProps<{
    showFooterAddButton?: boolean
    serverEnabledOverrides?: Record<string, boolean>
    serverLoadingOverrides?: Record<string, boolean>
    agentScopedToggle?: boolean
    agentScopedBusy?: boolean
  }>(),
  {
    showFooterAddButton: true,
    serverEnabledOverrides: () => ({}),
    serverLoadingOverrides: () => ({}),
    agentScopedToggle: false,
    agentScopedBusy: false
  }
)

const emit = defineEmits<{
  'toggle-agent-server': [serverName: string, enabled: boolean]
}>()

const isAddServerDialogOpen = ref(false)
const isEditServerDialogOpen = ref(false)
const isRemoveConfirmDialogOpen = ref(false)
const isAuthCallbackDialogOpen = ref(false)
const addServerError = ref<'duplicate' | 'failed' | null>(null)
const isAddingServer = ref(false)
const editServerError = ref<string | null>(null)
const isEditingServer = ref(false)
const removeServerError = ref<string | null>(null)
const isRemovingServer = ref(false)
const isToolPanelOpen = ref(false)
const isPromptPanelOpen = ref(false)
const isResourceViewerOpen = ref(false)
const isDiagnosticsOpen = ref(false)
const diagnosticsServerName = ref('')
const diagnostics = ref<Awaited<ReturnType<typeof mcpClient.getServerDiagnostics>> | null>(null)
const diagnosticsError = ref('')
const isDiagnosticsLoading = ref(false)
const selectedServer = ref<string>('')
const selectedServerForTools = ref<string>('')
const selectedServerForPrompts = ref<string>('')
const selectedServerForResources = ref<string>('')
const selectedDetailServerName = ref('')
const selectedServerForAuth = ref('')
const authCallbackUrl = ref('')
const authCallbackError = ref<string | null>(null)
const isSubmittingAuthCallback = ref(false)
const searchQuery = ref('')
const activeFilter = ref<'all' | 'running' | 'stopped'>('all')
const MCP_FILTERS = ['all', 'running', 'stopped'] as const
let addServerDialogGeneration = 0
let editServerDialogGeneration = 0
let diagnosticsRequestGeneration = 0

watch(
  () => mcpStore.mcpInstallCache,
  (newCache) => {
    if (newCache) {
      isAddServerDialogOpen.value = true
    }
  },
  { immediate: true }
)

watch(
  isAddServerDialogOpen,
  (newIsAddServerDialogOpen) => {
    addServerDialogGeneration += 1
    if (!newIsAddServerDialogOpen) {
      mcpStore.clearMcpInstallCache()
      addServerError.value = null
    }
  },
  { flush: 'sync' }
)

watch(
  isEditServerDialogOpen,
  (open) => {
    editServerDialogGeneration += 1
    if (!open) {
      editServerError.value = null
      selectedServer.value = ''
    }
  },
  { flush: 'sync' }
)

watch(authCallbackUrl, () => {
  authCallbackError.value = null
})
const isDeepChatManagedServer = (config?: MCPServerConfig) => {
  return config?.source === 'deepchat'
}

const isBuiltInServer = (serverName: string) => {
  const config = mcpStore.config.mcpServers[serverName]
  return config?.type === 'inmemory' || isDeepChatManagedServer(config)
}

const filteredServers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return mcpStore.serverList.filter((server) => {
    const matchesQuery =
      !query ||
      server.name.toLowerCase().includes(query) ||
      server.descriptions?.toLowerCase().includes(query)
    const matchesFilter =
      activeFilter.value === 'all' ||
      (activeFilter.value === 'running' && server.isRunning) ||
      (activeFilter.value === 'stopped' && !server.isRunning)

    return matchesQuery && matchesFilter
  })
})

const selectedDetailServer = computed(() =>
  mcpStore.serverList.find((server) => server.name === selectedDetailServerName.value)
)

const getServerToolsCount = (serverName: string) => {
  return mcpStore.visibleTools.filter((tool) => tool.server.name === serverName).length
}

const getServerPromptsCount = (serverName: string) => {
  return mcpStore.visiblePrompts.filter((prompt) => prompt.client.name === serverName).length
}

const getServerResourcesCount = (serverName: string) => {
  return mcpStore.visibleResources.filter((resource) => resource.client.name === serverName).length
}

const getServerEnabled = (serverName: string, fallback: boolean) =>
  props.serverEnabledOverrides[serverName] ?? fallback

const saveSubmittedCredential = async (
  serverName: string,
  credential?: McpCredentialInput
): Promise<void> => {
  if (!credential) return
  const servers = await mcpClient.getMcpServers()
  const config = servers[serverName]
  if (!config?.serverId || !config.configGeneration || !config.bindingHash || !config.baseUrl) {
    throw new Error('MCP server credential binding is unavailable')
  }
  const binding: McpCredentialBinding = {
    serverId: config.serverId,
    configGeneration: config.configGeneration,
    bindingHash: config.bindingHash,
    endpoint: config.baseUrl,
    protectedResourceUrl: config.authorization?.protectedResourceUrl,
    authorizationServerIssuer: config.authorization?.authorizationServerIssuer,
    clientId: config.authorization?.clientId
  }
  await mcpClient.setCredential(binding, credential)
}

const handleAddServer = async (
  serverName: string,
  serverConfig: MCPServerConfig,
  credential?: McpCredentialInput
) => {
  if (isAddingServer.value) return

  isAddingServer.value = true
  addServerError.value = null
  const dialogGeneration = addServerDialogGeneration
  try {
    const result = await mcpStore.addServer(serverName, serverConfig)
    if (dialogGeneration !== addServerDialogGeneration || !isAddServerDialogOpen.value) {
      return
    }
    if (result.status === 'added') {
      try {
        await saveSubmittedCredential(serverName, credential)
      } catch (error) {
        console.error('[McpServers] Failed to save server credential:', serverName, error)
        notifyRenderer({
          kind: 'error',
          code: 'settings.mcp.serverForm.credentialSaveError',
          title: t('settings.mcp.serverForm.credentialSaveError'),
          description: t('settings.mcp.serverForm.credentialSaveError')
        })
      }
      if (dialogGeneration !== addServerDialogGeneration || !isAddServerDialogOpen.value) {
        return
      }
      isAddServerDialogOpen.value = false
      return
    }
    addServerError.value = result.status
  } finally {
    isAddingServer.value = false
  }
}

const clearAddServerError = () => {
  addServerError.value = null
}

const clearFailedAddServerError = () => {
  if (addServerError.value === 'failed') {
    addServerError.value = null
  }
}

const clearEditServerError = () => {
  editServerError.value = null
}

const openAddServerDialog = () => {
  isAddServerDialogOpen.value = true
}

const handleAddDialogOpenChange = (open: boolean) => {
  if (!open && isAddingServer.value) return
  isAddServerDialogOpen.value = open
}

const closeAuthCallbackDialog = () => {
  isAuthCallbackDialogOpen.value = false
  selectedServerForAuth.value = ''
  authCallbackUrl.value = ''
  authCallbackError.value = null
}

const refreshSelectedServerAuthStatus = async () => {
  const serverName = selectedServerForAuth.value
  if (!isAuthCallbackDialogOpen.value || !serverName) {
    return
  }

  const status = await mcpStore.updateServerAuthStatus(serverName, true)
  if (status?.authenticated) {
    closeAuthCallbackDialog()
  }
}

useEventListener(window, 'focus', refreshSelectedServerAuthStatus)

const handleEditServer = async (
  serverName: string,
  serverConfig: Partial<MCPServerConfig>,
  credential?: McpCredentialInput
) => {
  if (isEditingServer.value) return

  isEditingServer.value = true
  editServerError.value = null
  const dialogGeneration = editServerDialogGeneration
  let success = false
  try {
    success = await mcpStore.updateServer(serverName, serverConfig)
  } catch (error) {
    console.error('[McpServers] Failed to update server:', serverName, error)
  }
  if (
    dialogGeneration !== editServerDialogGeneration ||
    !isEditServerDialogOpen.value ||
    selectedServer.value !== serverName
  ) {
    isEditingServer.value = false
    return
  }

  if (!success) {
    isEditingServer.value = false
    editServerError.value = t('common.error.requestFailed')
    return
  }

  try {
    await saveSubmittedCredential(serverName, credential)
  } catch (error) {
    console.error('[McpServers] Failed to save server credential:', serverName, error)
    isEditingServer.value = false
    editServerError.value = t('settings.mcp.serverForm.credentialSaveError')
    return
  }

  if (
    dialogGeneration !== editServerDialogGeneration ||
    !isEditServerDialogOpen.value ||
    selectedServer.value !== serverName
  ) {
    isEditingServer.value = false
    return
  }

  isEditingServer.value = false
  isEditServerDialogOpen.value = false
}

const handleRemoveServer = async (serverName: string) => {
  const config = mcpStore.config.mcpServers[serverName]
  if (config?.type === 'inmemory' || isDeepChatManagedServer(config)) {
    return
  }
  removeServerError.value = null
  selectedServer.value = serverName
  isRemoveConfirmDialogOpen.value = true
}

const confirmRemoveServer = async () => {
  if (isRemovingServer.value) return

  const serverName = selectedServer.value
  isRemoveConfirmDialogOpen.value = false
  isRemovingServer.value = true
  removeServerError.value = null
  let success = false
  try {
    success = await mcpStore.removeServer(serverName)
  } catch (error) {
    console.error('[McpServers] Failed to remove server:', serverName, error)
  }
  isRemovingServer.value = false

  if (!success) {
    removeServerError.value = t('common.error.requestFailed')
    isRemoveConfirmDialogOpen.value = true
  }
}

const handleToggleServer = async (serverName: string) => {
  if (mcpStore.serverLoadingStates[serverName] || props.agentScopedBusy) {
    return
  }

  if (props.agentScopedToggle) {
    const server = mcpStore.serverList.find((item) => item.name === serverName)
    emit('toggle-agent-server', serverName, !getServerEnabled(serverName, Boolean(server?.enabled)))
    return
  }

  const config = mcpStore.config.mcpServers[serverName]
  if (isDeepChatManagedServer(config)) {
    notifyRenderer({
      kind: 'info',
      code: 'settings.mcp.managedServerReadOnly',
      title: t('settings.mcp.managedServerReadOnly'),
      description: t('settings.mcp.managedServerReadOnlyDesc')
    })
    return
  }

  const success = await mcpStore.toggleServer(serverName)
  if (!success) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.toggleFailed',
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed')
    })
  }
}

const handleAuthenticateServer = async (serverName: string) => {
  const status = await mcpStore.startServerAuth(serverName)
  if (!status) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.mcp.authStartFailed',
      title: t('settings.mcp.authFailed'),
      description: t('common.error.requestFailed')
    })
    return
  }

  if (status.authenticated) {
    closeAuthCallbackDialog()
    return
  }

  selectedServerForAuth.value = serverName
  authCallbackUrl.value = ''
  authCallbackError.value = null
  isAuthCallbackDialogOpen.value = true
}

const submitAuthCallbackUrl = async () => {
  if (isSubmittingAuthCallback.value) {
    return
  }

  const serverName = selectedServerForAuth.value
  const callbackUrl = authCallbackUrl.value.trim()
  if (!serverName || !callbackUrl) {
    return
  }

  isSubmittingAuthCallback.value = true
  try {
    const status = await mcpStore.completeServerAuthFromCallbackUrl(serverName, callbackUrl)
    if (status?.authenticated) {
      closeAuthCallbackDialog()
      return
    }

    authCallbackError.value = status?.error || t('common.error.requestFailed')
  } finally {
    isSubmittingAuthCallback.value = false
  }
}

const openEditServerDialog = (serverName: string) => {
  const specialServers = {
    difyKnowledge: 'dify',
    ragflowKnowledge: 'ragflow',
    fastGptKnowledge: 'fastgpt',
    builtinKnowledge: 'builtinKnowledge'
  }

  if (specialServers[serverName]) {
    router.push({
      name: 'settings-knowledge-base',
      query: { subtab: specialServers[serverName] }
    })
    return
  }

  const config = mcpStore.config.mcpServers[serverName]
  if (isDeepChatManagedServer(config)) {
    notifyRenderer({
      kind: 'info',
      code: 'settings.mcp.managedServerReadOnly',
      title: t('settings.mcp.managedServerReadOnly'),
      description: t('settings.mcp.managedServerReadOnlyDesc')
    })
    return
  }

  selectedServer.value = serverName
  editServerError.value = null
  isEditServerDialogOpen.value = true
}

const handleEditDialogOpenChange = (open: boolean) => {
  if (!open && isEditingServer.value) return
  isEditServerDialogOpen.value = open
}

const handleRemoveDialogOpenChange = (open: boolean) => {
  if (!open && isRemovingServer.value) return
  isRemoveConfirmDialogOpen.value = open
  if (!open) removeServerError.value = null
}

const handleAuthDialogOpenChange = (open: boolean) => {
  if (!open && isSubmittingAuthCallback.value) return
  if (open) {
    isAuthCallbackDialogOpen.value = true
  } else {
    closeAuthCallbackDialog()
  }
}

const handleViewTools = async (serverName: string) => {
  selectedServerForTools.value = serverName
  await mcpStore.loadTools()
  isToolPanelOpen.value = true
}

const handleViewPrompts = async (serverName: string) => {
  selectedServerForPrompts.value = serverName
  await mcpStore.loadPrompts()
  isPromptPanelOpen.value = true
}

const handleViewResources = async (serverName: string) => {
  selectedServerForResources.value = serverName
  await mcpStore.loadResources()
  isResourceViewerOpen.value = true
}

const refreshDiagnostics = async () => {
  if (!diagnosticsServerName.value) {
    return
  }
  const serverName = diagnosticsServerName.value
  const requestGeneration = ++diagnosticsRequestGeneration
  isDiagnosticsLoading.value = true
  diagnosticsError.value = ''
  diagnostics.value = null
  try {
    const nextDiagnostics = await mcpClient.getServerDiagnostics(serverName)
    if (
      requestGeneration === diagnosticsRequestGeneration &&
      serverName === diagnosticsServerName.value
    ) {
      diagnostics.value = nextDiagnostics
    }
  } catch (error) {
    if (
      requestGeneration === diagnosticsRequestGeneration &&
      serverName === diagnosticsServerName.value
    ) {
      diagnostics.value = null
      diagnosticsError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (requestGeneration === diagnosticsRequestGeneration) {
      isDiagnosticsLoading.value = false
    }
  }
}

const openDiagnostics = (serverName: string) => {
  diagnosticsServerName.value = serverName
  isDiagnosticsOpen.value = true
  void refreshDiagnostics()
}

const diagnosticsText = computed(() =>
  diagnostics.value ? JSON.stringify(diagnostics.value, null, 2) : ''
)

watch(
  () =>
    [
      diagnosticsServerName.value,
      mcpStore.serverList.find((server) => server.name === diagnosticsServerName.value)?.isRunning
    ] as const,
  ([serverName, isRunning], [previousServerName, wasRunning]) => {
    if (isDiagnosticsOpen.value && serverName === previousServerName && isRunning !== wasRunning) {
      void refreshDiagnostics()
    }
  }
)

const openDetail = (serverName: string) => {
  selectedDetailServerName.value = serverName
}

const closeDetail = (open: boolean) => {
  if (!open) {
    selectedDetailServerName.value = ''
  }
}

defineExpose({
  openAddServerDialog
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <!-- Server list -->
    <ScrollArea class="min-h-0 flex-1 px-3">
      <div v-if="mcpStore.configLoading" class="flex justify-center py-8">
        <div class="text-center">
          <Spinner class="mx-auto mb-2 size-6 text-muted-foreground" />
          <p class="text-xs text-muted-foreground">{{ t('common.loading') }}</p>
        </div>
      </div>

      <DcEmpty
        v-else-if="mcpStore.serverList.length === 0"
        icon="lucide:server-off"
        :title="t('settings.mcp.noServersFound')"
        :description="t('settings.mcp.noServersDescription')"
        class="border-0 py-8"
      />

      <div v-else class="flex flex-col gap-3 py-3">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <Input
            v-model="searchQuery"
            class="lg:max-w-sm"
            :placeholder="t('settings.mcp.center.searchPlaceholder')"
          />
          <div class="flex flex-wrap gap-2">
            <DcButton
              v-for="filter in MCP_FILTERS"
              :key="filter"
              size="sm"
              :variant="activeFilter === filter ? 'default' : 'outline'"
              @click="activeFilter = filter"
            >
              {{ t(`settings.mcp.center.filters.${filter}`) }}
            </DcButton>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <McpServerCard
            v-for="server in filteredServers"
            :key="server.name"
            :server="{
              ...server,
              enabled: getServerEnabled(server.name, Boolean(server.enabled))
            }"
            :is-built-in="isBuiltInServer(server.name)"
            :is-managed="mcpStore.config.mcpServers[server.name]?.source === 'deepchat'"
            :is-loading="
              mcpStore.serverLoadingStates[server.name] || props.serverLoadingOverrides[server.name]
            "
            :disabled="mcpStore.configLoading || (props.agentScopedToggle && props.agentScopedBusy)"
            :tools-count="getServerToolsCount(server.name)"
            :prompts-count="getServerPromptsCount(server.name)"
            :resources-count="getServerResourcesCount(server.name)"
            @click="openDetail(server.name)"
            @toggle="handleToggleServer(server.name)"
            @edit="openEditServerDialog(server.name)"
            @remove="handleRemoveServer(server.name)"
            @view-tools="handleViewTools(server.name)"
            @view-prompts="handleViewPrompts(server.name)"
            @view-resources="handleViewResources(server.name)"
            @authenticate="handleAuthenticateServer(server.name)"
            @diagnostics="openDiagnostics(server.name)"
          />
        </div>

        <div
          v-if="filteredServers.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('settings.mcp.center.noResults') }}
        </div>
      </div>
    </ScrollArea>

    <!-- Footer actions -->
    <div class="shrink-0 border-t bg-background">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <slot name="status-bar">
            <div class="flex items-center space-x-3">
              <div class="flex items-center space-x-1">
                <Icon icon="lucide:server" class="h-3 w-3 text-muted-foreground" />
                <span class="text-xs text-muted-foreground">
                  {{ t('settings.mcp.totalServers') }}: {{ mcpStore.serverList.length }}
                </span>
              </div>
              <div v-if="mcpStore.serverList.length > 0" class="flex items-center space-x-1">
                <Icon icon="lucide:play" class="h-3 w-3 text-green-600" />
                <span class="text-xs text-green-600">
                  {{ mcpStore.serverList.filter((s) => s.isRunning).length }}
                </span>
              </div>
            </div>
          </slot>
        </div>

        <!-- Action buttons -->
        <div class="flex space-x-2">
          <McpEnterpriseProfiles v-if="!props.agentScopedToggle" />
          <Dialog :open="isAddServerDialogOpen" @update:open="handleAddDialogOpenChange">
            <DialogTrigger v-if="props.showFooterAddButton" as-child>
              <DcButton size="sm" class="h-8 px-3 text-xs">
                <Icon icon="lucide:plus" class="mr-1.5 h-3 w-3" />
                {{ t('common.add') }}
              </DcButton>
            </DialogTrigger>
            <DialogContent class="w-[95vw] max-w-[500px] px-0 h-[85vh] max-h-[500px] flex flex-col">
              <DialogHeader class="px-3 shrink-0 pb-2">
                <DialogTitle class="text-base">{{
                  t('settings.mcp.addServerDialog.title')
                }}</DialogTitle>
                <DialogDescription class="text-sm">
                  {{ t('settings.mcp.addServerDialog.description') }}
                </DialogDescription>
              </DialogHeader>
              <McpServerForm
                :default-json-config="mcpStore.mcpInstallCache || undefined"
                :submitting="isAddingServer"
                :name-error="
                  addServerError === 'duplicate'
                    ? t('settings.mcp.serverForm.nameDuplicate')
                    : undefined
                "
                :submission-error="
                  addServerError === 'failed' ? t('mcp.errors.addServerFailed') : undefined
                "
                @submit="handleAddServer"
                @input-change="clearFailedAddServerError"
                @name-change="clearAddServerError"
              />
            </DialogContent>
          </Dialog>
          <slot name="footer-actions-after" />
        </div>
      </div>
    </div>

    <DcSheetPanel
      appearance="plain"
      :open="Boolean(selectedDetailServer)"
      :title="selectedDetailServer?.name ?? ''"
      :description="selectedDetailServer?.descriptions ?? ''"
      @update:open="closeDetail"
    >
      <div v-if="selectedDetailServer" class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <div class="flex flex-wrap gap-2">
          <DcStatusPill
            :status="selectedDetailServer.isRunning ? 'running' : 'stopped'"
            :label="
              selectedDetailServer.isRunning ? t('settings.mcp.running') : t('settings.mcp.stopped')
            "
          />
          <DcStatusPill
            status="neutral"
            :label="
              isBuiltInServer(selectedDetailServer.name)
                ? t('settings.mcp.builtInServers')
                : t('settings.mcp.customServers')
            "
          />
        </div>

        <div class="grid gap-2 sm:grid-cols-3">
          <DcButton
            variant="outline"
            :disabled="getServerToolsCount(selectedDetailServer.name) === 0"
            @click="handleViewTools(selectedDetailServer.name)"
          >
            <Icon icon="lucide:wrench" class="size-4" />
            {{ getServerToolsCount(selectedDetailServer.name) }}
          </DcButton>
          <DcButton
            variant="outline"
            :disabled="getServerPromptsCount(selectedDetailServer.name) === 0"
            @click="handleViewPrompts(selectedDetailServer.name)"
          >
            <Icon icon="lucide:message-square-quote" class="size-4" />
            {{ getServerPromptsCount(selectedDetailServer.name) }}
          </DcButton>
          <DcButton
            variant="outline"
            :disabled="getServerResourcesCount(selectedDetailServer.name) === 0"
            @click="handleViewResources(selectedDetailServer.name)"
          >
            <Icon icon="lucide:folder" class="size-4" />
            {{ getServerResourcesCount(selectedDetailServer.name) }}
          </DcButton>
        </div>

        <div class="rounded-lg border border-border p-3">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t('settings.mcp.center.command') }}
          </div>
          <div class="mt-1 break-all font-mono text-xs">
            {{ selectedDetailServer.command || '-' }}
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <DcButton
            variant="outline"
            icon="lucide:settings"
            @click="openEditServerDialog(selectedDetailServer.name)"
          >
            {{ t('settings.mcp.editServer') }}
          </DcButton>
          <DcButton
            v-if="!isBuiltInServer(selectedDetailServer.name)"
            variant="destructive"
            icon="lucide:trash-2"
            @click="handleRemoveServer(selectedDetailServer.name)"
          >
            {{ t('settings.mcp.removeServer') }}
          </DcButton>
        </div>
      </div>
    </DcSheetPanel>

    <!-- Edit server dialog -->
    <Dialog :open="isEditServerDialogOpen" @update:open="handleEditDialogOpenChange">
      <DialogContent class="w-[95vw] max-w-[500px] px-0 h-[85vh] max-h-[500px] flex flex-col">
        <DialogHeader class="px-3 shrink-0 pb-2">
          <DialogTitle class="text-base">{{
            t('settings.mcp.editServerDialog.title')
          }}</DialogTitle>
          <DialogDescription class="text-sm">
            {{ t('settings.mcp.editServerDialog.description') }}
          </DialogDescription>
        </DialogHeader>
        <McpServerForm
          v-if="selectedServer && mcpStore.config.mcpServers[selectedServer]"
          :server-name="selectedServer"
          :initial-config="mcpStore.config.mcpServers[selectedServer]"
          :edit-mode="true"
          :submitting="isEditingServer"
          :submission-error="editServerError || undefined"
          @submit="handleEditServer"
          @input-change="clearEditServerError"
        />
      </DialogContent>
    </Dialog>

    <!-- Remove server confirmation dialog -->
    <Dialog :open="isRemoveConfirmDialogOpen" @update:open="handleRemoveDialogOpenChange">
      <DialogContent class="w-[90vw] max-w-[380px]">
        <DialogHeader>
          <DialogTitle class="text-base">{{
            t('settings.mcp.removeServerDialog.title')
          }}</DialogTitle>
          <DialogDescription class="text-sm">
            {{ t('settings.mcp.confirmRemoveServer', { name: selectedServer }) }}
          </DialogDescription>
        </DialogHeader>
        <p v-if="removeServerError" role="alert" class="text-sm text-destructive">
          {{ removeServerError }}
        </p>
        <div class="mt-2 flex flex-row items-center justify-end gap-3">
          <DcButton
            variant="outline"
            size="sm"
            class="min-w-24"
            :disabled="isRemovingServer"
            @click="isRemoveConfirmDialogOpen = false"
          >
            {{ t('common.cancel') }}
          </DcButton>
          <DcButton
            variant="destructive"
            size="sm"
            class="min-w-24"
            :disabled="isRemovingServer"
            @click="confirmRemoveServer"
          >
            <Spinner v-if="isRemovingServer" data-icon="inline-start" />
            {{ t('common.confirm') }}
          </DcButton>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="isAuthCallbackDialogOpen" @update:open="handleAuthDialogOpenChange">
      <DialogContent class="w-[90vw] max-w-[460px]">
        <DialogHeader>
          <DialogTitle class="text-base">{{ t('settings.mcp.authCallbackTitle') }}</DialogTitle>
          <DialogDescription class="text-sm">
            {{ t('settings.mcp.authCallbackDescription') }}
          </DialogDescription>
        </DialogHeader>
        <div class="mt-2 flex flex-col gap-3">
          <Input
            v-model="authCallbackUrl"
            :placeholder="t('settings.mcp.authCallbackPlaceholder')"
            :disabled="isSubmittingAuthCallback"
            :aria-invalid="Boolean(authCallbackError)"
            :aria-describedby="authCallbackError ? 'mcp-auth-callback-error' : undefined"
            @keydown.enter.prevent="submitAuthCallbackUrl"
          />
          <p
            v-if="authCallbackError"
            id="mcp-auth-callback-error"
            role="alert"
            class="text-sm text-destructive"
          >
            {{ authCallbackError }}
          </p>
          <div class="flex justify-end gap-2">
            <DcButton
              variant="outline"
              size="sm"
              :disabled="isSubmittingAuthCallback"
              @click="closeAuthCallbackDialog"
            >
              {{ t('common.cancel') }}
            </DcButton>
            <DcButton
              size="sm"
              :disabled="!authCallbackUrl.trim() || isSubmittingAuthCallback"
              @click="submitAuthCallbackUrl"
            >
              <Spinner v-if="isSubmittingAuthCallback" data-icon="inline-start" />
              {{ t('settings.mcp.completeAuthentication') }}
            </DcButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="isDiagnosticsOpen">
      <DialogContent class="w-[92vw] max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{{ t('settings.mcp.diagnostics.title') }}</DialogTitle>
          <DialogDescription>{{ diagnosticsServerName }}</DialogDescription>
        </DialogHeader>
        <div class="max-h-[60vh] overflow-auto">
          <div v-if="isDiagnosticsLoading" class="flex justify-center py-10">
            <Spinner class="size-5" />
          </div>
          <div v-else-if="diagnosticsError" class="text-sm text-destructive">
            {{ diagnosticsError }}
          </div>
          <dl v-else-if="diagnostics" class="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.serverId') }}</dt>
            <dd class="break-all font-mono text-xs">{{ diagnostics.serverId }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.owner') }}</dt>
            <dd>{{ diagnostics.owner }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.transport') }}</dt>
            <dd>{{ diagnostics.transport }}</dd>
            <dt class="text-muted-foreground">
              {{ t('settings.mcp.diagnostics.connectionState') }}
            </dt>
            <dd>{{ diagnostics.connectionState }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.era') }}</dt>
            <dd>{{ diagnostics.era }} {{ diagnostics.protocolVersion || '' }}</dd>
            <dt class="text-muted-foreground">
              {{ t('settings.mcp.diagnostics.serverImplementation') }}
            </dt>
            <dd>
              {{
                diagnostics.serverImplementation
                  ? `${diagnostics.serverImplementation.name} ${diagnostics.serverImplementation.version}`
                  : '-'
              }}
            </dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.probe') }}</dt>
            <dd>
              {{ diagnostics.probe.outcome }}
              {{ diagnostics.probe.reasonCode ? `· ${diagnostics.probe.reasonCode}` : '' }}
            </dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.extensions') }}</dt>
            <dd class="break-all">{{ diagnostics.extensions.join(', ') || '-' }}</dd>
            <dt class="text-muted-foreground">
              {{ t('settings.mcp.diagnostics.clientExtensions') }}
            </dt>
            <dd class="break-all">
              {{
                diagnostics.clientExtensions
                  .map((extension) =>
                    extension.revision ? `${extension.id}@${extension.revision}` : extension.id
                  )
                  .join(', ') || '-'
              }}
            </dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.cache') }}</dt>
            <dd>{{ diagnostics.cacheState }}</dd>
            <dt class="text-muted-foreground">
              {{ t('settings.mcp.diagnostics.subscriptions') }}
            </dt>
            <dd>{{ diagnostics.subscriptions.join(', ') || '-' }}</dd>
            <dt class="text-muted-foreground">{{ t('settings.mcp.diagnostics.auth') }}</dt>
            <dd>
              {{ diagnostics.auth.state }}
              {{ diagnostics.auth.mode ? `· ${diagnostics.auth.mode}` : '' }}
              {{
                diagnostics.auth.persistent === undefined
                  ? ''
                  : `· persistent=${diagnostics.auth.persistent}`
              }}
            </dd>
          </dl>
        </div>
        <div class="flex justify-end gap-2">
          <DcButton variant="outline" :disabled="isDiagnosticsLoading" @click="refreshDiagnostics">
            <Icon icon="lucide:refresh-cw" class="size-4" />
            {{ t('mcp.tools.refresh') }}
          </DcButton>
          <DcCopyButton
            :disabled="!diagnostics"
            :copy-text="diagnosticsText"
            :label="t('settings.mcp.diagnostics.copy')"
          />
        </div>
      </DialogContent>
    </Dialog>

    <!-- Tool panel -->
    <McpToolPanel v-model:open="isToolPanelOpen" :server-name="selectedServerForTools" />

    <!-- Prompt panel -->
    <McpPromptPanel v-model:open="isPromptPanelOpen" :server-name="selectedServerForPrompts" />

    <!-- Resource viewer -->
    <McpResourceViewer
      v-model:open="isResourceViewerOpen"
      :server-name="selectedServerForResources"
    />
  </div>
</template>
