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
          v-for="agent in sidebarAgents"
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
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div v-for="field in modelFields" :key="field.key" class="space-y-1.5">
              <div class="text-[11px] font-medium text-muted-foreground">{{ field.label }}</div>
              <Popover v-model:open="field.open.value">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs"
                  >
                    <div class="flex min-w-0 items-center gap-1.5">
                      <ModelIcon
                        v-if="getModelIconId(field.key)"
                        :model-id="getModelIconId(field.key)"
                        custom-class="h-3.5 w-3.5 shrink-0"
                      />
                      <Icon
                        v-else
                        icon="lucide:box"
                        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      <span class="truncate">{{ getModelLabel(field.key) }}</span>
                    </div>
                    <Icon
                      icon="lucide:chevron-down"
                      class="h-3 w-3 shrink-0 text-muted-foreground"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-[320px] p-0" align="start">
                  <div class="flex items-center justify-between border-b px-3 py-2">
                    <div class="text-sm font-medium">{{ field.label }}</div>
                    <Button
                      v-if="form[field.key]"
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      @click="clearModel(field.key)"
                    >
                      {{ t('common.clear') }}
                    </Button>
                  </div>
                  <ModelSelect
                    :exclude-providers="['acp']"
                    :vision-only="field.key === 'visionModel'"
                    @update:model="(model, providerId) => selectModel(field.key, model, providerId)"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div class="space-y-1.5">
              <div class="text-[11px] font-medium text-muted-foreground">
                {{ t('settings.deepchatAgents.defaultProjectPath') }}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs"
                    :title="defaultProjectPathTitle"
                  >
                    <div class="flex min-w-0 items-center gap-1.5">
                      <Icon
                        icon="lucide:folder"
                        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      <span class="truncate">{{ defaultProjectPathLabel }}</span>
                    </div>
                    <Icon
                      icon="lucide:chevron-down"
                      class="h-3 w-3 shrink-0 text-muted-foreground"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="w-[20rem]">
                  <DropdownMenuItem
                    v-for="project in directoryOptions"
                    :key="project.path"
                    class="gap-2 px-2 py-1.5 text-xs"
                    @select="selectDefaultProjectPath(project.path)"
                  >
                    <Icon icon="lucide:folder" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate">{{ project.name }}</div>
                      <div class="truncate text-[10px] text-muted-foreground">
                        {{ project.path }}
                      </div>
                    </div>
                    <Icon
                      v-if="normalizePath(form.defaultProjectPath) === project.path"
                      icon="lucide:check"
                      class="h-3.5 w-3.5 shrink-0"
                    />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="gap-2 px-2 py-1.5 text-xs"
                    @select="pickDefaultProjectPath"
                  >
                    <Icon
                      icon="lucide:folder-open"
                      class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                    <span>{{ t('common.project.openFolder') }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="form.defaultProjectPath"
                    class="gap-2 px-2 py-1.5 text-xs"
                    @select="clearDefaultProjectPath"
                  >
                    <Icon icon="lucide:x" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{{ t('common.clear') }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div class="space-y-1.5">
              <div class="text-[11px] font-medium text-muted-foreground">
                {{ t('settings.deepchatAgents.permissionMode') }}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    :class="[
                      'h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg px-2.5 text-xs',
                      form.permissionMode === 'full_access'
                        ? 'text-orange-500 hover:text-orange-600'
                        : 'text-muted-foreground hover:text-foreground'
                    ]"
                  >
                    <div class="flex min-w-0 items-center gap-1.5">
                      <Icon :icon="permissionIcon" class="h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{{ permissionModeLabel }}</span>
                    </div>
                    <Icon
                      icon="lucide:chevron-down"
                      class="h-3 w-3 shrink-0 text-muted-foreground"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="min-w-48">
                  <DropdownMenuItem
                    v-for="option in permissionOptions"
                    :key="option.value"
                    class="gap-2 px-2 py-1.5 text-xs"
                    @select="form.permissionMode = option.value"
                  >
                    <Icon :icon="option.icon" :class="['h-3.5 w-3.5 shrink-0', option.iconClass]" />
                    <span class="flex-1">{{ option.label }}</span>
                    <Icon
                      v-if="form.permissionMode === option.value"
                      icon="lucide:check"
                      class="h-3.5 w-3.5 shrink-0"
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium">{{ t('settings.deepchatAgents.systemPrompt') }}</div>
              <Button variant="outline" size="sm" class="gap-2" @click="openSystemPromptPicker">
                <Icon icon="lucide:library-big" class="h-4 w-4" />
                <span>{{ t('promptSetting.selectSystemPrompt') }}</span>
              </Button>
            </div>
            <Textarea
              v-model="form.systemPrompt"
              class="min-h-[140px] font-mono text-xs"
              :placeholder="t('settings.deepchatAgents.systemPromptPlaceholder')"
            />
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold">
                {{ t('settings.deepchatAgents.subagentsTitle') }}
              </div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.deepchatAgents.subagentsDescription') }}
              </div>
            </div>
            <Switch
              :model-value="form.subagentEnabled"
              :aria-label="t('settings.deepchatAgents.subagentsEnabled')"
              @update:model-value="form.subagentEnabled = $event"
            />
          </div>

          <div class="space-y-3">
            <div
              v-for="(slot, index) in form.subagents"
              :key="slot.id"
              class="rounded-xl border border-border p-4"
            >
              <div class="flex items-center justify-between gap-3">
                <div
                  class="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {{ slot.id }}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="removeSubagentSlot(index)"
                >
                  {{ t('common.delete') }}
                </Button>
              </div>

              <div class="mt-4 grid gap-4 md:grid-cols-2">
                <label class="space-y-2">
                  <div class="text-sm font-medium">
                    {{ t('settings.deepchatAgents.subagentTargetAgentLabel') }}
                  </div>
                  <select
                    :value="getSubagentTargetValue(slot)"
                    class="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    @change="handleSubagentTargetChange(slot, $event)"
                  >
                    <option
                      v-for="agentOption in subagentTargetOptions"
                      :key="agentOption.value"
                      :value="agentOption.value"
                    >
                      {{ agentOption.label }}
                    </option>
                  </select>
                </label>

                <label class="space-y-2">
                  <div class="text-sm font-medium">
                    {{ t('settings.deepchatAgents.subagentDisplayName') }}
                  </div>
                  <Input v-model="slot.displayName" />
                </label>

                <label class="space-y-2 md:col-span-2">
                  <div class="text-sm font-medium">
                    {{ t('settings.deepchatAgents.subagentDescription') }}
                  </div>
                  <Textarea v-model="slot.description" class="min-h-[72px]" />
                </label>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {{
                  t('settings.deepchatAgents.subagentLimit', {
                    count: form.subagents.length,
                    max: subagentSlotLimit
                  })
                }}
              </span>
              <Button
                size="sm"
                variant="outline"
                :disabled="form.subagents.length >= subagentSlotLimit"
                @click="addSubagentSlot"
              >
                {{ t('settings.deepchatAgents.addSubagentSlot') }}
              </Button>
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="text-sm font-semibold">{{ t('settings.deepchatAgents.toolsTitle') }}</div>
          <div
            v-if="groupedTools.length === 0"
            class="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
          >
            {{ t('chat.input.tools.builtinEmpty') }}
          </div>

          <div v-else class="space-y-4">
            <div v-for="group in groupedTools" :key="group.name" class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {{ group.label }}
                </div>
                <Switch
                  :model-value="isGroupEnabled(group)"
                  :aria-label="group.label"
                  @update:model-value="(value) => setGroupEnabled(group, value)"
                />
              </div>

              <div class="flex flex-wrap gap-2">
                <Button
                  v-for="tool in group.tools"
                  :key="tool.function.name"
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-10 rounded-xl px-4 text-sm shadow-none transition-colors"
                  :class="
                    isToolEnabled(tool.function.name)
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted'
                  "
                  @click="toggleTool(tool.function.name)"
                >
                  {{ tool.function.name }}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-2xl border border-border p-5">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-semibold">
              {{ t('settings.deepchatAgents.compactionTitle') }}
            </div>
            <Switch
              :model-value="form.autoCompactionEnabled"
              :aria-label="t('settings.deepchatAgents.compactionEnabled')"
              @update:model-value="form.autoCompactionEnabled = $event"
            />
          </div>

          <div v-if="form.autoCompactionEnabled" class="grid gap-4 md:grid-cols-2">
            <label class="space-y-2">
              <div class="text-sm font-medium">
                {{ `${t('settings.deepchatAgents.compactionThreshold')} (%)` }}
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

    <Dialog
      :open="systemPromptDialogOpen"
      @update:open="(value) => (systemPromptDialogOpen = value)"
    >
      <DialogContent class="sm:max-w-[640px]">
        <DialogHeader class="text-left">
          <DialogTitle>{{ t('promptSetting.selectSystemPrompt') }}</DialogTitle>
        </DialogHeader>

        <div v-if="loadingSystemPrompts" class="py-8 text-center text-sm text-muted-foreground">
          {{ t('common.loading') }}
        </div>

        <div v-else class="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          <button
            v-for="prompt in systemPromptTemplates"
            :key="prompt.id"
            type="button"
            class="w-full rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-accent/20"
            @click="applySystemPromptTemplate(prompt)"
          >
            <div class="text-sm font-medium">{{ prompt.name }}</div>
            <div
              class="mt-1 max-h-14 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground"
            >
              {{ prompt.content }}
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Input } from '@shadcn/components/ui/input'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Switch } from '@shadcn/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import ModelSelect from '@/components/ModelSelect.vue'
import AgentAvatar from '@/components/icons/AgentAvatar.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { useModelStore } from '@/stores/modelStore'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  Agent,
  AgentAvatar as AgentAvatarValue,
  DeepChatSubagentSlot,
  PermissionMode,
  Project
} from '@shared/types/agent-interface'
import type { RENDERER_MODEL_META, SystemPrompt } from '@shared/presenter'
import {
  DEEPCHAT_SUBAGENT_SLOT_LIMIT,
  createDefaultDeepChatSelfSubagentSlot,
  normalizeDeepChatSubagentSlots
} from '@shared/lib/deepchatSubagents'

type ModelKey = 'chatModel' | 'assistantModel' | 'visionModel'
type AvatarKind = 'default' | 'lucide' | 'monogram'
type EditableModel = { providerId: string; modelId: string } | null
type SidebarAgentItem = {
  id: string
  name: string
  enabled: boolean
  protected: boolean
  avatar: AgentAvatarValue | null
  icon?: string
}
type SelectOption = {
  value: string
  label: string
}
type EditableSubagentSlot = DeepChatSubagentSlot
type ToolGroup = {
  name: string
  label: string
  tools: MCPToolDefinition[]
}
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
  defaultProjectPath: string
  systemPrompt: string
  permissionMode: PermissionMode
  subagentEnabled: boolean
  subagents: EditableSubagentSlot[]
  disabledAgentTools: string[]
  autoCompactionEnabled: boolean
  autoCompactionTriggerThreshold: string
  autoCompactionRetainRecentPairs: string
}

const LUCIDE_ICONS = ['bot', 'sparkles', 'brain', 'code', 'book-open', 'pen-tool', 'rocket']
const DRAFT_AGENT_ID = '__draft_deepchat_agent__'
const CURRENT_SUBAGENT_TARGET = '__current_agent__'
const GROUP_ORDER = [
  'agent-filesystem',
  'agent-core',
  'agent-skills',
  'deepchat-settings',
  'yobrowser'
]
const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const projectPresenter = usePresenter('projectPresenter', { safeCall: false })
const toolPresenter = usePresenter('toolPresenter')
const modelStore = useModelStore()
const subagentSlotLimit = DEEPCHAT_SUBAGENT_SLOT_LIMIT

const allAgents = ref<Agent[]>([])
const tools = ref<MCPToolDefinition[]>([])
const recentProjects = ref<Project[]>([])
const saving = ref(false)
const deleting = ref(false)
const selectedAgentId = ref<string | null>(null)
const chatOpen = ref(false)
const assistantOpen = ref(false)
const visionOpen = ref(false)
const systemPromptDialogOpen = ref(false)
const loadingSystemPrompts = ref(false)
const systemPromptTemplates = ref<SystemPrompt[]>([])

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
  defaultProjectPath: '',
  systemPrompt: '',
  permissionMode: 'full_access',
  subagentEnabled: false,
  subagents: normalizeDeepChatSubagentSlots([createDefaultDeepChatSelfSubagentSlot()]),
  disabledAgentTools: [],
  autoCompactionEnabled: true,
  autoCompactionTriggerThreshold: '80',
  autoCompactionRetainRecentPairs: '2'
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
const permissionOptions = computed(() => [
  {
    value: 'default' as const,
    label: t('settings.deepchatAgents.permissionDefault'),
    icon: 'lucide:shield',
    iconClass: 'text-muted-foreground'
  },
  {
    value: 'full_access' as const,
    label: t('settings.deepchatAgents.permissionFullAccess'),
    icon: 'lucide:shield-alert',
    iconClass: 'text-orange-500'
  }
])
const permissionModeLabel = computed(
  () => permissionOptions.value.find((option) => option.value === form.permissionMode)?.label ?? ''
)
const permissionIcon = computed(
  () =>
    permissionOptions.value.find((option) => option.value === form.permissionMode)?.icon ??
    'lucide:shield'
)
const pathLabel = (value: string) => value.split(/[/\\]/).pop() ?? value
const directoryOptions = computed(() => {
  const normalizedCurrentPath = normalizePath(form.defaultProjectPath)
  const options = new Map<string, { path: string; name: string }>()

  if (normalizedCurrentPath) {
    options.set(normalizedCurrentPath, {
      path: normalizedCurrentPath,
      name: pathLabel(normalizedCurrentPath)
    })
  }

  for (const project of recentProjects.value) {
    const normalizedPath = normalizePath(project.path)
    if (!normalizedPath || options.has(normalizedPath)) {
      continue
    }

    options.set(normalizedPath, {
      path: normalizedPath,
      name: project.name || pathLabel(normalizedPath)
    })
  }

  return Array.from(options.values())
})
const defaultProjectPathLabel = computed(() => {
  const normalized = normalizePath(form.defaultProjectPath)
  return normalized
    ? pathLabel(normalized)
    : t('settings.deepchatAgents.defaultProjectPathPlaceholder')
})
const defaultProjectPathTitle = computed(
  () =>
    normalizePath(form.defaultProjectPath) ??
    t('settings.deepchatAgents.defaultProjectPathPlaceholder')
)
const getGroupLabel = (serverName: string) => {
  switch (serverName) {
    case 'agent-filesystem':
      return t('chat.input.tools.groups.agentFilesystem')
    case 'agent-core':
      return t('chat.input.tools.groups.agentCore')
    case 'agent-skills':
      return t('chat.input.tools.groups.agentSkills')
    case 'deepchat-settings':
      return t('chat.input.tools.groups.deepchatSettings')
    case 'yobrowser':
      return t('chat.input.tools.groups.yobrowser')
    default:
      return serverName
  }
}
const groupedTools = computed<ToolGroup[]>(() => {
  const groups = new Map<string, MCPToolDefinition[]>()

  for (const tool of tools.value) {
    const existing = groups.get(tool.server.name) ?? []
    existing.push(tool)
    groups.set(tool.server.name, existing)
  }

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      label: getGroupLabel(name),
      tools: [...items].sort((left, right) => left.function.name.localeCompare(right.function.name))
    }))
    .sort((left, right) => {
      const leftIndex = GROUP_ORDER.indexOf(left.name)
      const rightIndex = GROUP_ORDER.indexOf(right.name)

      if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex
      }
      if (leftIndex >= 0) {
        return -1
      }
      if (rightIndex >= 0) {
        return 1
      }
      return left.name.localeCompare(right.name)
    })
})
const deepchatAgents = computed(() =>
  allAgents.value
    .filter((agent) => agent.type === 'deepchat')
    .sort((a, b) =>
      a.id === 'deepchat' ? -1 : b.id === 'deepchat' ? 1 : a.name.localeCompare(b.name)
    )
)
const isAvailableSubagentTargetAgent = (agent: Agent) => {
  if (agent.type === 'deepchat') {
    return true
  }

  if (agent.type !== 'acp') {
    return false
  }

  return agent.source !== 'registry' || agent.installState?.status === 'installed'
}
const availableSubagentTargetAgents = computed(() =>
  allAgents.value.filter(isAvailableSubagentTargetAgent).sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'deepchat' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
)
const subagentTargetOptions = computed<SelectOption[]>(() => [
  {
    value: CURRENT_SUBAGENT_TARGET,
    label: t('settings.deepchatAgents.subagentTargetSelf')
  },
  ...availableSubagentTargetAgents.value.map((agent) => ({
    value: agent.id,
    label: agent.name
  }))
])
const draftSidebarAgent = computed<SidebarAgentItem>(() => ({
  id: DRAFT_AGENT_ID,
  name: form.name.trim() || t('settings.deepchatAgents.unnamed'),
  enabled: form.enabled,
  protected: false,
  avatar: buildAvatar()
}))
const sidebarAgents = computed<SidebarAgentItem[]>(() => {
  const savedAgents = deepchatAgents.value.map((agent) => ({
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    protected: Boolean(agent.protected),
    avatar: agent.avatar ?? null,
    icon: agent.icon
  }))

  if (selectedAgentId.value !== DRAFT_AGENT_ID) {
    return savedAgents
  }

  if (savedAgents[0]?.id === 'deepchat') {
    return [savedAgents[0], draftSidebarAgent.value, ...savedAgents.slice(1)]
  }

  return [draftSidebarAgent.value, ...savedAgents]
})
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
  defaultProjectPath: '',
  systemPrompt: '',
  permissionMode: 'full_access',
  subagentEnabled: false,
  subagents: normalizeDeepChatSubagentSlots([createDefaultDeepChatSelfSubagentSlot()]),
  disabledAgentTools: [],
  autoCompactionEnabled: true,
  autoCompactionTriggerThreshold: '80',
  autoCompactionRetainRecentPairs: '2'
})

const assignForm = (next: FormState) => Object.assign(form, next)
const normalizePath = (value: string | null | undefined) => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
const parseNum = (value: string) => {
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}
const createAgentSlotId = () =>
  `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
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
    defaultProjectPath: normalizePath(config.defaultProjectPath) ?? '',
    systemPrompt: config.systemPrompt ?? '',
    permissionMode: config.permissionMode === 'default' ? 'default' : 'full_access',
    subagentEnabled: config.subagentEnabled === true,
    subagents: normalizeDeepChatSubagentSlots(config.subagents),
    disabledAgentTools: [...(config.disabledAgentTools ?? [])],
    autoCompactionEnabled: config.autoCompactionEnabled ?? true,
    autoCompactionTriggerThreshold: numText(config.autoCompactionTriggerThreshold ?? 80),
    autoCompactionRetainRecentPairs: numText(config.autoCompactionRetainRecentPairs ?? 2)
  }
}
const modelText = (selection: EditableModel | undefined) => {
  if (!selection?.providerId || !selection?.modelId) {
    return t('common.selectModel')
  }

  const providerModels = modelStore.allProviderModels.find(
    (entry) => entry.providerId === selection.providerId
  )
  const matchedModel = providerModels?.models.find((model) => model.id === selection.modelId)
  if (matchedModel) {
    return matchedModel.name || matchedModel.id
  }

  const fallbackMatch = modelStore.findModelByIdOrName(selection.modelId)
  return fallbackMatch?.model.name || selection.modelId
}
const getModelLabel = (key: ModelKey) => modelText(form[key])
const getModelIconId = (key: ModelKey) => form[key]?.modelId ?? ''
const getSubagentTargetValue = (slot: EditableSubagentSlot) =>
  slot.targetType === 'self'
    ? CURRENT_SUBAGENT_TARGET
    : (slot.targetAgentId ?? CURRENT_SUBAGENT_TARGET)

const setSubagentTarget = (slot: EditableSubagentSlot, targetValue: string) => {
  if (targetValue === CURRENT_SUBAGENT_TARGET) {
    slot.targetType = 'self'
    delete slot.targetAgentId
    return
  }

  slot.targetType = 'agent'
  slot.targetAgentId = targetValue
}

const handleSubagentTargetChange = (slot: EditableSubagentSlot, event: Event) => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) {
    return
  }

  setSubagentTarget(slot, target.value)
}

const addSubagentSlot = () => {
  if (form.subagents.length >= subagentSlotLimit) {
    return
  }

  form.subagents.push({
    id: createAgentSlotId(),
    targetType: 'self',
    displayName: '',
    description: ''
  })
}
const removeSubagentSlot = (index: number) => {
  if (!form.subagents[index]) {
    return
  }

  form.subagents.splice(index, 1)
}
const clearModel = (key: ModelKey) => {
  form[key] = null
}
const selectModel = (key: ModelKey, model: RENDERER_MODEL_META, providerId: string) => {
  form[key] = { providerId, modelId: model.id }
  if (key === 'chatModel') chatOpen.value = false
  if (key === 'assistantModel') assistantOpen.value = false
  if (key === 'visionModel') visionOpen.value = false
}
const loadSystemPromptTemplates = async () => {
  loadingSystemPrompts.value = true
  try {
    const prompts = await configPresenter.getSystemPrompts()
    systemPromptTemplates.value = Array.isArray(prompts)
      ? [...prompts].sort(
          (a, b) =>
            Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) ||
            a.name.localeCompare(b.name)
        )
      : []
  } catch {
    systemPromptTemplates.value = []
  } finally {
    loadingSystemPrompts.value = false
  }
}
const openSystemPromptPicker = () => {
  systemPromptDialogOpen.value = true
  void loadSystemPromptTemplates()
}
const applySystemPromptTemplate = (prompt: SystemPrompt) => {
  form.systemPrompt = prompt.content ?? ''
  systemPromptDialogOpen.value = false
}
const pickDefaultProjectPath = async () => {
  try {
    const selectedPath = await projectPresenter.selectDirectory()
    if (selectedPath) {
      form.defaultProjectPath = selectedPath
    }
  } catch (error) {
    console.warn('[DeepChatAgentsSettings] Failed to select default project path:', error)
  }
}
const clearDefaultProjectPath = () => {
  form.defaultProjectPath = ''
}
const selectDefaultProjectPath = (projectPath: string) => {
  form.defaultProjectPath = projectPath
}
const isToolEnabled = (toolName: string) => !form.disabledAgentTools.includes(toolName)
const toggleTool = (toolName: string) => {
  setToolEnabled(toolName, !isToolEnabled(toolName))
}
const setToolEnabled = (toolName: string, enabled: boolean) => {
  const next = new Set(form.disabledAgentTools)
  if (enabled) next.delete(toolName)
  else next.add(toolName)
  form.disabledAgentTools = Array.from(next).sort((a, b) => a.localeCompare(b))
}
const getGroupToolNames = (group: ToolGroup) => group.tools.map((tool) => tool.function.name)
const isGroupEnabled = (group: ToolGroup) =>
  getGroupToolNames(group).some((toolName) => isToolEnabled(toolName))
const setGroupEnabled = (group: ToolGroup, enabled: boolean) => {
  const next = new Set(form.disabledAgentTools)

  for (const toolName of getGroupToolNames(group)) {
    if (enabled) next.delete(toolName)
    else next.add(toolName)
  }

  form.disabledAgentTools = Array.from(next).sort((a, b) => a.localeCompare(b))
}
const loadRecentProjects = async () => {
  try {
    const result = await projectPresenter.getRecentProjects(8)
    recentProjects.value = Array.isArray(result) ? result : []
  } catch {
    recentProjects.value = []
  }
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
  allAgents.value = list
  const nextId =
    preferredId && deepchatAgents.value.some((agent) => agent.id === preferredId)
      ? preferredId
      : (deepchatAgents.value[0]?.id ?? null)
  selectedAgentId.value = nextId
  assignForm(fromAgent(deepchatAgents.value.find((agent) => agent.id === nextId) ?? null))
}
const selectAgent = (agentId: string) => {
  if (agentId === DRAFT_AGENT_ID) {
    selectedAgentId.value = DRAFT_AGENT_ID
    return
  }

  selectedAgentId.value = agentId
  assignForm(fromAgent(deepchatAgents.value.find((agent) => agent.id === agentId) ?? null))
}
const startCreate = () => {
  selectedAgentId.value = DRAFT_AGENT_ID
  assignForm(emptyForm())
}
const resetEditor = () => {
  if (selectedAgentId.value === DRAFT_AGENT_ID) startCreate()
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
              modelId: form.chatModel.modelId
            }
          : null,
        assistantModel: form.assistantModel,
        visionModel: form.visionModel,
        defaultProjectPath: normalizePath(form.defaultProjectPath),
        systemPrompt: form.systemPrompt,
        permissionMode: form.permissionMode,
        subagentEnabled: form.subagentEnabled,
        subagents: normalizeDeepChatSubagentSlots(form.subagents),
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
  await Promise.all([loadTools(), loadRecentProjects(), loadAgents('deepchat')])
})
</script>
