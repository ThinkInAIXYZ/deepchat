<template>
  <div class="p-6 space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <div class="text-xl font-semibold">{{ t('settings.acp.title') }}</div>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.acp.description') }}
        </p>
      </div>
      <Button size="sm" @click="startCreate">
        {{ t('settings.acp.addAgent') }}
      </Button>
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
          <Button size="sm" class="w-full" variant="outline" @click="handleQuickAdd(builtin)">
            {{ t('settings.acp.quickAdd.add', { name: builtin.name }) }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="formVisible">
      <CardHeader>
        <CardTitle>
          {{ editingId ? t('settings.acp.editAgent') : t('settings.acp.addAgent') }}
        </CardTitle>
        <CardDescription>{{ t('settings.acp.formHint') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label>{{ t('settings.acp.name') }}</Label>
          <Input v-model="form.name" :placeholder="t('settings.acp.namePlaceholder')" />
        </div>
        <div class="space-y-2">
          <Label>{{ t('settings.acp.command') }}</Label>
          <Input v-model="form.command" :placeholder="t('settings.acp.commandPlaceholder')" />
        </div>
        <div class="space-y-2">
          <Label>{{ t('settings.acp.args') }}</Label>
          <Input v-model="form.argsInput" :placeholder="t('settings.acp.argsPlaceholder')" />
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>{{ t('settings.acp.env') }}</Label>
            <Button variant="ghost" size="xs" @click="addEnvRow">
              {{ t('settings.acp.addEnv') }}
            </Button>
          </div>
          <div class="space-y-2">
            <div
              v-for="row in form.envRows"
              :key="row.id"
              class="grid grid-cols-12 gap-2 items-center"
            >
              <Input
                v-model="row.key"
                class="col-span-5"
                :placeholder="t('settings.acp.envKeyPlaceholder')"
              />
              <Input
                v-model="row.value"
                class="col-span-6"
                :placeholder="t('settings.acp.envValuePlaceholder')"
              />
              <Button variant="ghost" size="icon" class="col-span-1" @click="removeEnvRow(row.id)">
                ✕
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter class="justify-end gap-2">
        <Button variant="outline" @click="cancelEdit">{{ t('common.cancel') }}</Button>
        <Button @click="saveAgent" :disabled="saving">
          {{ saving ? t('common.loading') : t('common.save') }}
        </Button>
      </CardFooter>
    </Card>

    <div class="space-y-3">
      <Card v-for="agent in agents" :key="agent.id">
        <CardHeader class="pb-2">
          <div class="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{{ agent.name }}</CardTitle>
              <CardDescription class="font-mono text-xs break-all">
                {{ agent.command }}
                <span v-if="agent.args?.length"> {{ agent.args.join(' ') }}</span>
              </CardDescription>
            </div>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" @click="startEdit(agent)">
                {{ t('common.edit') }}
              </Button>
              <Button variant="destructive" size="sm" @click="deleteAgent(agent)">
                {{ t('common.delete') }}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-2">
          <div v-if="agent.args?.length" class="flex flex-wrap gap-2">
            <Badge v-for="arg in agent.args" :key="arg" variant="secondary" class="font-mono">
              {{ arg }}
            </Badge>
          </div>
          <div v-if="agent.env && Object.keys(agent.env).length" class="flex flex-wrap gap-2">
            <Badge v-for="(value, key) in agent.env" :key="key" variant="outline" class="font-mono">
              {{ key }}={{ value }}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div
        v-if="!agents.length"
        class="border rounded-lg px-4 py-6 text-sm text-muted-foreground text-center"
      >
        {{ t('settings.acp.empty') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import { Badge } from '@shadcn/components/ui/badge'
import { useToast } from '@/components/use-toast'
import type { AcpAgentConfig } from '@shared/presenter'

const { t } = useI18n()
const { toast } = useToast()

const configPresenter = usePresenter('configPresenter')
const llmProviderPresenter = usePresenter('llmproviderPresenter')

const agents = ref<AcpAgentConfig[]>([])
const loading = ref(false)
const saving = ref(false)
const formVisible = ref(false)
const editingId = ref<string | null>(null)

type EnvRow = { id: string; key: string; value: string }
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

const form = reactive<{
  name: string
  command: string
  argsInput: string
  envRows: EnvRow[]
}>({
  name: '',
  command: '',
  argsInput: '',
  envRows: []
})

const hasRequiredFields = computed(
  () => form.name.trim().length > 0 && form.command.trim().length > 0
)

const resetForm = () => {
  form.name = ''
  form.command = ''
  form.argsInput = ''
  form.envRows = []
  editingId.value = null
}

const loadAgents = async () => {
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

const addEnvRow = () => {
  form.envRows.push({ id: nanoid(6), key: '', value: '' })
}

const removeEnvRow = (id: string) => {
  form.envRows = form.envRows.filter((row) => row.id !== id)
}

const startCreate = () => {
  resetForm()
  formVisible.value = true
  addEnvRow()
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

const startEdit = (agent: AcpAgentConfig) => {
  editingId.value = agent.id
  formVisible.value = true
  form.name = agent.name
  form.command = agent.command
  form.argsInput = (agent.args ?? []).join(' ')
  form.envRows =
    agent.env && Object.keys(agent.env).length
      ? Object.entries(agent.env).map(([key, value]) => ({
          id: nanoid(6),
          key,
          value
        }))
      : [{ id: nanoid(6), key: '', value: '' }]
}

const cancelEdit = () => {
  formVisible.value = false
  resetForm()
}

const parseArgs = (input: string): string[] => {
  const matches = input.match(/"[^"]*"|\S+/g) || []
  return matches.map((arg) => arg.replace(/^"(.*)"$/, '$1')).filter((arg) => arg.trim().length > 0)
}

const buildEnv = (): Record<string, string> => {
  const env: Record<string, string> = {}
  form.envRows.forEach((row) => {
    if (row.key.trim()) {
      env[row.key.trim()] = row.value
    }
  })
  return env
}

const saveAgent = async () => {
  if (!hasRequiredFields.value) {
    toast({
      title: t('settings.acp.missingFieldsTitle'),
      description: t('settings.acp.missingFieldsDesc'),
      variant: 'destructive'
    })
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      command: form.command.trim(),
      args: parseArgs(form.argsInput),
      env: buildEnv()
    }

    if (editingId.value) {
      await configPresenter.updateAcpAgent(editingId.value, payload)
    } else {
      await configPresenter.addAcpAgent(payload)
    }

    await llmProviderPresenter.refreshModels('acp')
    await loadAgents()

    toast({ title: t('settings.acp.saveSuccess') })
    cancelEdit()
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

loadAgents()
</script>
