<template>
  <div data-testid="settings-acp-page" class="w-full h-full flex flex-col">
    <div class="shrink-0 px-4 pt-4 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-medium">{{ t('settings.acp.enabledTitle') }}</div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.acp.enabledDescription') }}
          </p>
        </div>
        <div class="flex min-w-0 items-center gap-3">
          <Switch
            dir="ltr"
            :model-value="acpEnabled"
            class="scale-125"
            :disabled="!loaded || loading || isAnyMutationPending"
            @update:model-value="handleToggle"
          />
        </div>
      </div>

      <div
        v-if="loadError"
        role="alert"
        class="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      >
        <span>{{ loadError }}</span>
        <DcButton size="sm" variant="ghost" :disabled="loading" @click="loadAcpData">
          {{ t('common.retry') }}
        </DcButton>
      </div>

      <div
        v-if="acpEnabled && loaded"
        class="rounded-xl border bg-muted/20 px-4 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="space-y-1">
          <div class="text-sm font-semibold">{{ t('settings.acp.registryInstallEntry') }}</div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.acp.registryInstallEntryDescription') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <DcButton variant="outline" @click="openRegistryDialog">
            <Icon icon="lucide:download" class="h-4 w-4 mr-2" />
            {{ t('settings.acp.registryInstallEntry') }}
          </DcButton>
        </div>
      </div>

      <Separator />
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="acpEnabled && loaded" class="p-4 space-y-6">
        <Collapsible v-if="showSharedMcpSection" v-model:open="sharedMcpOpen" class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xl font-semibold">{{ t('settings.acp.sharedMcpTitle') }}</div>
              <p class="text-sm text-muted-foreground">
                {{ t('settings.acp.sharedMcpDescription') }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <DcBadge variant="outline">
                {{ t('settings.acp.mcpAccessBadge', { count: sharedMcpCount }) }}
              </DcBadge>
              <DcButton
                size="sm"
                variant="outline"
                :disabled="sharedMcpLeaveRisk !== 'clean'"
                @click="sharedMcpOpen = !sharedMcpOpen"
              >
                {{ sharedMcpOpen ? t('common.collapse') : t('common.expand') }}
              </DcButton>
            </div>
          </div>

          <CollapsibleContent>
            <Card>
              <CardContent class="pt-6">
                <AgentMcpSelector
                  ref="sharedMcpSelectorRef"
                  @update:selections="handleSharedMcpUpdated"
                  @persistence-state="handleSharedMcpPersistenceState"
                />
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
            <DcBadge variant="outline">
              {{ t('settings.acp.installedCount', { count: installedRegistryAgents.length }) }}
            </DcBadge>
          </div>

          <div
            v-if="loading && !installedRegistryAgents.length"
            class="text-sm text-muted-foreground text-center py-8"
          >
            {{ t('settings.acp.loading') }}
          </div>

          <DcEmpty
            v-else-if="!installedRegistryAgents.length"
            :title="t('settings.acp.installedEmptyTitle')"
            :description="t('settings.acp.installedEmptyDescription')"
          />

          <div v-else class="grid gap-3 xl:grid-cols-2">
            <Card v-for="agent in installedRegistryAgents" :key="agent.id">
              <CardHeader class="pb-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <CardTitle class="text-base flex items-center gap-2 min-w-0">
                      <AcpAgentIcon
                        :agent-id="agent.id"
                        :icon="agent.icon"
                        :alt="agent.name"
                        :fallback-text="agent.name"
                        custom-class="h-5 w-5"
                      />
                      <span class="truncate">{{ agent.name }}</span>
                      <DcBadge :class="installBadgeClass(agent)" variant="outline">
                        {{ installBadgeLabel(agent) }}
                      </DcBadge>
                      <DcBadge v-if="agent.enabled" variant="secondary">
                        {{ t('common.enabled') }}
                      </DcBadge>
                    </CardTitle>
                    <CardDescription class="text-xs mt-1">
                      {{ agent.description || t('settings.acp.builtinHint', { name: agent.name }) }}
                    </CardDescription>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <DcButton
                      size="sm"
                      variant="destructive"
                      :disabled="isAnyMutationPending"
                      @click="confirmRegistryAgentUninstall(agent)"
                    >
                      {{ t('settings.acp.registryUninstallAction') }}
                    </DcButton>
                    <Switch
                      :model-value="agent.enabled"
                      :disabled="isAnyMutationPending"
                      @update:model-value="(value) => toggleRegistryAgent(agent, Boolean(value))"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent class="space-y-3">
                <div class="text-xs text-muted-foreground space-y-1">
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">{{ t('settings.model.form.id.label') }}:</span>
                    <span class="truncate">{{ agent.id }}</span>
                  </div>
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">{{ t('settings.about.version') }}:</span>
                    <span class="truncate">{{ agent.version }}</span>
                  </div>
                  <div class="flex items-start gap-1">
                    <span class="font-semibold">{{ t('settings.acp.command') }}:</span>
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
                    :disabled="isAnyMutationPending"
                    @update:model-value="clearPageFeedbackForAgent(agent.id)"
                  />
                  <div class="flex flex-wrap gap-2">
                    <DcSubmitButton
                      size="sm"
                      variant="outline"
                      :status="envSaveStatusFor(agent.id)"
                      :disabled="isAnyMutationPending"
                      @click="saveEnvOverride(agent)"
                    >
                      {{ t('common.save') }}
                    </DcSubmitButton>
                    <DcSubmitButton
                      size="sm"
                      variant="ghost"
                      :status="envSaveStatusFor(agent.id)"
                      :disabled="isAnyMutationPending"
                      @click="clearEnvOverride(agent)"
                    >
                      {{ t('common.clear') }}
                    </DcSubmitButton>
                    <DcButton
                      size="sm"
                      variant="outline"
                      :disabled="isAnyMutationPending"
                      @click="repairRegistryAgent(agent)"
                    >
                      {{ t('settings.acp.registryRepair') }}
                    </DcButton>
                    <DcButton
                      size="sm"
                      variant="outline"
                      :disabled="isAnyMutationPending"
                      @click="openInspector(agent.id, agent.name)"
                    >
                      {{ t('settings.acp.debug.entry') }}
                    </DcButton>
                  </div>
                  <DcInlineError
                    v-if="envOperationErrors[agent.id]"
                    :error="envOperationErrors[agent.id] ?? undefined"
                    class="mt-1"
                  />
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
              <DcButton size="sm" variant="outline" @click="manualSectionOpen = !manualSectionOpen">
                {{ manualSectionOpen ? t('common.collapse') : t('common.expand') }}
              </DcButton>
              <DcButton size="sm" :disabled="isAnyMutationPending" @click="openManualDialog()">
                {{ t('settings.acp.addCustomAgent') }}
              </DcButton>
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
                      :disabled="isAnyMutationPending"
                      @update:model-value="(value) => toggleManualAgent(agent, Boolean(value))"
                    />
                  </div>
                </CardHeader>
                <CardContent class="space-y-3">
                  <div class="text-xs text-muted-foreground space-y-1">
                    <div class="flex items-start gap-1">
                      <span class="font-semibold">{{ t('settings.acp.args') }}:</span>
                      <span class="truncate">{{ formatArgs(agent.args) }}</span>
                    </div>
                    <div v-if="showSharedMcpSection" class="flex items-start gap-1">
                      <span class="font-semibold">{{ t('settings.acp.mcpAccessTitle') }}:</span>
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
                    <DcButton
                      size="sm"
                      variant="ghost"
                      :disabled="isAnyMutationPending"
                      @click="openManualDialog(agent)"
                    >
                      {{ t('common.edit') }}
                    </DcButton>
                    <DcButton
                      size="sm"
                      variant="ghost"
                      :disabled="isAnyMutationPending"
                      @click="confirmAndDeleteManualAgent(agent)"
                    >
                      {{ t('common.delete') }}
                    </DcButton>
                    <DcButton
                      size="sm"
                      variant="outline"
                      :disabled="isAnyMutationPending"
                      @click="openInspector(agent.id, agent.name)"
                    >
                      {{ t('settings.acp.debug.entry') }}
                    </DcButton>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div v-else-if="loading" class="p-6 text-sm text-muted-foreground text-center">
        {{ t('settings.acp.loading') }}
      </div>

      <div v-else-if="loaded" class="p-6 text-sm text-muted-foreground text-center">
        {{ t('settings.acp.enableToAccess') }}
      </div>
    </div>

    <Dialog :open="manualDialog.open" @update:open="handleManualDialogOpenChange">
      <DialogContent class="sm:max-w-[560px]" :inert="manualSaving || undefined">
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
              :aria-invalid="Boolean(manualDialog.error)"
              @update:model-value="handleManualDialogEdited"
            />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.command') }}</Label>
            <Input
              v-model="manualDialog.command"
              :placeholder="t('settings.acp.commandPlaceholder')"
              :aria-invalid="Boolean(manualDialog.error)"
              @update:model-value="handleManualDialogEdited"
            />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.args') }}</Label>
            <Textarea
              v-model="manualDialogArgsText"
              class="min-h-[96px] font-mono text-xs"
              :placeholder="t('settings.mcp.serverForm.argsPlaceholder')"
              @update:model-value="handleManualDialogEdited"
            />
          </div>
          <div class="space-y-2">
            <Label>{{ t('settings.acp.env') }}</Label>
            <Textarea
              v-model="manualDialog.env"
              class="min-h-[120px] font-mono text-xs"
              :placeholder="t('settings.acp.envOverridePlaceholder')"
              @update:model-value="handleManualDialogEdited"
            />
          </div>
          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <div class="text-sm text-muted-foreground">{{ t('common.enabled') }}</div>
            <Switch v-model="manualDialog.enabled" @update:model-value="handleManualDialogEdited" />
          </div>
          <DcInlineError v-if="manualDialog.error" :error="manualDialog.error" class="mt-2" />
        </div>

        <DialogFooter>
          <DcFormActions
            :submit-status="manualSaveStatus"
            :submit-disabled="manualSaving"
            :cancel-disabled="manualSaving"
            :submit-label="t('common.save')"
            @cancel="handleManualDialogOpenChange(false)"
            @submit="saveManualAgent"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="registryDialog.open" @update:open="handleRegistryDialogOpenChange">
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
                <DcButton as-child size="sm" variant="outline" class="hidden sm:inline-flex">
                  <a
                    href="https://agentclientprotocol.com/get-started/registry"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {{ t('settings.acp.registryLearnMore') }}
                    <Icon icon="lucide:external-link" class="h-4 w-4 ml-2" />
                  </a>
                </DcButton>
                <DcButton
                  size="sm"
                  variant="outline"
                  :disabled="isAnyMutationPending"
                  @click="refreshRegistry"
                >
                  <Spinner v-if="isRegistryRefreshPending" data-icon="inline-start" />
                  <Icon v-else icon="lucide:refresh-cw" data-icon="inline-start" />
                  {{ t('settings.acp.registryRefresh') }}
                </DcButton>
                <DcButton
                  size="icon"
                  variant="ghost"
                  class="h-9 w-9"
                  :aria-label="t('settings.acp.debug.close')"
                  :disabled="isRegistryDialogPending"
                  @click="handleRegistryDialogOpenChange(false)"
                  :tooltip="t('settings.acp.debug.close')"
                >
                  <Icon icon="lucide:x" class="h-4 w-4" />
                </DcButton>
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
                <DcButton
                  size="sm"
                  :variant="registryDialog.filter === 'all' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'all'"
                >
                  {{ t('settings.acp.installFilters.all') }}
                </DcButton>
                <DcButton
                  size="sm"
                  :variant="registryDialog.filter === 'installed' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'installed'"
                >
                  {{ t('settings.acp.installFilters.installed') }}
                </DcButton>
                <DcButton
                  size="sm"
                  :variant="registryDialog.filter === 'not_installed' ? 'default' : 'outline'"
                  @click="registryDialog.filter = 'not_installed'"
                >
                  {{ t('settings.acp.installFilters.notInstalled') }}
                </DcButton>
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
                  :agent-id="agent.id"
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

                    <DcButton
                      size="sm"
                      :variant="registryActionVariant(agent)"
                      :disabled="isRegistryActionDisabled(agent)"
                      @click="handleRegistryCatalogAction(agent)"
                    >
                      <Spinner v-if="registryActionSpins(agent)" data-icon="inline-start" />
                      <Icon v-else :icon="registryActionIcon(agent)" data-icon="inline-start" />
                      {{ registryActionLabel(agent) }}
                    </DcButton>
                  </div>

                  <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{{ t('settings.model.form.id.label') }}: {{ agent.id }}</span>
                    <DcBadge :class="installBadgeClass(agent)" variant="outline">
                      {{ installBadgeLabel(agent) }}
                    </DcBadge>
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

    <AgentTransferDialog
      :open="transferDialogOpen"
      mode="delete-agent"
      :source-agent-id="pendingDeleteAgent?.id ?? ''"
      :source-agent-name="pendingDeleteAgent?.name ?? ''"
      :agents="transferAgents"
      :impact="transferImpact"
      :loading="transferDialogLoading"
      :busy="transferDialogBusy"
      :error="transferDialogError"
      @update:open="handleTransferDialogOpenChange"
      @confirm-move="handleDeleteAgentWithMove"
      @confirm-delete="handleDeleteAgentWithSessions"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { AcpManualAgent } from '@shared/types/acp'
import type { AcpRegistryAgent } from '@shared/types/acp'
import type { AgentTransferImpact } from '@shared/types/agent-interface'
import { useI18n } from 'vue-i18n'
import { createConfigClient } from '@api/ConfigClient'
import { createSessionClient } from '@api/SessionClient'
import { Icon } from '@iconify/vue'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import { DcBadge } from '@dc-ui/components/badge'
import { DcEmpty } from '@dc-ui/components/empty'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
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
import AgentTransferDialog from '@/components/agent/AgentTransferDialog.vue'
import AgentMcpSelector from '@/components/mcp-config/AgentMcpSelector.vue'
import AcpAgentIcon from '@/components/icons/AcpAgentIcon.vue'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import type { DcFormSubmitStatus } from '@dc-ui/components/form'
import { settingsLeaveGuard, type SettingsLeaveRisk } from '../services/settingsLeaveGuard'

const { t } = useI18n()
const configClient = createConfigClient()

type RegistryDialogFilter = 'all' | 'installed' | 'not_installed'
type PendingDeleteAgent = {
  id: string
  name: string
  source: 'manual' | 'registry'
}
type PageOperation =
  | {
      kind: 'acp-toggle'
      agentId: null
      enabled: boolean
    }
  | {
      kind: 'registry-toggle'
      agentId: string
      enabled: boolean
    }
  | {
      kind: 'manual-toggle'
      agentId: string
      enabled: boolean
    }
  | {
      kind: 'env-save'
      agentId: string
      env: Record<string, string>
    }
  | {
      kind: 'repair'
      agentId: string
    }
  | {
      kind: 'registry-refresh'
      agentId: null
    }
  | {
      kind: 'registry-install'
      agentId: string
    }
  | {
      kind: 'manual-save'
      agentId: string | null
    }
  | {
      kind: 'delete-agent'
      agentId: string
    }

const acpEnabled = ref(false)
const loading = ref(false)
const loaded = ref(false)
const loadError = ref<string | null>(null)
const manualSectionOpen = ref(false)
const sharedMcpOpen = ref(false)
const sharedMcpCount = ref(0)
const sharedMcpLeaveRisk = ref<SettingsLeaveRisk>('clean')
const sharedMcpSelectorRef = ref<InstanceType<typeof AgentMcpSelector> | null>(null)

const registryAgents = ref<AcpRegistryAgent[]>([])
const manualAgents = ref<AcpManualAgent[]>([])
const envDrafts = reactive<Record<string, string>>({})
const transferAgents = ref<
  Array<{ id: string; name: string; type: 'deepchat' | 'acp'; enabled?: boolean }>
>([])
const transferDialogOpen = ref(false)
const transferDialogLoading = ref(false)
const transferDialogError = ref<string | null>(null)
const transferImpact = ref<AgentTransferImpact | null>(null)
const pendingDeleteAgent = ref<PendingDeleteAgent | null>(null)
const pageOperation = ref<PageOperation | null>(null)
const pageMutationPending = ref(false)
const { status: envSaveStatus, run: runEnvSave } = useDcFormSubmit()
const { status: manualSaveStatus, run: runManualSave } = useDcFormSubmit()
const envOperationErrors = ref<Record<string, string | null>>({})

const envSaveStatusFor = (agentId: string): DcFormSubmitStatus => {
  const operation = pageOperation.value
  if (operation?.kind === 'env-save' && operation.agentId === agentId) {
    return envSaveStatus.value
  }
  return 'idle'
}

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
  args: [] as string[],
  env: '',
  enabled: true,
  error: null as string | null
})
const manualDialogDirty = ref(false)

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

const formatArgs = (args?: string[]) => (args?.length ? args.join(' ') : t('settings.acp.none'))

const manualDialogArgsText = computed({
  get: () => manualDialog.args.join('\n'),
  set: (value: string) => {
    manualDialog.args = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
})

const buildPreviewCommand = (agent: AcpRegistryAgent) => {
  if (agent.distribution.binary) {
    const firstBinary = Object.values(agent.distribution.binary)[0]
    if (firstBinary) {
      return firstBinary.args?.length
        ? `${firstBinary.cmd} ${formatArgs(firstBinary.args)}`
        : firstBinary.cmd
    }
  }

  if (agent.distribution.npx) {
    return agent.distribution.npx.args?.length
      ? `npx -y ${agent.distribution.npx.package} ${formatArgs(agent.distribution.npx.args)}`
      : `npx -y ${agent.distribution.npx.package}`
  }

  if (agent.distribution.uvx) {
    return agent.distribution.uvx.args?.length
      ? `uvx ${agent.distribution.uvx.package} ${formatArgs(agent.distribution.uvx.args)}`
      : `uvx ${agent.distribution.uvx.package}`
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
  registryAgents.value.filter(
    (agent) =>
      agent.installState?.status === 'installed' || Boolean(agent.installState?.installedAt)
  )
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

const manualSaving = computed(
  () => pageMutationPending.value && pageOperation.value?.kind === 'manual-save'
)
const transferDialogBusy = computed(
  () => pageMutationPending.value && pageOperation.value?.kind === 'delete-agent'
)
const isRegistryDialogPending = computed(
  () =>
    pageMutationPending.value &&
    (pageOperation.value?.kind === 'registry-refresh' ||
      pageOperation.value?.kind === 'registry-install')
)
const isRegistryRefreshPending = computed(
  () => isRegistryDialogPending.value && pageOperation.value?.kind === 'registry-refresh'
)
const isAnyMutationPending = computed(
  () => pageMutationPending.value || sharedMcpLeaveRisk.value === 'busy'
)

const dirtyEnvDrafts = reactive(new Set<string>())
const hasUnsavedDrafts = computed(
  () =>
    dirtyEnvDrafts.size > 0 ||
    (manualDialog.open && manualDialogDirty.value) ||
    sharedMcpLeaveRisk.value === 'dirty'
)

const syncEnvDrafts = (agents: AcpRegistryAgent[]) => {
  const currentIds = new Set(agents.map((agent) => agent.id))
  Object.keys(envDrafts).forEach((agentId) => {
    if (!currentIds.has(agentId)) {
      delete envDrafts[agentId]
      dirtyEnvDrafts.delete(agentId)
    }
  })
  agents.forEach((agent) => {
    if (!dirtyEnvDrafts.has(agent.id)) {
      envDrafts[agent.id] = stringifyEnvBlock(agent.envOverride)
    }
  })
}

const updateRegistryAgent = (
  agentId: string,
  update: (agent: AcpRegistryAgent) => AcpRegistryAgent
) => {
  registryAgents.value = registryAgents.value.map((agent) =>
    agent.id === agentId ? update(agent) : agent
  )
}

const updateManualAgent = (updated: AcpManualAgent) => {
  const index = manualAgents.value.findIndex((agent) => agent.id === updated.id)
  if (index === -1) {
    manualAgents.value = [...manualAgents.value, updated]
    return
  }
  manualAgents.value = manualAgents.value.map((agent) =>
    agent.id === updated.id ? updated : agent
  )
}

let loadGeneration = 0
const invalidatePendingLoad = () => {
  loadGeneration += 1
  loading.value = false
}

const loadAcpData = async () => {
  const generation = ++loadGeneration
  loading.value = true
  loadError.value = null
  try {
    const enabled = await configClient.getAcpEnabled()
    if (generation !== loadGeneration) return

    if (!enabled) {
      acpEnabled.value = false
      registryAgents.value = []
      manualAgents.value = []
      sharedMcpCount.value = 0
      loaded.value = true
      return
    }

    const [registryList, manualList, sharedSelections] = await Promise.all([
      configClient.listAcpRegistryAgents(),
      configClient.listManualAcpAgents(),
      configClient.getAcpSharedMcpSelections()
    ])
    if (generation !== loadGeneration) return

    acpEnabled.value = true
    registryAgents.value = registryList
    manualAgents.value = manualList
    sharedMcpCount.value = sharedSelections.length
    syncEnvDrafts(registryList)
    loaded.value = true
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('[ACP] Failed to load settings:', error)
    loadError.value = t('common.error.requestFailed')
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
    }
  }
}

const beginPageOperation = (operation: PageOperation) => {
  if (isAnyMutationPending.value) return false
  pageOperation.value = operation
  pageMutationPending.value = true
  return true
}

const completePageOperation = (code: string, showConfirmation = false) => {
  notifyRenderer({
    kind: 'success',
    code,
    title: t('common.saved')
  })
  pageMutationPending.value = false
  if (!showConfirmation) {
    pageOperation.value = null
  }
}

const failPageOperation = (code: string, title: string) => {
  notifyRenderer({
    kind: 'error',
    code,
    title
  })
  pageMutationPending.value = false
}

const handleToggle = async (enabled: boolean) => {
  if (
    !beginPageOperation({
      kind: 'acp-toggle',
      agentId: null,
      enabled
    })
  ) {
    return
  }

  try {
    await configClient.setAcpEnabled(enabled)
    invalidatePendingLoad()
    acpEnabled.value = enabled
    loadError.value = null
    completePageOperation('settings.acp.enabledChanged')
    if (enabled) {
      loaded.value = false
      void loadAcpData()
    } else {
      registryAgents.value = []
      manualAgents.value = []
      sharedMcpCount.value = 0
    }
  } catch (error) {
    console.error('[ACP] Failed to change ACP availability:', error)
    failPageOperation('settings.acp.enabledChangeFailed', t('common.error.operationFailed'))
  }
}

const refreshRegistry = async () => {
  if (
    !beginPageOperation({
      kind: 'registry-refresh',
      agentId: null
    })
  ) {
    return
  }

  try {
    const refreshed = await configClient.refreshAcpRegistry(true)
    invalidatePendingLoad()
    registryAgents.value = refreshed
    syncEnvDrafts(refreshed)
    completePageOperation('settings.acp.registryRefreshed')
  } catch (error) {
    console.error('[ACP] Failed to refresh registry:', error)
    failPageOperation('settings.acp.registryRefreshFailed', t('common.error.requestFailed'))
  }
}

const handleSharedMcpUpdated = (selections: string[]) => {
  sharedMcpCount.value = selections.length
}

const handleSharedMcpPersistenceState = (state: 'idle' | 'saving' | 'retryable') => {
  sharedMcpLeaveRisk.value = state === 'saving' ? 'busy' : state === 'retryable' ? 'dirty' : 'clean'
}

const toggleRegistryAgent = async (agent: AcpRegistryAgent, enabled: boolean) => {
  if (
    !beginPageOperation({
      kind: 'registry-toggle',
      agentId: agent.id,
      enabled
    })
  ) {
    return
  }

  try {
    await configClient.setAcpAgentEnabled(agent.id, enabled)
    invalidatePendingLoad()
    updateRegistryAgent(agent.id, (current) => ({ ...current, enabled }))
    completePageOperation('settings.acp.registryAgentToggled')
  } catch (error) {
    console.error('[ACP] Failed to change registry agent state:', error)
    failPageOperation('settings.acp.registryAgentToggleFailed', t('settings.acp.saveFailed'))
  }
}

const saveEnvOverride = async (
  agent: AcpRegistryAgent,
  env = parseEnvBlock(envDrafts[agent.id] ?? '')
) => {
  if (
    !beginPageOperation({
      kind: 'env-save',
      agentId: agent.id,
      env
    })
  ) {
    return
  }
  envOperationErrors.value[agent.id] = null

  try {
    await runEnvSave(async () => {
      await configClient.setAcpAgentEnvOverride(agent.id, env)
      invalidatePendingLoad()
      dirtyEnvDrafts.delete(agent.id)
      envDrafts[agent.id] = stringifyEnvBlock(env)
      updateRegistryAgent(agent.id, (current) => ({ ...current, envOverride: env }))
      pageMutationPending.value = false
    })
  } catch (error) {
    console.error('[ACP] Failed to save environment overrides:', error)
    pageMutationPending.value = false
    envOperationErrors.value[agent.id] = t('settings.acp.saveFailed')
  }
}

const clearEnvOverride = async (agent: AcpRegistryAgent) => {
  if (isAnyMutationPending.value) return
  envDrafts[agent.id] = ''
  dirtyEnvDrafts.add(agent.id)
  await saveEnvOverride(agent, {})
}

const installRegistryAgent = async (agent: AcpRegistryAgent) => {
  if (
    !beginPageOperation({
      kind: 'registry-install',
      agentId: agent.id
    })
  ) {
    return
  }

  try {
    const installState =
      agent.installState?.status === 'error'
        ? await configClient.repairAcpAgent(agent.id)
        : await configClient.ensureAcpAgentInstalled(agent.id)
    invalidatePendingLoad()
    updateRegistryAgent(agent.id, (current) => ({ ...current, installState }))
    completePageOperation('settings.acp.registryAgentInstalled')
  } catch (error) {
    console.error('[ACP] Failed to install registry agent:', error)
    failPageOperation('settings.acp.registryAgentInstallFailed', t('common.error.operationFailed'))
  }
}

const repairRegistryAgent = async (agent: AcpRegistryAgent) => {
  if (
    !beginPageOperation({
      kind: 'repair',
      agentId: agent.id
    })
  ) {
    return
  }

  try {
    const installState = await configClient.repairAcpAgent(agent.id)
    invalidatePendingLoad()
    updateRegistryAgent(agent.id, (current) => ({ ...current, installState }))
    completePageOperation('settings.acp.registryAgentRepaired')
  } catch (error) {
    console.error('[ACP] Failed to repair registry agent:', error)
    failPageOperation('settings.acp.registryAgentRepairFailed', t('common.error.operationFailed'))
  }
}

const clearPageFeedbackForAgent = (agentId: string) => {
  dirtyEnvDrafts.add(agentId)
  envOperationErrors.value[agentId] = null
  if (pageOperation.value?.kind !== 'env-save' || pageOperation.value.agentId !== agentId) {
    return
  }
  pageOperation.value = null
}

const handleRegistryDialogOpenChange = (open: boolean) => {
  if (!open && isRegistryDialogPending.value) return
  registryDialog.open = open
}

const openInspector = (agentId: string, agentName: string) => {
  debugDialog.agentId = agentId
  debugDialog.agentName = agentName
  debugDialog.open = true
}

const clearManualDialogError = () => {
  manualDialog.error = null
}

const handleManualDialogEdited = () => {
  manualDialogDirty.value = true
  clearManualDialogError()
}

const handleManualDialogOpenChange = (open: boolean) => {
  if (!open && manualSaving.value) return
  manualDialog.open = open
  if (!open) {
    manualDialogDirty.value = false
    clearManualDialogError()
  }
}

const openManualDialog = (agent?: AcpManualAgent) => {
  clearManualDialogError()
  manualDialogDirty.value = false
  manualDialog.agentId = agent?.id ?? ''
  manualDialog.name = agent?.name ?? ''
  manualDialog.command = agent?.command ?? ''
  manualDialog.args = [...(agent?.args ?? [])]
  manualDialog.env = stringifyEnvBlock(agent?.env)
  manualDialog.enabled = agent?.enabled ?? true
  manualDialog.open = true
}

const saveManualAgent = async () => {
  if (!manualDialog.name.trim() || !manualDialog.command.trim()) {
    manualDialog.error = t('settings.acp.missingFieldsTitle')
    return
  }
  manualDialogDirty.value = true
  if (
    !beginPageOperation({
      kind: 'manual-save',
      agentId: manualDialog.agentId || null
    })
  ) {
    return
  }

  manualDialog.error = null
  try {
    await runManualSave(async () => {
      const payload = {
        name: manualDialog.name.trim(),
        command: manualDialog.command.trim(),
        args: manualDialog.args.length ? [...manualDialog.args] : undefined,
        env: parseEnvBlock(manualDialog.env),
        enabled: manualDialog.enabled
      }

      const savedAgent = manualDialog.agentId
        ? await configClient.updateManualAcpAgent(manualDialog.agentId, payload)
        : await configClient.addManualAcpAgent(payload)
      if (!savedAgent) {
        throw new Error(`ACP agent "${manualDialog.agentId}" no longer exists`)
      }

      invalidatePendingLoad()
      updateManualAgent(savedAgent)
      manualSectionOpen.value = true
      manualDialogDirty.value = false
      pageMutationPending.value = false
      manualDialog.open = false
    })
  } catch (error) {
    console.error('[ACP] Failed to save manual agent:', error)
    manualDialog.error = t('settings.acp.saveFailed')
    pageMutationPending.value = false
  }
}

const toggleManualAgent = async (agent: AcpManualAgent, enabled: boolean) => {
  if (
    !beginPageOperation({
      kind: 'manual-toggle',
      agentId: agent.id,
      enabled
    })
  ) {
    return
  }

  try {
    const updated = await configClient.updateManualAcpAgent(agent.id, { enabled })
    if (!updated) {
      throw new Error(`ACP agent "${agent.id}" no longer exists`)
    }
    invalidatePendingLoad()
    updateManualAgent(updated)
    completePageOperation('settings.acp.manualAgentToggled')
  } catch (error) {
    console.error('[ACP] Failed to change manual agent state:', error)
    failPageOperation('settings.acp.manualAgentToggleFailed', t('settings.acp.saveFailed'))
  }
}

let transferLoadGeneration = 0
const openAgentTransferDialog = async (agent: PendingDeleteAgent) => {
  pendingDeleteAgent.value = agent
  transferDialogOpen.value = true
  transferDialogLoading.value = true
  transferDialogError.value = null
  transferImpact.value = null
  const generation = ++transferLoadGeneration
  try {
    const sessionClient = createSessionClient()
    const [impact, agents] = await Promise.all([
      sessionClient.getAgentTransferImpact(agent.id),
      configClient.listAgents()
    ])
    if (generation !== transferLoadGeneration || pendingDeleteAgent.value?.id !== agent.id) return
    transferImpact.value = impact
    transferAgents.value = agents
      .filter((item) => item.type === 'deepchat')
      .map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        enabled: item.enabled
      }))
  } catch (error) {
    if (generation !== transferLoadGeneration) return
    console.error('[ACP] Failed to load agent transfer impact:', error)
    transferDialogError.value = t('common.error.requestFailed')
  } finally {
    if (generation === transferLoadGeneration) {
      transferDialogLoading.value = false
    }
  }
}

const handleTransferDialogOpenChange = (open: boolean) => {
  if (!open && transferDialogBusy.value) return
  transferDialogOpen.value = open
  if (open) return

  transferLoadGeneration += 1
  transferDialogLoading.value = false
  transferDialogError.value = null
  transferImpact.value = null
  pendingDeleteAgent.value = null
}

const confirmAndDeleteManualAgent = async (agent: AcpManualAgent) => {
  await openAgentTransferDialog({
    id: agent.id,
    name: agent.name,
    source: 'manual'
  })
}

const confirmRegistryAgentUninstall = async (agent: AcpRegistryAgent) => {
  await openAgentTransferDialog({
    id: agent.id,
    name: agent.name,
    source: 'registry'
  })
}

const finishDeleteAgent = async (agent: PendingDeleteAgent) => {
  if (agent.source === 'registry') {
    await configClient.uninstallAcpRegistryAgent(agent.id)
    invalidatePendingLoad()
    dirtyEnvDrafts.delete(agent.id)
    updateRegistryAgent(agent.id, (current) => ({
      ...current,
      enabled: false,
      envOverride: undefined,
      installState: {
        status: 'not_installed',
        version: current.version,
        distributionType: current.installState?.distributionType ?? null,
        lastCheckedAt: Date.now(),
        installedAt: null,
        installDir: null,
        error: null
      }
    }))
  } else {
    const removed = await configClient.removeManualAcpAgent(agent.id)
    if (!removed) {
      throw new Error(t('dialog.agentTransfer.agentDeleteBlocked'))
    }
    invalidatePendingLoad()
    manualAgents.value = manualAgents.value.filter((item) => item.id !== agent.id)
  }

  transferDialogOpen.value = false
  transferLoadGeneration += 1
  pendingDeleteAgent.value = null
}

const handleDeleteAgentWithMove = async (payload: { targetAgentId: string }) => {
  const agent = pendingDeleteAgent.value
  if (!agent) return
  if (
    !beginPageOperation({
      kind: 'delete-agent',
      agentId: agent.id
    })
  ) {
    return
  }
  transferDialogError.value = null
  try {
    const sessionClient = createSessionClient()
    await sessionClient.moveAgentSessions(agent.id, payload.targetAgentId)
    await finishDeleteAgent(agent)
    completePageOperation('settings.acp.agentDeleted')
  } catch (error) {
    console.error('[ACP] Failed to move conversations before deleting agent:', error)
    transferDialogError.value = t('common.error.operationFailed')
    failPageOperation('settings.acp.agentDeleteFailed', transferDialogError.value)
  }
}

const handleDeleteAgentWithSessions = async () => {
  const agent = pendingDeleteAgent.value
  if (!agent) return
  if (
    !beginPageOperation({
      kind: 'delete-agent',
      agentId: agent.id
    })
  ) {
    return
  }
  transferDialogError.value = null
  try {
    const sessionClient = createSessionClient()
    await sessionClient.deleteAgentSessions(agent.id)
    await finishDeleteAgent(agent)
    completePageOperation('settings.acp.agentDeleted')
  } catch (error) {
    console.error('[ACP] Failed to delete agent and its conversations:', error)
    transferDialogError.value = t('common.error.operationFailed')
    failPageOperation('settings.acp.agentDeleteFailed', transferDialogError.value)
  }
}

const openRegistryDialog = () => {
  registryDialog.open = true
}

const registryActionLabel = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return t('settings.acp.registryUninstallAction')
  if (status === 'installing') return t('settings.acp.installState.installing')
  if (status === 'error') return t('settings.acp.registryRepair')
  return t('settings.acp.registryInstallAction')
}

const registryActionVariant = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  return status === 'installed' ? 'destructive' : 'default'
}

const registryActionIcon = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  if (status === 'installed') return 'lucide:trash-2'
  if (status === 'error') return 'lucide:wrench'
  return 'lucide:download'
}

const registryActionSpins = (agent: AcpRegistryAgent) => {
  return (
    agent.installState?.status === 'installing' ||
    (pageMutationPending.value &&
      pageOperation.value?.kind === 'registry-install' &&
      pageOperation.value.agentId === agent.id)
  )
}

const isRegistryActionDisabled = (agent: AcpRegistryAgent) => {
  const status = agent.installState?.status ?? 'not_installed'
  return isAnyMutationPending.value || status === 'installing'
}

const handleRegistryCatalogAction = async (agent: AcpRegistryAgent) => {
  if (isRegistryActionDisabled(agent)) {
    return
  }
  if ((agent.installState?.status ?? 'not_installed') === 'installed') {
    await confirmRegistryAgentUninstall(agent)
    return
  }
  await installRegistryAgent(agent)
}

const discardAcpDrafts = () => {
  dirtyEnvDrafts.clear()
  syncEnvDrafts(registryAgents.value)
  manualDialogDirty.value = false
  manualDialog.open = false
  manualDialog.error = null
  sharedMcpSelectorRef.value?.discardRetryIntent()
  sharedMcpLeaveRisk.value = 'clean'
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'acp-settings',
  onDiscard: discardAcpDrafts
})
const stopLeaveRiskSync = watch(
  [isAnyMutationPending, hasUnsavedDrafts],
  ([busy, dirty]) => {
    leaveGuardLease.setRisk(busy ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let cleanupAgentsChanged: (() => void) | null = null

const scheduleAcpDataReload = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void loadAcpData()
  }, 80)
}

onMounted(() => {
  void loadAcpData()
  cleanupAgentsChanged = configClient.onAgentsChanged(scheduleAcpDataReload)
})

onBeforeUnmount(() => {
  invalidatePendingLoad()
  transferLoadGeneration += 1
  stopLeaveRiskSync()
  leaveGuardLease.release()
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  cleanupAgentsChanged?.()
  cleanupAgentsChanged = null
})
</script>
