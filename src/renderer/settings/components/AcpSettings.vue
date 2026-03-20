<template>
  <div class="w-full h-full flex flex-col">
    <div class="shrink-0 px-4 pt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
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

      <div
        v-if="acpEnabled"
        class="rounded-xl border bg-muted/20 px-4 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="space-y-1">
          <div class="text-sm font-semibold">{{ t('settings.acp.registryInstallEntry') }}</div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.acp.registryInstallEntryDescription') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" @click="openRegistryDialog">
            <Icon icon="lucide:download" class="h-4 w-4 mr-2" />
            {{ t('settings.acp.registryInstallEntry') }}
          </Button>
        </div>
      </div>

      <Separator />
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="acpEnabled" class="p-4 space-y-6">
        <Collapsible v-if="showSharedMcpSection" v-model:open="sharedMcpOpen" class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">{{ t('settings.acp.sharedMcpTitle') }}</div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.sharedMcpDescription') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="outline">
                {{ t('settings.acp.mcpAccessBadge', { count: sharedMcpCount }) }}
              </Badge>
              <Button size="sm" variant="outline" @click="sharedMcpOpen = !sharedMcpOpen">
                {{ sharedMcpOpen ? t('common.collapse') : t('common.expand') }}
              </Button>
            </div>
          </div>

          <CollapsibleContent>
            <Card>
              <CardContent class="pt-6">
                <AgentMcpSelector @update:selections="handleSharedMcpUpdated" />
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <section class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">{{ t('settings.acp.installedSectionTitle') }}</div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.installedSectionDescription') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="outline">
                {{ t('settings.acp.installedCount', { count: installedRegistryAgents.length }) }}
              </Badge>
              <Button size="sm" variant="outline" @click="openRegistryDialog">
                {{ t('settings.acp.registryInstallEntry') }}
              </Button>
            </div>
          </div>

          <div
            v-if="loading && !installedRegistryAgents.length"
            class="text-sm text-muted-foreground text-center py-8"
          >
            {{ t('settings.acp.loading') }}
          </div>

          <Card v-else-if="!installedRegistryAgents.length" class="border-dashed">
            <CardContent class="py-10">
              <div class="max-w-md mx-auto text-center space-y-3">
                <div class="text-base font-semibold">
                  {{ t('settings.acp.installedEmptyTitle') }}
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.acp.installedEmptyDescription') }}
                </p>
                <Button @click="openRegistryDialog">
                  <Icon icon="lucide:download" class="h-4 w-4 mr-2" />
                  {{ t('settings.acp.registryInstallEntry') }}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div v-else class="grid gap-3 xl:grid-cols-2">
            <Card v-for="agent in installedRegistryAgents" :key="agent.id">
              <CardHeader class="pb-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <CardTitle class="text-base flex items-center gap-2 min-w-0">
                      <AcpAgentIcon
                        :icon="agent.icon"
                        :alt="agent.name"
                        :fallback-text="agent.name"
                        custom-class="h-5 w-5"
                      />
                      <span class="truncate">{{ agent.name }}</span>
                      <Badge :class="installBadgeClass(agent)" variant="outline">
                        {{ installBadgeLabel(agent) }}
                      </Badge>
                      <Badge v-if="agent.enabled" variant="secondary">
                        {{ t('common.enabled') }}
                      </Badge>
                    </CardTitle>
                    <CardDescription class="text-xs mt-1">
                      {{ agent.description || t('settings.acp.builtinHint', { name: agent.name }) }}
                    </CardDescription>
                  </div>
                  <Switch
                    :model-value="agent.enabled"
                    :disabled="Boolean(agentPending[agent.id])"
                    @update:model-value="(value) => toggleRegistryAgent(agent, Boolean(value))"
                  />
                </div>
              </CardHeader>
              <CardContent class="space-y-3">
                <div class="text-xs text-muted-foreground space-y-1">
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">ID:</span>
                    <span class="truncate">{{ agent.id }}</span>
                  </div>
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">VER:</span>
                    <span class="truncate">{{ agent.version }}</span>
                  </div>
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">CMD:</span>
                    <span class="truncate">{{ buildPreviewCommand(agent) }}</span>
                  </div>
                </div>

                <div class="space-y-2">
                  <div class="text-xs font-semibold text-muted-foreground">
                    {{ t('settings.acp.envOverrideTitle') }}
                  </div>
                  <Textarea
                    v-model="envDrafts[agent.id]"
                    class="min-h-[92px] font-mono text-xs"
                    :placeholder="t('settings.acp.envOverridePlaceholder')"
                  />
                  <div class="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      :disabled="Boolean(agentPending[agent.id])"
                      @click="saveEnvOverride(agent)"
                    >
                      {{ t('common.save') }}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      :disabled="Boolean(agentPending[agent.id])"
                      @click="clearEnvOverride(agent)"
                    >
                      {{ t('common.clear') }}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      :disabled="Boolean(agentPending[agent.id])"
                      @click="repairRegistryAgent(agent)"
                    >
                      {{ t('settings.acp.registryRepair') }}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      @click="openInspector(agent.id, agent.name)"
                    >
                      {{ t('settings.acp.debug.entry') }}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator />

        <Collapsible v-model:open="manualSectionOpen" class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">{{ t('settings.acp.customSectionTitle') }}</div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.customSectionDescription') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" @click="manualSectionOpen = !manualSectionOpen">
                {{ manualSectionOpen ? t('common.collapse') : t('common.expand') }}
              </Button>
              <Button size="sm" @click="openManualDialog()">
                {{ t('settings.acp.addCustomAgent') }}
              </Button>
            </div>
          </div>

          <CollapsibleContent class="space-y-3">
            <div
              v-if="loading && !manualAgents.length"
              class="text-sm text-muted-foreground text-center py-8"
            >
              {{ t('settings.acp.loading') }}
            </div>

            <div
              v-else-if="!manualAgents.length"
              class="text-sm text-muted-foreground text-center py-8"
            >
              {{ t('settings.acp.customEmpty') }}
            </div>

            <div v-else class="space-y-3">
              <Card v-for="agent in manualAgents" :key="agent.id">
                <CardHeader class="pb-2">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <CardTitle class="text-base truncate">{{ agent.name }}</CardTitle>
                      <CardDescription class="text-xs truncate">
                        {{ agent.command }}
                      </CardDescription>
                    </div>
                    <Switch
                      :model-value="agent.enabled"
                      :disabled="Boolean(agentPending[agent.id])"
                      @update:model-value="(value) => toggleManualAgent(agent, Boolean(value))"
                    />
                  </div>
                </CardHeader>
                <CardContent class="space-y-3">
                  <div class="text-xs text-muted-foreground space-y-1">
                    <div class="flex items-start gap-1">
                      <span class="font-semibold">ARGS:</span>
                      <span class="truncate">{{ formatArgs(agent.args) }}</span>
                    </div>
                    <div v-if="showSharedMcpSection" class="flex items-start gap-1">
                      <span class="font-semibold">MCP:</span>
                      <span class="truncate">
                        {{
                          sharedMcpCount
                            ? t('settings.acp.mcpAccessBadge', { count: sharedMcpCount })
                            : t('settings.acp.none')
                        }}
                      </span>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" @click="openManualDialog(agent)">
                      {{ t('common.edit') }}
                    </Button>
                    <Button size="sm" variant="ghost" @click="deleteManualAgent(agent)">
                      {{ t('common.delete') }}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      @click="openInspector(agent.id, agent.name)"
                    >
                      {{ t('settings.acp.debug.entry') }}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div v-else class="p-6 text-sm text-muted-foreground text-center">
        {{ t('settings.acp.enableToAccess') }}
      </div>
    </div>

    <Dialog :open="manualDialog.open" @update:open="(value) => (manualDialog.open = value)">
      <DialogContent class="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {{
              manualDialog.agentId
                ? t('settings.acp.profileDialog.editCustomTitle')
                : t('settings.acp.profileDialog.addCustomTitle')
            }}
          </DialogTitle>
          <DialogDescription>
            {{ t('settings.acp.profileDialog.customHint') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <Label>{{ t('settings.acp.profileDialog.agentName') }}</Label>
            <Input
              v-model="manualDialog.name"
              :placeholder="t('settings.acp.profileDialog.agentNamePlaceholder')"
            />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.command') }}</Label>
            <Input
              v-model="manualDialog.command"
              :placeholder="t('settings.acp.commandPlaceholder')"
            />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.args') }}</Label>
            <Input v-model="manualDialog.args" :placeholder="t('settings.acp.argsPlaceholder')" />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.env') }}</Label>
            <Textarea
              v-model="manualDialog.env"
              class="min-h-[120px] font-mono text-xs"
              :placeholder="t('settings.acp.envOverridePlaceholder')"
            />
          </div>
          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <div class="text-sm text-muted-foreground">{{ t('common.enabled') }}</div>
            <Switch v-model="manualDialog.enabled" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" @click="manualDialog.open = false">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="manualSaving" @click="saveManualAgent">
            {{ manualSaving ? t('common.saving') : t('common.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="registryDialog.open" @update:open="(value) => (registryDialog.open = value)">
      <DialogContent hide-close class="sm:max-w-[760px] p-0 overflow-hidden">
        <div class="flex flex-col max-h-[80vh]">
          <DialogHeader class="px-5 pt-5 pb-4 border-b space-y-4 text-left">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div class="space-y-1">
                <DialogTitle>{{ t('settings.acp.registryInstallTitle') }}</DialogTitle>
                <DialogDescription>
                  {{ t('settings.acp.registryInstallDescription') }}
                </DialogDescription>
              </div>
              <div class="flex items-center gap-2 self-end lg:self-start">
                <Button as-child size="sm" variant="outline" class="hidden sm:inline-flex">
                  <a
                    href="https://agentclientprotocol.com/get-started/registry"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {{ t('settings.acp.registryLearnMore') }}
                    <Icon icon="lucide:external-link" class="h-4 w-4 ml-2" />
                  </a>
                </Button>
                <Button size="sm" variant="outline" :disabled="refreshing" @click="refreshRegistry">
                  <Icon
                    :icon="refreshing ? 'lucide:loader' : 'lucide:refresh-cw'"
                    class="h-4 w-4 mr-2"
                    :class="refreshing ? 'animate-spin' : ''"
                  />
                  {{ t('settings.acp.registryRefresh') }}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-9 w-9"
                  :aria-label="t('settings.acp.debug.close')"
                  @click="registryDialog.open = false"
                >
                  <Icon icon="lucide:x" class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div class="space-y-3">
              <div class="relative">
                <Icon
                  icon="lucide:search"
                  class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <Input
                  v-model="registryDialog.search"
                  class="pl-10"
                  :placeholder="t('settings.acp.registrySearchPlaceholder')"
                />
              </div>

              <div class="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  :variant="registryDialog.filter === 'all' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'all'"
                >
                  {{ t('settings.acp.installFilters.all') }}
                </Button>
                <Button
                  size="sm"
                  :variant="registryDialog.filter === 'installed' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'installed'"
                >
                  {{ t('settings.acp.installFilters.installed') }}
                </Button>
                <Button
                  size="sm"
                  :variant="registryDialog.filter === 'not_installed' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'not_installed'"
                >
                  {{ t('settings.acp.installFilters.notInstalled') }}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div class="flex-1 overflow-y-auto px-5 py-4">
            <div
              v-if="loading && !registryAgents.length"
              class="text-sm text-muted-foreground text-center py-12"
            >
              {{ t('settings.acp.loading') }}
            </div>

            <div
              v-else-if="!filteredRegistryCatalogAgents.length"
              class="text-sm text-muted-foreground text-center py-12"
            >
              {{ t('settings.acp.registryOverlayEmpty') }}
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="agent in filteredRegistryCatalogAgents"
                :key="agent.id"
                class="rounded-xl border px-4 py-4 bg-card flex items-start gap-4"
              >
                <AcpAgentIcon
                  :icon="agent.icon"
                  :alt="agent.name"
                  :fallback-text="agent.name"
                  custom-class="h-12 w-12 rounded-xl"
                />

                <div class="min-w-0 flex-1 space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 space-y-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <div class="text-lg font-semibold truncate">{{ agent.name }}</div>
                        <span class="text-sm text-muted-foreground shrink-0">
                          v{{ agent.version }}
                        </span>
                      </div>
                      <p class="text-sm text-muted-foreground line-clamp-2">
                        {{
                          agent.description || t('settings.acp.builtinHint', { name: agent.name })
                        }}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      :variant="registryActionVariant(agent)"
                      :disabled="isRegistryActionDisabled(agent)"
                      @click="handleRegistryCatalogAction(agent)"
                    >
                      <Icon
                        :icon="registryActionIcon(agent)"
                        class="h-4 w-4 mr-2"
                        :class="registryActionSpins(agent) ? 'animate-spin' : ''"
                      />
                      {{ registryActionLabel(agent) }}
                    </Button>
                  </div>

                  <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>ID: {{ agent.id }}</span>
                    <Badge :class="installBadgeClass(agent)" variant="outline">
                      {{ installBadgeLabel(agent) }}
                    </Badge>
                    <a
                      v-if="agent.repository"
                      :href="agent.repository"
                      target="_blank"
                      rel="noreferrer noopener"
                      class="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {{ t('settings.acp.registryRepository') }}
                      <Icon icon="lucide:external-link" class="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AcpDebugDialog
      :open="debugDialog.open"
      :agent-id="debugDialog.agentId"
      :agent-name="debugDialog.agentName"
      @update:open="(value) => (debugDialog.open = value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { AcpManualAgent, AcpRegistryAgent } from '@shared/presenter'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import { Icon } from '@iconify/vue'
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
import { Input } from '@shadcn/components/ui/input'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Label } from '@shadcn/components/ui/label'
import { Collapsible, CollapsibleContent } from '@shadcn/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import AcpDebugDialog from './AcpDebugDialog.vue'
import AgentMcpSelector from '@/components/mcp-config/AgentMcpSelector.vue'
import AcpAgentIcon from '@/components/icons/AcpAgentIcon.vue'

const { t } = useI18n()
const { toast } = useToast()
const configPresenter = usePresenter('configPresenter')

type RegistryDialogFilter = 'all' | 'installed' | 'not_installed'

const acpEnabled = ref(false)
const toggling = ref(false)
const loading = ref(false)
const refreshing = ref(false)
const manualSaving = ref(false)
const manualSectionOpen = ref(false)
const sharedMcpOpen = ref(false)
const sharedMcpCount = ref(0)

const registryAgents = ref<AcpRegistryAgent[]>([])
const manualAgents = ref<AcpManualAgent[]>([])
const envDrafts = reactive<Record<string, string>>({})
const agentPending = reactive<Record<string, boolean>>({})

const debugDialog = reactive({
  open: false,
  agentId: '',
  agentName: ''
})

const manualDialog = reactive({
  open: false,
  agentId: '',
  name: '',
  command: '',
  args: '',
  env: '',
  enabled: true
})

const registryDialog = reactive({
  open: false,
  search: '',
  filter: 'all' as RegistryDialogFilter
})

const parseEnvBlock = (value: string): Record<string, string> => {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf('=')
        if (separatorIndex === -1) {
          return [line, '']
        }
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1)]
      })
      .filter(([key]) => key.length > 0)
  )
}

const stringifyEnvBlock = (env?: Record<string, string>) =>
  Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

const parseArgs = (value: string): string[] | undefined => {
  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  const cleaned = matches.map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : undefined
}

const formatArgs = (args?: string[]) => (args?.length ? args.join(' ') : t('settings.acp.none'))

const buildPreviewCommand = (agent: AcpRegistryAgent) => {
  if (agent.distribution.binary) {
    const firstBinary = Object.values(agent.distribution.binary)[0]
    if (firstBinary) {
      return `${firstBinary.cmd} ${formatArgs(firstBinary.args)}`
    }
  }

  if (agent.distribution.npx) {
    return `npx -y ${agent.distribution.npx.package} ${formatArgs(agent.distribution.npx.args)}`
  }

  if (agent.distribution.uvx) {
    return `uvx ${agent.distribution.uvx.package} ${formatArgs(agent.distribution.uvx.args)}`
  }

  return t('settings.acp.none')
}

const installBadgeLabel = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return t('settings.acp.installState.installed')
  if (status === 'installing') return t('settings.acp.installState.installing')
  if (status === 'error') return t('settings.acp.installState.error')
  return t('settings.acp.installState.notInstalled')
}

const installBadgeClass = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return 'border-emerald-500/40 text-emerald-600'
  if (status === 'installing') return 'border-amber-500/40 text-amber-600'
  if (status === 'error') return 'border-destructive/40 text-destructive'
  return ''
}

const installedRegistryAgents = computed(() =>
  registryAgents.value.filter((agent) => agent.installState?.status === 'installed')
)

const showSharedMcpSection = computed(
  () => installedRegistryAgents.value.length > 0 || manualAgents.value.length > 0
)

const filteredRegistryCatalogAgents = computed(() => {
  const keyword = registryDialog.search.trim().toLowerCase()

  return registryAgents.value.filter((agent) => {
    const matchKeyword =
      !keyword ||
      agent.name.toLowerCase().includes(keyword) ||
      agent.id.toLowerCase().includes(keyword) ||
      (agent.description ?? '').toLowerCase().includes(keyword)

    if (!matchKeyword) {
      return false
    }

    if (registryDialog.filter === 'installed') {
      return agent.installState?.status === 'installed'
    }

    if (registryDialog.filter === 'not_installed') {
      return agent.installState?.status !== 'installed'
    }

    return true
  })
})

const setAgentPending = (agentId: string, pending: boolean) => {
  if (pending) {
    agentPending[agentId] = true
  } else {
    delete agentPending[agentId]
  }
}

const handleError = (error: unknown, description?: string) => {
  console.error('[ACP] settings error:', error)
  toast({
    title: t('settings.acp.saveFailed'),
    description:
      description ?? (error instanceof Error ? error.message : t('common.error.requestFailed')),
    variant: 'destructive'
  })
}

const syncEnvDrafts = (agents: AcpRegistryAgent[]) => {
  agents.forEach((agent) => {
    envDrafts[agent.id] = stringifyEnvBlock(agent.envOverride)
  })
}

const loadSharedMcpCount = async () => {
  sharedMcpCount.value = (await configPresenter.getAcpSharedMcpSelections()).length
}

const loadAcpData = async () => {
  loading.value = true
  try {
    acpEnabled.value = await configPresenter.getAcpEnabled()
    if (!acpEnabled.value) {
      registryAgents.value = []
      manualAgents.value = []
      sharedMcpCount.value = 0
      return
    }

    const [registryList, manualList] = await Promise.all([
      configPresenter.listAcpRegistryAgents(),
      configPresenter.listManualAcpAgents()
    ])

    registryAgents.value = registryList
    manualAgents.value = manualList
    syncEnvDrafts(registryList)
    await loadSharedMcpCount()
  } catch (error) {
    handleError(error)
  } finally {
    loading.value = false
  }
}

const handleToggle = async (enabled: boolean) => {
  if (toggling.value) return
  toggling.value = true
  try {
    await configPresenter.setAcpEnabled(enabled)
    acpEnabled.value = enabled
    if (enabled) {
      await loadAcpData()
    }
  } catch (error) {
    handleError(error)
  } finally {
    toggling.value = false
  }
}

const refreshRegistry = async () => {
  refreshing.value = true
  try {
    registryAgents.value = await configPresenter.refreshAcpRegistry(true)
    syncEnvDrafts(registryAgents.value)
  } catch (error) {
    handleError(error)
  } finally {
    refreshing.value = false
  }
}

const handleSharedMcpUpdated = (selections: string[]) => {
  sharedMcpCount.value = selections.length
}

const toggleRegistryAgent = async (agent: AcpRegistryAgent, enabled: boolean) => {
  setAgentPending(agent.id, true)
  try {
    await configPresenter.setAcpAgentEnabled(agent.id, enabled)
    await loadAcpData()
  } catch (error) {
    handleError(error)
  } finally {
    setAgentPending(agent.id, false)
  }
}

const saveEnvOverride = async (agent: AcpRegistryAgent) => {
  setAgentPending(agent.id, true)
  try {
    await configPresenter.setAcpAgentEnvOverride(agent.id, parseEnvBlock(envDrafts[agent.id] ?? ''))
    await loadAcpData()
    toast({ title: t('settings.acp.saveSuccess') })
  } catch (error) {
    handleError(error)
  } finally {
    setAgentPending(agent.id, false)
  }
}

const clearEnvOverride = async (agent: AcpRegistryAgent) => {
  envDrafts[agent.id] = ''
  await saveEnvOverride(agent)
}

const installRegistryAgent = async (agent: AcpRegistryAgent) => {
  setAgentPending(agent.id, true)
  try {
    if (agent.installState?.status === 'error') {
      await configPresenter.repairAcpAgent(agent.id)
    } else {
      await configPresenter.ensureAcpAgentInstalled(agent.id)
    }
    await loadAcpData()
  } catch (error) {
    handleError(error)
  } finally {
    setAgentPending(agent.id, false)
  }
}

const repairRegistryAgent = async (agent: AcpRegistryAgent) => {
  setAgentPending(agent.id, true)
  try {
    await configPresenter.repairAcpAgent(agent.id)
    await loadAcpData()
  } catch (error) {
    handleError(error)
  } finally {
    setAgentPending(agent.id, false)
  }
}

const openInspector = (agentId: string, agentName: string) => {
  debugDialog.agentId = agentId
  debugDialog.agentName = agentName
  debugDialog.open = true
}

const openManualDialog = (agent?: AcpManualAgent) => {
  manualDialog.agentId = agent?.id ?? ''
  manualDialog.name = agent?.name ?? ''
  manualDialog.command = agent?.command ?? ''
  manualDialog.args = agent?.args?.join(' ') ?? ''
  manualDialog.env = stringifyEnvBlock(agent?.env)
  manualDialog.enabled = agent?.enabled ?? true
  manualDialog.open = true
}

const saveManualAgent = async () => {
  if (!manualDialog.name.trim() || !manualDialog.command.trim()) {
    toast({
      title: t('settings.acp.missingFieldsTitle'),
      description: t('settings.acp.missingFieldsDesc'),
      variant: 'destructive'
    })
    return
  }

  manualSaving.value = true
  try {
    const payload = {
      name: manualDialog.name.trim(),
      command: manualDialog.command.trim(),
      args: parseArgs(manualDialog.args),
      env: parseEnvBlock(manualDialog.env),
      enabled: manualDialog.enabled
    }

    if (manualDialog.agentId) {
      await configPresenter.updateManualAcpAgent(manualDialog.agentId, payload)
    } else {
      await configPresenter.addManualAcpAgent(payload)
    }

    manualDialog.open = false
    await loadAcpData()
    toast({ title: t('settings.acp.saveSuccess') })
  } catch (error) {
    handleError(error)
  } finally {
    manualSaving.value = false
  }
}

const toggleManualAgent = async (agent: AcpManualAgent, enabled: boolean) => {
  setAgentPending(agent.id, true)
  try {
    await configPresenter.updateManualAcpAgent(agent.id, { enabled })
    await loadAcpData()
  } catch (error) {
    handleError(error)
  } finally {
    setAgentPending(agent.id, false)
  }
}

const deleteManualAgent = async (agent: AcpManualAgent) => {
  try {
    await configPresenter.removeManualAcpAgent(agent.id)
    await loadAcpData()
  } catch (error) {
    handleError(error)
  }
}

const openRegistryDialog = () => {
  registryDialog.open = true
}

const registryActionLabel = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return t('settings.acp.installState.installed')
  if (status === 'installing') return t('settings.acp.installState.installing')
  if (status === 'error') return t('settings.acp.registryRepair')
  return t('settings.acp.registryInstallAction')
}

const registryActionVariant = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  return status === 'installed' ? 'outline' : 'default'
}

const registryActionIcon = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return 'lucide:check'
  if (status === 'installing') return 'lucide:loader'
  if (status === 'error') return 'lucide:wrench'
  return 'lucide:download'
}

const registryActionSpins = (agent: AcpRegistryAgent) => {
  return agent.installState?.status === 'installing'
}

const isRegistryActionDisabled = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  return Boolean(agentPending[agent.id]) || status === 'installing' || status === 'installed'
}

const handleRegistryCatalogAction = async (agent: AcpRegistryAgent) => {
  if (isRegistryActionDisabled(agent)) {
    return
  }
  await installRegistryAgent(agent)
}

onMounted(() => {
  void loadAcpData()
})
</script>
