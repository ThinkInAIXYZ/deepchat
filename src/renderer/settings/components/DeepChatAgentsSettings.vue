<template>
  <div class="flex h-full w-full">
    <aside class="flex w-[300px] shrink-0 flex-col border-r border-border">
      <div class="flex items-center justify-between gap-3 px-4 py-4">
        <div>
          <div class="text-lg font-semibold">{{ t('settings.deepchatAgents.title') }}</div>
          <div class="text-xs text-muted-foreground">
            {{ t('settings.deepchatAgents.description') }}
          </div>
        </div>
        <Button size="sm" @click="startCreate">{{ t('common.add') }}</Button>
      </div>

      <div class="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="w-full rounded-2xl border p-4 text-left transition-colors"
          :class="
            selectedAgentId === agent.id
              ? 'border-primary bg-accent/40'
              : 'border-border hover:bg-accent/20'
          "
          @click="selectAgent(agent.id)"
        >
          <div class="flex items-start gap-3">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40"
            >
              <AgentAvatar
                :agent="{
                  id: agent.id,
                  name: agent.name,
                  type: 'deepchat',
                  icon: agent.icon,
                  avatar: agent.avatar
                }"
                class-name="h-6 w-6"
                fallback-class-name="rounded-xl"
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <div class="truncate text-sm font-semibold">{{ agent.name }}</div>
                <Badge v-if="agent.protected" variant="secondary">
                  {{ t('settings.deepchatAgents.builtIn') }}
                </Badge>
              </div>
              <div class="mt-1 text-xs text-muted-foreground">
                {{ agent.enabled ? t('common.enabled') : t('common.disabled') }}
              </div>
            </div>
          </div>
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40"
            >
              <AgentAvatar
                :agent="previewAgent"
                class-name="h-8 w-8"
                fallback-class-name="rounded-xl"
              />
            </div>
            <div>
              <div class="text-xl font-semibold">
                {{
                  form.id
                    ? t('settings.deepchatAgents.editTitle')
                    : t('settings.deepchatAgents.createTitle')
                }}
              </div>
              <div class="text-sm text-muted-foreground">
                {{ form.name.trim() || t('settings.deepchatAgents.unnamed') }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button variant="outline" :disabled="saving" @click="resetEditor">
              {{ t('common.reset') }}
            </Button>
            <Button
              v-if="form.id && !form.protected"
              variant="destructive"
              :disabled="saving || deleting"
              @click="removeAgent"
            >
              {{ t('common.delete') }}
            </Button>
            <Button :disabled="saving || !form.name.trim()" @click="saveAgent">
              {{ saving ? t('common.saving') : t('common.save') }}
            </Button>
          </div>
        </div>

        <section class="grid gap-4 rounded-2xl border border-border p-5 md:grid-cols-2">
          <label class="space-y-2">
            <div class="text-sm font-medium">{{ t('settings.deepchatAgents.name') }}</div>
            <Input
              v-model="form.name"
              :placeholder="t('settings.deepchatAgents.namePlaceholder')"
            />
          </label>
          <label class="space-y-2">
            <div class="text-sm font-medium">{{ t('settings.deepchatAgents.enabledLabel') }}</div>
            <div
              class="flex h-10 items-center justify-between rounded-lg border border-border px-3"
            >
              <span class="text-sm text-muted-foreground">
                {{ form.enabled ? t('common.enabled') : t('common.disabled') }}
              </span>
              <Switch :model-value="form.enabled" @update:model-value="form.enabled = $event" />
            </div>
          </label>
          <label class="space-y-2 md:col-span-2">
            <div class="text-sm font-medium">
              {{ t('settings.deepchatAgents.descriptionLabel') }}
            </div>
            <Textarea
              v-model="form.description"
              class="min-h-[84px]"
              :placeholder="t('settings.deepchatAgents.descriptionPlaceholder')"
            />
          </label>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="text-sm font-semibold">{{ t('settings.deepchatAgents.avatarTitle') }}</div>
          <div class="grid gap-3 md:grid-cols-3">
            <button
              v-for="option in avatarKindOptions"
              :key="option.value"
              class="rounded-xl border px-4 py-3 text-left"
              :class="
                form.avatarKind === option.value
                  ? 'border-primary bg-accent/40'
                  : 'border-border hover:bg-accent/20'
              "
              @click="form.avatarKind = option.value"
            >
              <div class="text-sm font-medium">{{ option.label }}</div>
              <div class="mt-1 text-xs text-muted-foreground">{{ option.description }}</div>
            </button>
          </div>

          <div v-if="form.avatarKind === 'lucide'" class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2 md:col-span-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.lucideIcon') }}</div>
              <Input v-model="form.lucideIcon" placeholder="bot" />
            </label>
            <div class="flex flex-wrap gap-2 md:col-span-2">
              <Button
                v-for="iconName in lucideIcons"
                :key="iconName"
                size="sm"
                variant="outline"
                class="gap-2"
                @click="form.lucideIcon = iconName"
              >
                <Icon :icon="`lucide:${iconName}`" class="h-4 w-4" />
                <span>{{ iconName }}</span>
              </Button>
            </div>
            <label class="space-y-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.lightColor') }}</div>
              <div class="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <input v-model="form.lightColor" type="color" class="h-8 w-10 shrink-0" />
                <Input v-model="form.lightColor" />
              </div>
            </label>
            <label class="space-y-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.darkColor') }}</div>
              <div class="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <input v-model="form.darkColor" type="color" class="h-8 w-10 shrink-0" />
                <Input v-model="form.darkColor" />
              </div>
            </label>
          </div>

          <div v-else-if="form.avatarKind === 'monogram'" class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.monogramText') }}</div>
              <Input
                v-model="form.monogramText"
                :placeholder="t('settings.deepchatAgents.monogramPlaceholder')"
              />
            </label>
            <label class="space-y-2">
              <div class="text-sm font-medium">
                {{ t('settings.deepchatAgents.backgroundColor') }}
              </div>
              <div class="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <input
                  v-model="form.monogramBackgroundColor"
                  type="color"
                  class="h-8 w-10 shrink-0"
                />
                <Input v-model="form.monogramBackgroundColor" />
              </div>
            </label>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="text-sm font-semibold">{{ t('settings.deepchatAgents.modelsTitle') }}</div>
          <div class="grid gap-4 md:grid-cols-3">
            <div v-for="field in modelFields" :key="field.key" class="space-y-2">
              <div class="text-sm font-medium">{{ field.label }}</div>
              <div class="flex items-center gap-2">
                <Popover v-model:open="field.open.value">
                  <PopoverTrigger as-child>
                    <Button variant="outline" class="min-w-0 flex-1 justify-between">
                      <span class="truncate">{{ getModelLabel(field.key) }}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-[320px] p-0" align="start">
                    <ModelSelect
                      :exclude-providers="['acp']"
                      :vision-only="field.key === 'visionModel'"
                      @update:model="
                        (model, providerId) => selectModel(field.key, model, providerId)
                      "
                    />
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="sm" @click="clearModel(field.key)">
                  {{ t('common.clear') }}
                </Button>
              </div>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label v-for="field in numericFields" :key="field.key" class="space-y-2">
              <div class="text-sm font-medium">{{ field.label }}</div>
              <Input v-model="form[field.key]" type="number" :step="field.step" />
            </label>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label class="space-y-2">
              <div class="text-sm font-medium">
                {{ t('settings.deepchatAgents.reasoningEffort') }}
              </div>
              <Select v-model="form.reasoningEffort">
                <SelectTrigger><SelectValue :placeholder="t('common.clear')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{{ t('common.clear') }}</SelectItem>
                  <SelectItem value="minimal">minimal</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="space-y-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.verbosity') }}</div>
              <Select v-model="form.verbosity">
                <SelectTrigger><SelectValue :placeholder="t('common.clear')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{{ t('common.clear') }}</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div class="space-y-2">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.interleaved') }}</div>
              <div
                class="flex h-10 items-center justify-between rounded-lg border border-border px-3"
              >
                <span class="text-sm text-muted-foreground">
                  {{
                    form.forceInterleavedThinkingCompat ? t('common.enabled') : t('common.disabled')
                  }}
                </span>
                <Switch
                  :model-value="form.forceInterleavedThinkingCompat"
                  @update:model-value="form.forceInterleavedThinkingCompat = $event"
                />
              </div>
            </div>
          </div>

          <label class="space-y-2">
            <div class="text-sm font-medium">{{ t('settings.deepchatAgents.systemPrompt') }}</div>
            <Textarea
              v-model="form.systemPrompt"
              class="min-h-[140px] font-mono text-xs"
              :placeholder="t('settings.deepchatAgents.systemPromptPlaceholder')"
            />
          </label>

          <label class="space-y-2">
            <div class="text-sm font-medium">{{ t('settings.deepchatAgents.permissionMode') }}</div>
            <Select v-model="form.permissionMode">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_access">
                  {{ t('settings.deepchatAgents.permissionFullAccess') }}
                </SelectItem>
                <SelectItem value="default">
                  {{ t('settings.deepchatAgents.permissionDefault') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="text-sm font-semibold">{{ t('settings.deepchatAgents.toolsTitle') }}</div>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="tool in tools"
              :key="tool.function.name"
              class="rounded-xl border border-border px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">{{ tool.function.name }}</div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {{ tool.function.description || tool.server.name }}
                  </div>
                </div>
                <Switch
                  :model-value="isToolEnabled(tool.function.name)"
                  @update:model-value="setToolEnabled(tool.function.name, $event)"
                />
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="text-sm font-semibold">
            {{ t('settings.deepchatAgents.compactionTitle') }}
          </div>
          <div class="flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <div>
              <div class="text-sm font-medium">
                {{ t('settings.deepchatAgents.compactionEnabled') }}
              </div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.deepchatAgents.compactionDescription') }}
              </div>
            </div>
            <Switch
              :model-value="form.autoCompactionEnabled"
              @update:model-value="form.autoCompactionEnabled = $event"
            />
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <div class="text-sm font-medium">
                {{ t('settings.deepchatAgents.compactionThreshold') }}
              </div>
              <Input v-model="form.autoCompactionTriggerThreshold" type="number" min="5" max="95" />
            </label>
            <label class="space-y-2">
              <div class="text-sm font-medium">
                {{ t('settings.deepchatAgents.compactionRetainPairs') }}
              </div>
              <Input
                v-model="form.autoCompactionRetainRecentPairs"
                type="number"
                min="1"
                max="10"
              />
            </label>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Input } from '@shadcn/components/ui/input'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Switch } from '@shadcn/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import ModelSelect from '@/components/ModelSelect.vue'
import AgentAvatar from '@/components/icons/AgentAvatar.vue'
import { usePresenter } from '@/composables/usePresenter'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  Agent,
  AgentAvatar as AgentAvatarValue,
  PermissionMode,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { RENDERER_MODEL_META } from '@shared/presenter'

type ModelKey = 'chatModel' | 'assistantModel' | 'visionModel'
type AvatarKind = 'default' | 'lucide' | 'monogram'
type EditableModel = { providerId: string; modelId: string } | null
type FormState = {
  id: string | null
  protected: boolean
  name: string
  enabled: boolean
  description: string
  avatarKind: AvatarKind
  lucideIcon: string
  lightColor: string
  darkColor: string
  monogramText: string
  monogramBackgroundColor: string
  chatModel: EditableModel
  assistantModel: EditableModel
  visionModel: EditableModel
  systemPrompt: string
  permissionMode: PermissionMode
  disabledAgentTools: string[]
  autoCompactionEnabled: boolean
  autoCompactionTriggerThreshold: string
  autoCompactionRetainRecentPairs: string
  temperature: string
  contextLength: string
  maxTokens: string
  thinkingBudget: string
  reasoningEffort: SessionGenerationSettings['reasoningEffort'] | ''
  verbosity: SessionGenerationSettings['verbosity'] | ''
  forceInterleavedThinkingCompat: boolean
}

const LUCIDE_ICONS = ['bot', 'sparkles', 'brain', 'code', 'book-open', 'pen-tool', 'rocket']
const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const toolPresenter = usePresenter('toolPresenter')

const agents = ref<Agent[]>([])
const tools = ref<MCPToolDefinition[]>([])
const saving = ref(false)
const deleting = ref(false)
const selectedAgentId = ref<string | null>(null)
const chatOpen = ref(false)
const assistantOpen = ref(false)
const visionOpen = ref(false)

const form = reactive<FormState>({
  id: null,
  protected: false,
  name: '',
  enabled: true,
  description: '',
  avatarKind: 'default',
  lucideIcon: 'bot',
  lightColor: '#111827',
  darkColor: '#f8fafc',
  monogramText: '',
  monogramBackgroundColor: '#dbeafe',
  chatModel: null,
  assistantModel: null,
  visionModel: null,
  systemPrompt: '',
  permissionMode: 'full_access',
  disabledAgentTools: [],
  autoCompactionEnabled: true,
  autoCompactionTriggerThreshold: '80',
  autoCompactionRetainRecentPairs: '2',
  temperature: '',
  contextLength: '',
  maxTokens: '',
  thinkingBudget: '',
  reasoningEffort: '',
  verbosity: '',
  forceInterleavedThinkingCompat: false
})

const avatarKindOptions = computed(() => [
  {
    value: 'default' as const,
    label: t('settings.deepchatAgents.avatarDefault'),
    description: t('settings.deepchatAgents.avatarDefaultDesc')
  },
  {
    value: 'lucide' as const,
    label: t('settings.deepchatAgents.avatarLucide'),
    description: t('settings.deepchatAgents.avatarLucideDesc')
  },
  {
    value: 'monogram' as const,
    label: t('settings.deepchatAgents.avatarMonogram'),
    description: t('settings.deepchatAgents.avatarMonogramDesc')
  }
])
const lucideIcons = computed(() => LUCIDE_ICONS)
const modelFields = computed(() => [
  { key: 'chatModel' as const, label: t('settings.deepchatAgents.chatModel'), open: chatOpen },
  {
    key: 'assistantModel' as const,
    label: t('settings.deepchatAgents.assistantModel'),
    open: assistantOpen
  },
  { key: 'visionModel' as const, label: t('settings.deepchatAgents.visionModel'), open: visionOpen }
])
const numericFields = computed(() => [
  { key: 'temperature' as const, label: t('settings.deepchatAgents.temperature'), step: '0.1' },
  { key: 'contextLength' as const, label: t('settings.deepchatAgents.contextLength'), step: '1' },
  { key: 'maxTokens' as const, label: t('settings.deepchatAgents.maxTokens'), step: '1' },
  { key: 'thinkingBudget' as const, label: t('settings.deepchatAgents.thinkingBudget'), step: '1' }
])
const previewAgent = computed(() => ({
  id: form.id ?? 'preview',
  name: form.name || t('settings.deepchatAgents.unnamed'),
  type: 'deepchat' as const,
  icon: undefined,
  avatar: buildAvatar()
}))

const emptyForm = (): FormState => ({
  id: null,
  protected: false,
  name: '',
  enabled: true,
  description: '',
  avatarKind: 'default',
  lucideIcon: 'bot',
  lightColor: '#111827',
  darkColor: '#f8fafc',
  monogramText: '',
  monogramBackgroundColor: '#dbeafe',
  chatModel: null,
  assistantModel: null,
  visionModel: null,
  systemPrompt: '',
  permissionMode: 'full_access',
  disabledAgentTools: [],
  autoCompactionEnabled: true,
  autoCompactionTriggerThreshold: '80',
  autoCompactionRetainRecentPairs: '2',
  temperature: '',
  contextLength: '',
  maxTokens: '',
  thinkingBudget: '',
  reasoningEffort: '',
  verbosity: '',
  forceInterleavedThinkingCompat: false
})

const assignForm = (next: FormState) => Object.assign(form, next)
const parseNum = (value: string) => {
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}
const numText = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
const buildAvatar = (): AgentAvatarValue | null => {
  if (form.avatarKind === 'lucide' && form.lucideIcon.trim()) {
    return {
      kind: 'lucide',
      icon: form.lucideIcon.trim(),
      lightColor: form.lightColor || null,
      darkColor: form.darkColor || null
    }
  }
  if (form.avatarKind === 'monogram' && form.monogramText.trim()) {
    return {
      kind: 'monogram',
      text: form.monogramText.trim(),
      backgroundColor: form.monogramBackgroundColor || null
    }
  }
  return null
}
const fromAgent = (agent?: Agent | null): FormState => {
  if (!agent) return emptyForm()
  const config = agent.config ?? {}
  return {
    id: agent.id,
    protected: Boolean(agent.protected),
    name: agent.name,
    enabled: agent.enabled,
    description: agent.description ?? '',
    avatarKind: agent.avatar?.kind ?? 'default',
    lucideIcon: agent.avatar?.kind === 'lucide' ? agent.avatar.icon : 'bot',
    lightColor:
      agent.avatar?.kind === 'lucide' ? (agent.avatar.lightColor ?? '#111827') : '#111827',
    darkColor: agent.avatar?.kind === 'lucide' ? (agent.avatar.darkColor ?? '#f8fafc') : '#f8fafc',
    monogramText: agent.avatar?.kind === 'monogram' ? agent.avatar.text : '',
    monogramBackgroundColor:
      agent.avatar?.kind === 'monogram' ? (agent.avatar.backgroundColor ?? '#dbeafe') : '#dbeafe',
    chatModel: config.defaultModelPreset
      ? {
          providerId: config.defaultModelPreset.providerId,
          modelId: config.defaultModelPreset.modelId
        }
      : null,
    assistantModel: config.assistantModel
      ? { providerId: config.assistantModel.providerId, modelId: config.assistantModel.modelId }
      : null,
    visionModel: config.visionModel
      ? { providerId: config.visionModel.providerId, modelId: config.visionModel.modelId }
      : null,
    systemPrompt: config.systemPrompt ?? '',
    permissionMode: config.permissionMode === 'default' ? 'default' : 'full_access',
    disabledAgentTools: [...(config.disabledAgentTools ?? [])],
    autoCompactionEnabled: config.autoCompactionEnabled ?? true,
    autoCompactionTriggerThreshold: numText(config.autoCompactionTriggerThreshold ?? 80),
    autoCompactionRetainRecentPairs: numText(config.autoCompactionRetainRecentPairs ?? 2),
    temperature: numText(config.defaultModelPreset?.temperature),
    contextLength: numText(config.defaultModelPreset?.contextLength),
    maxTokens: numText(config.defaultModelPreset?.maxTokens),
    thinkingBudget: numText(config.defaultModelPreset?.thinkingBudget),
    reasoningEffort: config.defaultModelPreset?.reasoningEffort ?? '',
    verbosity: config.defaultModelPreset?.verbosity ?? '',
    forceInterleavedThinkingCompat:
      config.defaultModelPreset?.forceInterleavedThinkingCompat ?? false
  }
}
const modelText = (selection: EditableModel | undefined) =>
  selection?.providerId && selection?.modelId
    ? `${selection.providerId}/${selection.modelId}`
    : t('common.selectModel')
const getModelLabel = (key: ModelKey) => modelText(form[key])
const clearModel = (key: ModelKey) => {
  form[key] = null
}
const selectModel = (key: ModelKey, model: RENDERER_MODEL_META, providerId: string) => {
  form[key] = { providerId, modelId: model.id }
  if (key === 'chatModel') chatOpen.value = false
  if (key === 'assistantModel') assistantOpen.value = false
  if (key === 'visionModel') visionOpen.value = false
}
const isToolEnabled = (toolName: string) => !form.disabledAgentTools.includes(toolName)
const setToolEnabled = (toolName: string, enabled: boolean) => {
  const next = new Set(form.disabledAgentTools)
  if (enabled) next.delete(toolName)
  else next.add(toolName)
  form.disabledAgentTools = Array.from(next).sort((a, b) => a.localeCompare(b))
}
const loadTools = async () => {
  try {
    const definitions = await toolPresenter.getAllToolDefinitions({ chatMode: 'agent' })
    tools.value = Array.isArray(definitions)
      ? definitions
          .filter((tool) => tool.source === 'agent')
          .sort((a, b) => a.function.name.localeCompare(b.function.name))
      : []
  } catch {
    tools.value = []
  }
}
const loadAgents = async (preferredId?: string | null) => {
  const list = await configPresenter.listAgents()
  agents.value = list
    .filter((agent) => agent.type === 'deepchat')
    .sort((a, b) =>
      a.id === 'deepchat' ? -1 : b.id === 'deepchat' ? 1 : a.name.localeCompare(b.name)
    )
  const nextId =
    preferredId && agents.value.some((agent) => agent.id === preferredId)
      ? preferredId
      : (agents.value[0]?.id ?? null)
  selectedAgentId.value = nextId
  assignForm(fromAgent(agents.value.find((agent) => agent.id === nextId) ?? null))
}
const selectAgent = (agentId: string) => {
  selectedAgentId.value = agentId
  assignForm(fromAgent(agents.value.find((agent) => agent.id === agentId) ?? null))
}
const startCreate = () => {
  selectedAgentId.value = null
  assignForm(emptyForm())
}
const resetEditor = () => {
  if (!selectedAgentId.value) startCreate()
  else selectAgent(selectedAgentId.value)
}
const saveAgent = async () => {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      enabled: form.enabled,
      description: form.description.trim() || undefined,
      avatar: buildAvatar(),
      config: {
        defaultModelPreset: form.chatModel
          ? {
              providerId: form.chatModel.providerId,
              modelId: form.chatModel.modelId,
              temperature: parseNum(form.temperature),
              contextLength: parseNum(form.contextLength),
              maxTokens: parseNum(form.maxTokens),
              thinkingBudget: parseNum(form.thinkingBudget),
              reasoningEffort: form.reasoningEffort || undefined,
              verbosity: form.verbosity || undefined,
              forceInterleavedThinkingCompat: form.forceInterleavedThinkingCompat
            }
          : null,
        assistantModel: form.assistantModel,
        visionModel: form.visionModel,
        systemPrompt: form.systemPrompt,
        permissionMode: form.permissionMode,
        disabledAgentTools: [...form.disabledAgentTools],
        autoCompactionEnabled: form.autoCompactionEnabled,
        autoCompactionTriggerThreshold: parseNum(form.autoCompactionTriggerThreshold) ?? 80,
        autoCompactionRetainRecentPairs: parseNum(form.autoCompactionRetainRecentPairs) ?? 2
      }
    }
    if (form.id) {
      const updated = await configPresenter.updateDeepChatAgent(form.id, payload)
      await loadAgents(updated?.id ?? form.id)
    } else {
      const created = await configPresenter.createDeepChatAgent(payload)
      await loadAgents(created.id)
    }
  } finally {
    saving.value = false
  }
}
const removeAgent = async () => {
  if (!form.id || form.protected) return
  if (!window.confirm(t('settings.deepchatAgents.deleteConfirm', { name: form.name }))) return
  deleting.value = true
  try {
    await configPresenter.deleteDeepChatAgent(form.id)
    await loadAgents('deepchat')
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadTools(), loadAgents('deepchat')])
})
</script>
