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
      <Separator class="mt-3" />
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="acpEnabled" class="p-4 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-xl font-semibold">{{ t('settings.acp.title') }}</div>
            <p class="text-sm text-muted-foreground">
              {{ t('settings.acp.description') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="openEditAll">
              {{ t('settings.acp.editAll') }}
            </Button>
            <Button size="sm" @click="startCreate">
              {{ t('settings.acp.addAgent') }}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{{ t('settings.acp.quickAdd.title') }}</CardTitle>
                <CardDescription>{{ t('settings.acp.quickAdd.description') }}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent class="grid gap-3 md:grid-cols-3">
            <div
              v-for="builtin in builtinAgents"
              :key="builtin.id"
              class="border rounded-lg p-3 space-y-2"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <div class="text-sm font-semibold">{{ builtin.name }}</div>
                  <p class="text-xs text-muted-foreground">
                    {{ t(builtin.descriptionKey) }}
                  </p>
                </div>
                <Badge v-if="builtin.recommended" variant="secondary" class="text-[10px]">
                  {{ t('settings.acp.quickAdd.recommended') }}
                </Badge>
              </div>
              <div class="text-xs font-mono text-muted-foreground space-y-1">
                <div>
                  {{ t('settings.acp.quickAdd.command') }}:
                  <span class="font-semibold">{{ builtin.command }}</span>
                </div>
                <div>
                  {{ t('settings.acp.quickAdd.args') }}:
                  <span>{{ builtin.args?.length ? builtin.args.join(' ') : '-' }}</span>
                </div>
                <div>
                  {{ t('settings.acp.quickAdd.env') }}:
                  <span>
                    {{
                      builtin.env && Object.keys(builtin.env).length
                        ? Object.entries(builtin.env)
                            .map(([key, value]) => `${key}=${value || ''}`)
                            .join(', ')
                        : '-'
                    }}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                class="w-full"
                variant="outline"
                :disabled="saving"
                @click="handleQuickAdd(builtin)"
              >
                {{ t('settings.acp.quickAdd.add', { name: builtin.name }) }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div class="space-y-3">
          <div v-if="!agents.length" class="text-sm text-muted-foreground text-center py-6">
            {{ t('settings.acp.empty') }}
          </div>
          <div v-else class="grid gap-3 md:grid-cols-2">
            <Card v-for="agent in agents" :key="agent.id">
              <CardHeader class="pb-2">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle class="text-base">{{ agent.name }}</CardTitle>
                    <CardDescription class="text-xs break-words">
                      {{ agent.command }} {{ agent.args?.length ? agent.args.join(' ') : '' }}
                    </CardDescription>
                  </div>
                  <div class="flex items-center gap-2">
                    <Button variant="ghost" size="sm" @click="startEdit(agent)">
                      {{ t('settings.acp.editAgent') }}
                    </Button>
                    <Button variant="ghost" size="sm" @click="deleteAgent(agent)">
                      {{ t('common.delete') }}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent class="text-xs space-y-1 text-muted-foreground">
                <div>
                  <span class="font-semibold">{{ t('settings.acp.quickAdd.args') }}:</span>
                  <span class="ml-1">{{ agent.args?.length ? agent.args.join(' ') : '-' }}</span>
                </div>
                <div>
                  <span class="font-semibold">{{ t('settings.acp.env') }}:</span>
                  <span class="ml-1">
                    {{
                      agent.env && Object.keys(agent.env).length
                        ? Object.entries(agent.env)
                            .map(([key, value]) => `${key}=${value}`)
                            .join(', ')
                        : '-'
                    }}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div v-else class="p-8 text-center text-muted-foreground text-sm">
        {{ t('settings.acp.enableToAccess') }}
      </div>
    </div>

    <AcpAgentDialog
      v-model:open="agentDialogOpen"
      :agent="editingAgent"
      :saving="saving"
      @save="handleSaveAgent"
    />

    <Dialog v-model:open="editAllOpen">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ t('settings.acp.editAllTitle') }}</DialogTitle>
          <DialogDescription>{{ t('settings.acp.editAllDescription') }}</DialogDescription>
        </DialogHeader>

        <Textarea
          v-model="editAllJson"
          class="font-mono min-h-[320px]"
          :placeholder="t('settings.acp.editAllPlaceholder')"
        />

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="editAllOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="bulkSaving" @click="saveEditAll">
            {{ bulkSaving ? t('common.loading') : t('common.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AcpAgentConfig } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import AcpAgentDialog from './AcpAgentDialog.vue'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Textarea } from '@shadcn/components/ui/textarea'

const { t } = useI18n()
const { toast } = useToast()

const configPresenter = usePresenter('configPresenter')
const llmProviderPresenter = usePresenter('llmproviderPresenter')

const agents = ref<AcpAgentConfig[]>([])
const acpEnabled = ref(false)
const toggling = ref(false)
const loading = ref(false)
const saving = ref(false)
const bulkSaving = ref(false)
const agentDialogOpen = ref(false)
const editAllOpen = ref(false)
const editAllJson = ref('')
const editingAgent = ref<AcpAgentConfig | null>(null)

type BuiltinAgent = AcpAgentConfig & {
  descriptionKey: string
  recommended?: boolean
}

const builtinAgents: BuiltinAgent[] = [
  {
    id: 'kimi-cli',
    name: 'Kimi CLI',
    command: 'kimi',
    args: ['--acp'],
    env: {},
    descriptionKey: 'settings.acp.builtin.kimi.description',
    recommended: true
  },
  {
    id: 'claude-code-acp',
    name: 'Claude Code ACP',
    command: 'claude-code-acp',
    args: [],
    env: { ANTHROPIC_API_KEY: '' },
    descriptionKey: 'settings.acp.builtin.claudeCode.description'
  },
  {
    id: 'codex-acp',
    name: 'Codex CLI ACP',
    command: 'codex-acp',
    args: [],
    env: { OPENAI_API_KEY: '' },
    descriptionKey: 'settings.acp.builtin.codex.description'
  }
]

const loadAcpEnabled = async () => {
  try {
    acpEnabled.value = await configPresenter.getAcpEnabled()
  } catch (error) {
    console.error('Failed to load ACP enabled state:', error)
  }
}

const loadAgents = async () => {
  if (!acpEnabled.value) {
    agents.value = []
    return
  }
  if (loading.value) return
  loading.value = true
  try {
    agents.value = (await configPresenter.getAcpAgents()) ?? []
  } catch (error) {
    console.error('Failed to load ACP agents:', error)
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
      await llmProviderPresenter.refreshModels('acp')
      await loadAgents()
    } else {
      agents.value = []
    }
  } catch (error) {
    toast({
      title: t('settings.acp.saveFailed'),
      description: String(error),
      variant: 'destructive'
    })
    acpEnabled.value = !enabled
  } finally {
    toggling.value = false
  }
}

const startCreate = () => {
  editingAgent.value = null
  agentDialogOpen.value = true
}

const startEdit = (agent: AcpAgentConfig) => {
  editingAgent.value = agent
  agentDialogOpen.value = true
}

const handleSaveAgent = async (payload: Omit<AcpAgentConfig, 'id'> & { id?: string }) => {
  saving.value = true
  try {
    if (editingAgent.value) {
      await configPresenter.updateAcpAgent(editingAgent.value.id, payload)
    } else {
      await configPresenter.addAcpAgent(payload)
    }

    await llmProviderPresenter.refreshModels('acp')
    await loadAgents()
    agentDialogOpen.value = false
    editingAgent.value = null
    toast({ title: t('settings.acp.saveSuccess') })
  } catch (error) {
    console.error('Failed to save ACP agent:', error)
    toast({
      title: t('settings.acp.saveFailed'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    saving.value = false
  }
}

const handleQuickAdd = async (builtin: BuiltinAgent) => {
  if (agents.value.some((agent) => agent.id === builtin.id)) {
    toast({
      title: t('settings.acp.quickAdd.exists', { name: builtin.name })
    })
    return
  }

  const confirmed = window.confirm(t('settings.acp.quickAdd.confirm', { name: builtin.name }))
  if (!confirmed) return

  saving.value = true
  try {
    const payload: AcpAgentConfig = {
      id: builtin.id,
      name: builtin.name,
      command: builtin.command,
      args: builtin.args ? [...builtin.args] : undefined,
      env: builtin.env ? { ...builtin.env } : undefined
    }

    await configPresenter.addAcpAgent(payload)
    await llmProviderPresenter.refreshModels('acp')
    await loadAgents()
    toast({ title: t('settings.acp.saveSuccess') })
  } catch (error) {
    console.error('Failed to add built-in ACP agent:', error)
    toast({
      title: t('settings.acp.saveFailed'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    saving.value = false
  }
}

const deleteAgent = async (agent: AcpAgentConfig) => {
  const confirmed = window.confirm(t('settings.acp.deleteConfirm', { name: agent.name }))
  if (!confirmed) return

  try {
    await configPresenter.removeAcpAgent(agent.id)
    await llmProviderPresenter.refreshModels('acp')
    await loadAgents()
    toast({ title: t('settings.acp.deleteSuccess') })
  } catch (error) {
    console.error('Failed to delete ACP agent:', error)
    toast({
      title: t('settings.acp.saveFailed'),
      description: String(error),
      variant: 'destructive'
    })
  }
}

const openEditAll = () => {
  editAllJson.value = JSON.stringify({ agents: agents.value }, null, 2)
  editAllOpen.value = true
}

const saveEditAll = async () => {
  bulkSaving.value = true
  try {
    const parsed = JSON.parse(editAllJson.value)
    if (!parsed || !Array.isArray(parsed.agents)) {
      throw new Error(t('settings.acp.editAllInvalidJson'))
    }

    const sanitized = await configPresenter.setAcpAgents(parsed.agents as AcpAgentConfig[])
    await llmProviderPresenter.refreshModels('acp')
    agents.value = sanitized
    toast({ title: t('settings.acp.editAllSaveSuccess') })
    editAllOpen.value = false
  } catch (error) {
    console.error('Failed to save bulk ACP config:', error)
    toast({
      title: t('settings.acp.editAllSaveFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  } finally {
    bulkSaving.value = false
  }
}

onMounted(async () => {
  await loadAcpEnabled()
  await loadAgents()
})
</script>
