<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === 'create' ? t('settings.agents.createTitle') : t('settings.agents.editTitle')
          }}
        </DialogTitle>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <Label for="agent-name">{{ t('settings.agents.name') }}</Label>
          <Input
            id="agent-name"
            v-model="name"
            :placeholder="t('settings.agents.namePlaceholder')"
            :disabled="saving"
          />
        </div>

        <div class="space-y-2">
          <Label>{{ t('settings.agents.icon') }}</Label>
          <div class="flex items-center gap-2">
            <div class="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/40">
              <Icon :icon="selectedIcon" class="h-4 w-4" />
            </div>
            <Input v-model="selectedIcon" :disabled="saving" class="flex-1" />
            <Button
              type="button"
              variant="outline"
              :disabled="saving"
              @click="showIconPicker = true"
            >
              {{ t('settings.agents.pickIcon') }}
            </Button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-2">
            <Label>{{ t('settings.agents.provider') }}</Label>
            <Select v-model="providerId" :disabled="saving || providers.length === 0">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.agents.providerPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="provider in providers" :key="provider.id" :value="provider.id">
                  {{ provider.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label>{{ t('settings.agents.model') }}</Label>
            <Select v-model="modelId" :disabled="saving || availableModels.length === 0">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.agents.modelPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="model in availableModels" :key="model.id" :value="model.id">
                  {{ model.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="space-y-2">
          <Label>{{ t('settings.agents.workdir') }}</Label>
          <div class="flex gap-2">
            <Input
              :model-value="workdirPath"
              :placeholder="t('settings.agents.workdirPlaceholder')"
              readonly
              class="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              :disabled="saving"
              @click="showWorkdirPicker = true"
            >
              {{ t('settings.agents.workdirBrowse') }}
            </Button>
            <Button
              type="button"
              variant="ghost"
              :disabled="saving || !workdirPath"
              @click="workdirPath = ''"
            >
              {{ t('settings.agents.workdirClear') }}
            </Button>
          </div>
        </div>

        <Collapsible v-model:open="advancedOpen">
          <CollapsibleTrigger as-child>
            <Button type="button" variant="ghost" class="h-8 px-2 text-xs">
              <Icon
                :icon="advancedOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'"
                class="mr-1 h-3.5 w-3.5"
              />
              {{ t('settings.agents.advancedSettings') }}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="space-y-4 rounded-lg border p-3">
            <div class="space-y-2">
              <Label>{{ t('settings.agents.systemPrompt') }}</Label>
              <Textarea
                v-model="systemPrompt"
                :placeholder="t('settings.agents.systemPromptPlaceholder')"
                :disabled="saving"
                class="min-h-[92px]"
              />
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Label>{{ t('settings.agents.temperature') }}</Label>
                <span class="text-xs text-muted-foreground">{{ temperature.toFixed(1) }}</span>
              </div>
              <Slider v-model="temperatureSlider" :min="0" :max="2" :step="0.1" />
            </div>

            <div class="space-y-2">
              <Label for="agent-max-tokens">{{ t('settings.agents.maxTokens') }}</Label>
              <Input
                id="agent-max-tokens"
                v-model.number="maxTokens"
                type="number"
                min="1"
                step="1"
                :disabled="saving"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <p v-if="formError" class="text-sm text-destructive">
          {{ formError }}
        </p>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          :disabled="saving"
          @click="emit('update:open', false)"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button type="button" :disabled="saving" @click="handleSubmit">
          {{ mode === 'create' ? t('settings.agents.create') : t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <WorkdirPicker
    :open="showWorkdirPicker"
    :selected-path="workdirPath"
    :recent-workdirs="recentWorkdirs"
    @update:open="(next) => (showWorkdirPicker = next)"
    @select="(path) => (workdirPath = path)"
  />

  <AgentIconPicker
    :open="showIconPicker"
    :selected-icon="selectedIcon"
    @update:open="(next) => (showIconPicker = next)"
    @select="handleIconSelect"
  />
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TemplateAgent } from '@shared/presenter'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Slider } from '@shadcn/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import WorkdirPicker from './WorkdirPicker.vue'
import AgentIconPicker from './AgentIconPicker.vue'

export interface AgentEditorSubmitPayload {
  name: string
  icon?: string
  providerId: string
  modelId: string
  workdir: string | null
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

type ProviderOption = {
  id: string
  name: string
}

type ModelOption = {
  id: string
  name: string
}

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  saving: boolean
  agent: TemplateAgent | null
  initialWorkdir: string
  providers: ProviderOption[]
  modelsByProvider: Record<string, ModelOption[]>
  recentWorkdirs: string[]
}>()

const { open, mode, saving, recentWorkdirs } = toRefs(props)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', payload: AgentEditorSubmitPayload): void
}>()

const { t } = useI18n()

const name = ref('')
const selectedIcon = ref('lucide:bot')
const providerId = ref('')
const modelId = ref('')
const workdirPath = ref('')
const systemPrompt = ref('')
const temperature = ref(0.7)
const maxTokens = ref(4096)
const advancedOpen = ref(false)
const showWorkdirPicker = ref(false)
const showIconPicker = ref(false)
const formError = ref('')

const providers = computed(() => props.providers)

const availableModels = computed(() => {
  if (!providerId.value) return []
  return props.modelsByProvider[providerId.value] ?? []
})

const temperatureSlider = computed({
  get: () => [temperature.value],
  set: (value: number[]) => {
    const next = Number(value?.[0] ?? 0.7)
    temperature.value = Number.isFinite(next) ? Number(next.toFixed(1)) : 0.7
  }
})

const hydrateFromProps = () => {
  const agent = props.agent
  if (agent) {
    name.value = agent.name
    selectedIcon.value = agent.icon || 'lucide:bot'
    providerId.value = agent.providerId
    modelId.value = agent.modelId
    workdirPath.value = props.initialWorkdir
    systemPrompt.value = agent.systemPrompt || ''
    temperature.value = Number(agent.temperature ?? 0.7)
    maxTokens.value = Number(agent.maxTokens ?? 4096)
    advancedOpen.value =
      Boolean(agent.systemPrompt?.trim()) ||
      agent.temperature !== undefined ||
      agent.maxTokens !== undefined
  } else {
    const fallbackProvider = props.providers[0]
    const fallbackModels = fallbackProvider ? props.modelsByProvider[fallbackProvider.id] || [] : []
    const fallbackModel = fallbackModels[0]

    name.value = ''
    selectedIcon.value = 'lucide:bot'
    providerId.value = fallbackProvider?.id || ''
    modelId.value = fallbackModel?.id || ''
    workdirPath.value = props.initialWorkdir
    systemPrompt.value = ''
    temperature.value = 0.7
    maxTokens.value = 4096
    advancedOpen.value = false
  }

  formError.value = ''
}

watch(
  () => props.open,
  (next) => {
    if (next) {
      hydrateFromProps()
    }
  }
)

watch(
  () => [providerId.value, props.modelsByProvider],
  () => {
    const models = availableModels.value
    if (models.length === 0) {
      modelId.value = ''
      return
    }

    if (!models.some((model) => model.id === modelId.value)) {
      modelId.value = models[0].id
    }
  },
  { deep: true }
)

const handleIconSelect = (iconName: string) => {
  selectedIcon.value = iconName
  showIconPicker.value = false
}

const handleSubmit = () => {
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    formError.value = t('settings.agents.validation.nameRequired')
    return
  }

  if (!providerId.value) {
    formError.value = t('settings.agents.validation.providerRequired')
    return
  }

  if (!modelId.value) {
    formError.value = t('settings.agents.validation.modelRequired')
    return
  }

  const nextWorkdir = workdirPath.value.trim()

  emit('submit', {
    name: trimmedName,
    icon: selectedIcon.value.trim() || undefined,
    providerId: providerId.value,
    modelId: modelId.value,
    workdir: nextWorkdir || null,
    systemPrompt: systemPrompt.value.trim(),
    temperature: Number.isFinite(temperature.value) ? temperature.value : undefined,
    maxTokens: Number.isFinite(maxTokens.value) && maxTokens.value > 0 ? maxTokens.value : undefined
  })
}
</script>
