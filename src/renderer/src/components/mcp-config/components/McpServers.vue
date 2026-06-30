<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription
} from '@shadcn/components/ui/dialog'
import { Badge } from '@shadcn/components/ui/badge'
import { Input } from '@shadcn/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import { useMcpStore } from '@/stores/mcp'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import { useRouter } from 'vue-router'
import McpServerCard from './McpServerCard.vue'
import McpServerForm from '../McpServerForm.vue'
import McpToolPanel from './McpToolPanel.vue'
import McpPromptPanel from './McpPromptPanel.vue'
import McpResourceViewer from './McpResourceViewer.vue'
import type { MCPServerConfig } from '@shared/presenter'

const mcpStore = useMcpStore()
const { t } = useI18n()
const { toast } = useToast()
const router = useRouter()
const props = withDefaults(
  defineProps<{
    showFooterAddButton?: boolean
    serverEnabledOverrides?: Record<string, boolean>
    agentScopedToggle?: boolean
  }>(),
  {
    showFooterAddButton: true,
    serverEnabledOverrides: () => ({}),
    agentScopedToggle: false
  }
)

const emit = defineEmits<{
  'toggle-agent-server': [serverName: string, enabled: boolean]
}>()

const isAddServerDialogOpen = ref(false)
const isEditServerDialogOpen = ref(false)
const isRemoveConfirmDialogOpen = ref(false)
const isToolPanelOpen = ref(false)
const isPromptPanelOpen = ref(false)
const isResourceViewerOpen = ref(false)
const selectedServer = ref<string>('')
const selectedServerForTools = ref<string>('')
const selectedServerForPrompts = ref<string>('')
const selectedServerForResources = ref<string>('')
const selectedDetailServerName = ref('')
const searchQuery = ref('')
const activeFilter = ref<'all' | 'running' | 'stopped'>('all')
const MCP_FILTERS = ['all', 'running', 'stopped'] as const

watch(
  () => mcpStore.mcpInstallCache,
  (newCache) => {
    if (newCache) {
      isAddServerDialogOpen.value = true
    }
  },
  { immediate: true }
)

watch(isAddServerDialogOpen, (newIsAddServerDialogOpen) => {
  if (!newIsAddServerDialogOpen) {
    mcpStore.clearMcpInstallCache()
  }
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

const handleAddServer = async (serverName: string, serverConfig: MCPServerConfig) => {
  const result = await mcpStore.addServer(serverName, serverConfig)
  if (result.success) {
    isAddServerDialogOpen.value = false
  }
}

const openAddServerDialog = () => {
  isAddServerDialogOpen.value = true
}

const handleEditServer = async (serverName: string, serverConfig: Partial<MCPServerConfig>) => {
  const success = await mcpStore.updateServer(serverName, serverConfig)
  if (success) {
    isEditServerDialogOpen.value = false
    selectedServer.value = ''
  }
}

const handleRemoveServer = async (serverName: string) => {
  const config = mcpStore.config.mcpServers[serverName]
  if (config?.type === 'inmemory' || isDeepChatManagedServer(config)) {
    toast({
      title: t('settings.mcp.cannotRemoveBuiltIn'),
      description: t('settings.mcp.builtInServerCannotBeRemoved'),
      variant: 'destructive'
    })
    return
  }
  selectedServer.value = serverName
  isRemoveConfirmDialogOpen.value = true
}

const confirmRemoveServer = async () => {
  const serverName = selectedServer.value
  await mcpStore.removeServer(serverName)
  isRemoveConfirmDialogOpen.value = false
}

const handleToggleServer = async (serverName: string) => {
  if (mcpStore.serverLoadingStates[serverName]) {
    return
  }

  if (props.agentScopedToggle) {
    const server = mcpStore.serverList.find((item) => item.name === serverName)
    emit('toggle-agent-server', serverName, !getServerEnabled(serverName, Boolean(server?.enabled)))
    return
  }

  const config = mcpStore.config.mcpServers[serverName]
  if (isDeepChatManagedServer(config)) {
    toast({
      title: t('settings.mcp.managedServerReadOnly'),
      description: t('settings.mcp.managedServerReadOnlyDesc')
    })
    return
  }

  const success = await mcpStore.toggleServer(serverName)
  if (!success) {
    toast({
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed'),
      variant: 'destructive'
    })
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
    toast({
      title: t('settings.mcp.managedServerReadOnly'),
      description: t('settings.mcp.managedServerReadOnlyDesc')
    })
    return
  }

  selectedServer.value = serverName
  isEditServerDialogOpen.value = true
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
          <Icon
            icon="lucide:loader"
            class="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground"
          />
          <p class="text-xs text-muted-foreground">{{ t('common.loading') }}</p>
        </div>
      </div>

      <div v-else-if="mcpStore.serverList.length === 0" class="text-center py-8">
        <div
          class="mx-auto w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mb-3"
        >
          <Icon icon="lucide:server-off" class="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 class="text-base font-medium text-foreground mb-2">
          {{ t('settings.mcp.noServersFound') }}
        </h3>
        <p class="text-xs text-muted-foreground mb-3 px-4">
          {{ t('settings.mcp.noServersDescription') }}
        </p>
      </div>

      <div v-else class="flex flex-col gap-3 py-3">
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <Input
            v-model="searchQuery"
            class="lg:max-w-sm"
            :placeholder="t('settings.mcp.center.searchPlaceholder')"
          />
          <div class="flex flex-wrap gap-2">
            <Button
              v-for="filter in MCP_FILTERS"
              :key="filter"
              size="sm"
              :variant="activeFilter === filter ? 'default' : 'outline'"
              @click="activeFilter = filter"
            >
              {{ t(`settings.mcp.center.filters.${filter}`) }}
            </Button>
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
            :is-loading="mcpStore.serverLoadingStates[server.name]"
            :disabled="mcpStore.configLoading"
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
          <Dialog v-model:open="isAddServerDialogOpen">
            <DialogTrigger v-if="props.showFooterAddButton" as-child>
              <Button size="sm" class="h-8 px-3 text-xs">
                <Icon icon="lucide:plus" class="mr-1.5 h-3 w-3" />
                {{ t('common.add') }}
              </Button>
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
                @submit="handleAddServer"
              />
            </DialogContent>
          </Dialog>
          <slot name="footer-actions-after" />
        </div>
      </div>
    </div>

    <Sheet :open="Boolean(selectedDetailServer)" @update:open="closeDetail">
      <SheetContent class="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{{ selectedDetailServer?.name }}</SheetTitle>
          <SheetDescription>
            {{ selectedDetailServer?.descriptions }}
          </SheetDescription>
        </SheetHeader>
        <div
          v-if="selectedDetailServer"
          class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
        >
          <div class="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {{
                selectedDetailServer.isRunning
                  ? t('settings.mcp.running')
                  : t('settings.mcp.stopped')
              }}
            </Badge>
            <Badge variant="outline">
              {{
                isBuiltInServer(selectedDetailServer.name)
                  ? t('settings.mcp.builtInServers')
                  : t('settings.mcp.customServers')
              }}
            </Badge>
          </div>

          <div class="grid gap-2 sm:grid-cols-3">
            <Button
              variant="outline"
              :disabled="getServerToolsCount(selectedDetailServer.name) === 0"
              @click="handleViewTools(selectedDetailServer.name)"
            >
              <Icon icon="lucide:wrench" class="size-4" />
              {{ getServerToolsCount(selectedDetailServer.name) }}
            </Button>
            <Button
              variant="outline"
              :disabled="getServerPromptsCount(selectedDetailServer.name) === 0"
              @click="handleViewPrompts(selectedDetailServer.name)"
            >
              <Icon icon="lucide:message-square-quote" class="size-4" />
              {{ getServerPromptsCount(selectedDetailServer.name) }}
            </Button>
            <Button
              variant="outline"
              :disabled="getServerResourcesCount(selectedDetailServer.name) === 0"
              @click="handleViewResources(selectedDetailServer.name)"
            >
              <Icon icon="lucide:folder" class="size-4" />
              {{ getServerResourcesCount(selectedDetailServer.name) }}
            </Button>
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
            <Button variant="outline" @click="openEditServerDialog(selectedDetailServer.name)">
              <Icon icon="lucide:settings" class="size-4" />
              {{ t('settings.mcp.editServer') }}
            </Button>
            <Button
              v-if="!isBuiltInServer(selectedDetailServer.name)"
              variant="destructive"
              @click="handleRemoveServer(selectedDetailServer.name)"
            >
              <Icon icon="lucide:trash-2" class="size-4" />
              {{ t('settings.mcp.removeServer') }}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- Edit server dialog -->
    <Dialog v-model:open="isEditServerDialogOpen">
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
          @submit="(name, config) => handleEditServer(name, config)"
        />
      </DialogContent>
    </Dialog>

    <!-- Remove server confirmation dialog -->
    <Dialog v-model:open="isRemoveConfirmDialogOpen">
      <DialogContent class="w-[90vw] max-w-[380px]">
        <DialogHeader>
          <DialogTitle class="text-base">{{
            t('settings.mcp.removeServerDialog.title')
          }}</DialogTitle>
          <DialogDescription class="text-sm">
            {{ t('settings.mcp.confirmRemoveServer', { name: selectedServer }) }}
          </DialogDescription>
        </DialogHeader>
        <div class="mt-2 flex flex-row items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            class="min-w-24"
            @click="isRemoveConfirmDialogOpen = false"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button variant="destructive" size="sm" class="min-w-24" @click="confirmRemoveServer">
            {{ t('common.confirm') }}
          </Button>
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
