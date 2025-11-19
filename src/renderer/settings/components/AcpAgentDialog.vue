<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{ agent ? t('settings.acp.editAgent') : t('settings.acp.addAgent') }}
        </DialogTitle>
        <DialogDescription>
          {{ t('settings.acp.formHint') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
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
            <Button variant="ghost" size="sm" @click="addEnvRow">
              {{ t('settings.acp.addEnv') }}
            </Button>
          </div>
          <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
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
      </div>

      <DialogFooter class="mt-4">
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="saving" @click="handleSave">
          {{ saving ? t('common.loading') : t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import { nanoid } from 'nanoid'
import type { AcpAgentConfig } from '@shared/presenter'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Button } from '@shadcn/components/ui/button'

type EnvRow = { id: string; key: string; value: string }

const props = defineProps<{
  open: boolean
  agent?: AcpAgentConfig | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'save', payload: Omit<AcpAgentConfig, 'id'> & { id?: string }): void
}>()

const { t } = useI18n()
const { toast } = useToast()

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

const resetForm = () => {
  form.name = ''
  form.command = ''
  form.argsInput = ''
  form.envRows = []
}

const initForm = () => {
  if (!props.agent) {
    resetForm()
    addEnvRow()
    return
  }

  form.name = props.agent.name
  form.command = props.agent.command
  form.argsInput = (props.agent.args ?? []).join(' ')
  form.envRows =
    props.agent.env && Object.keys(props.agent.env).length
      ? Object.entries(props.agent.env).map(([key, value]) => ({
          id: nanoid(6),
          key,
          value
        }))
      : [{ id: nanoid(6), key: '', value: '' }]
}

watch(
  () => props.agent,
  () => {
    if (props.open) {
      initForm()
    }
  }
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      initForm()
    } else {
      resetForm()
    }
  }
)

const addEnvRow = () => {
  form.envRows.push({ id: nanoid(6), key: '', value: '' })
}

const removeEnvRow = (id: string) => {
  form.envRows = form.envRows.filter((row) => row.id !== id)
  if (!form.envRows.length) {
    addEnvRow()
  }
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

const handleSave = () => {
  if (!form.name.trim() || !form.command.trim()) {
    toast({
      title: t('settings.acp.missingFieldsTitle'),
      description: t('settings.acp.missingFieldsDesc'),
      variant: 'destructive'
    })
    return
  }

  emit('save', {
    id: props.agent?.id,
    name: form.name.trim(),
    command: form.command.trim(),
    args: parseArgs(form.argsInput),
    env: buildEnv()
  })
}
</script>
