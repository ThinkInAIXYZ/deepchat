<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent v-if="open" class="sm:max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <div class="flex items-start gap-3">
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted text-lg font-semibold"
          >
            {{ initial }}
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle class="truncate text-2xl">{{ name }}</DialogTitle>
            <DialogDescription class="mt-2 line-clamp-3 text-sm">
              {{ headerDescription || t('settings.skills.detail.noDescription') }}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <section
        data-testid="plugins-skill-detail-enabled-agents"
        class="rounded-md border bg-muted/20 px-3 py-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-medium">{{ t('settings.skills.detail.enabledAgents') }}</div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ t('settings.skills.detail.enabledAgentsHint') }}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <DcButton
                data-testid="skill-detail-add-agent"
                variant="outline"
                size="sm"
                :disabled="saving || agentUpdatePendingId !== null || availableAgents.length === 0"
              >
                <Icon icon="lucide:plus" class="mr-1 size-4" />
                {{ t('settings.skills.detail.addAgent') }}
              </DcButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DcDropdownActionItem
                v-for="agent in availableAgents"
                :key="agent.id"
                icon="lucide:bot"
                :label="agent.name || agent.id"
                @select="emit('enable-agent', agent.id)"
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div v-if="enabledAgents.length" class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="agent in enabledAgents"
            :key="agent.id"
            :data-testid="`skill-detail-enabled-agent-${agent.id}`"
            class="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border bg-background pl-2.5 pr-1 text-xs"
          >
            <Icon icon="lucide:bot" class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ agent.name }}</span>
            <button
              type="button"
              class="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="saving || agentUpdatePendingId !== null"
              :aria-label="t('settings.skills.detail.removeAgent', { agent: agent.name })"
              @click="emit('disable-agent', agent.id)"
            >
              <Spinner v-if="agentUpdatePendingId === agent.id" class="size-3" />
              <Icon v-else icon="lucide:x" class="size-3.5" />
            </button>
          </span>
        </div>
        <p v-else class="mt-3 text-xs text-muted-foreground">
          {{ t('settings.skills.detail.noEnabledAgents') }}
        </p>
      </section>

      <div class="flex items-center justify-between gap-3">
        <div v-if="sourcePath" class="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {{ sourcePath }}
        </div>
        <div v-else></div>
        <div
          v-if="mutable"
          data-testid="skill-detail-actions"
          class="flex shrink-0 items-center gap-2"
        >
          <DcButton
            v-if="mutable"
            variant="outline"
            size="sm"
            :disabled="saving"
            @click="toggleEditing"
          >
            <Icon :icon="editing ? 'lucide:eye' : 'lucide:pencil'" class="mr-1 h-4 w-4" />
            {{ editing ? t('settings.skills.detail.preview') : t('settings.skills.detail.edit') }}
          </DcButton>
          <DcButton
            variant="destructive"
            size="sm"
            :disabled="saving"
            @click="deleteConfirmOpen = true"
          >
            <Icon icon="lucide:trash-2" class="mr-1 h-4 w-4" />
            {{ t('settings.skills.detail.delete') }}
          </DcButton>
          <DcConfirmDialog
            :open="deleteConfirmOpen"
            :title="t('settings.skills.detail.confirmDeleteTitle')"
            :description="deleteDescription"
            :danger="true"
            :busy="saving"
            :confirm-label="t('common.delete')"
            :cancel-label="t('common.cancel')"
            @update:open="handleDeleteConfirmOpenChange"
            @confirm="handleDelete"
            @cancel="handleDeleteCancel"
          />
        </div>
      </div>

      <div v-if="editing" class="min-h-0 flex-1 overflow-auto rounded-md border p-4">
        <div class="space-y-4">
          <div class="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {{ editImpactDescription }}
          </div>

          <div class="space-y-1.5">
            <Label for="skill-detail-name">{{ t('settings.skills.edit.name') }}</Label>
            <Input id="skill-detail-name" :model-value="name" disabled class="bg-muted" />
            <p class="text-xs text-muted-foreground">
              {{ t('settings.skills.edit.nameHint') }}
            </p>
          </div>

          <div class="space-y-1.5">
            <Label for="skill-detail-description">
              {{ t('settings.skills.edit.description') }}
              <span aria-hidden="true" class="text-destructive">*</span>
            </Label>
            <Textarea
              id="skill-detail-description"
              v-model="editDescription"
              :disabled="saving"
              :aria-invalid="descriptionMissing"
              aria-required="true"
              :placeholder="t('settings.skills.edit.descriptionPlaceholder')"
              class="h-20 resize-none"
            />
            <p v-if="descriptionMissing" class="text-xs text-destructive">
              {{ t('components.promptParamsDialog.required') }}
            </p>
          </div>

          <div class="space-y-1.5">
            <Label for="skill-detail-tools">{{ t('settings.skills.edit.allowedTools') }}</Label>
            <Input
              id="skill-detail-tools"
              v-model="editAllowedTools"
              :disabled="saving"
              :placeholder="t('settings.skills.edit.allowedToolsPlaceholder')"
            />
            <p class="text-xs text-muted-foreground">
              {{ t('settings.skills.edit.allowedToolsHint') }}
            </p>
          </div>

          <div class="space-y-1.5">
            <Label for="skill-detail-content">{{ t('settings.skills.edit.content') }}</Label>
            <Textarea
              id="skill-detail-content"
              v-model="editContent"
              :disabled="saving"
              :placeholder="t('settings.skills.edit.placeholder')"
              class="min-h-72 resize-y font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div v-else class="min-h-0 flex-1 overflow-auto rounded-md border p-4">
        <MarkdownRenderer
          v-if="displayMarkdown"
          :content="displayMarkdown"
          :smooth-streaming="false"
          :link-context="{ source: 'workspace', sourceFilePath: sourcePath }"
        />
        <div v-else class="py-10 text-center text-sm text-muted-foreground">
          {{ t('settings.skills.detail.empty') }}
        </div>
      </div>

      <DialogFooter v-if="editing">
        <DcButton variant="outline" :disabled="saving" @click="cancelEditing">
          {{ t('common.cancel') }}
        </DcButton>
        <DcButton :disabled="saving || descriptionMissing" @click="handleSave">
          <Spinner v-if="saving" data-icon="inline-start" />
          {{ t('common.save') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <DcConfirmDialog
    :open="discardConfirmOpen"
    :title="t('settings.leaveGuard.dirtyTitle')"
    :description="t('settings.leaveGuard.dirtyDescription')"
    :danger="false"
    :confirm-label="t('settings.leaveGuard.discard')"
    :cancel-label="t('settings.leaveGuard.stay')"
    @update:open="handleDiscardConfirmOpenChange"
    @confirm="discardAndClose"
    @cancel="cancelDiscard"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave } from 'vue-router'
import * as yaml from 'yaml'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    name: string
    description?: string
    sourcePath?: string
    markdown?: string
    mutable?: boolean
    agents?: Array<{ id: string; name: string }>
    enabledAgentIds?: string[]
    enabledAgentNames?: string[]
    agentUpdatePendingId?: string | null
    saving?: boolean
  }>(),
  {
    description: '',
    sourcePath: '',
    markdown: '',
    mutable: false,
    agents: () => [],
    enabledAgentIds: () => [],
    enabledAgentNames: () => [],
    agentUpdatePendingId: null,
    saving: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [content: string]
  'enable-agent': [agentId: string]
  'disable-agent': [agentId: string]
  delete: []
}>()

const { t } = useI18n()

const editing = ref(false)
const draftActive = ref(false)
const editDescription = ref('')
const editAllowedTools = ref('')
const editContent = ref('')
const baselineDraftSignature = ref('')
const deleteConfirmOpen = ref(false)
const discardConfirmOpen = ref(false)
let pendingRouteLeave: ((allowed: boolean) => void) | null = null

const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
const parsedSkill = computed(() =>
  parseSkillContent(draftActive.value ? buildSkillContent() : props.markdown)
)
const displayMarkdown = computed(() => parsedSkill.value.body.trim())
const headerDescription = computed(() =>
  draftActive.value ? editDescription.value : props.description
)
const agentNameById = computed(
  () => new Map(props.agents.map((agent) => [agent.id, agent.name || agent.id] as const))
)
const enabledAgents = computed(() =>
  props.enabledAgentIds.map((id) => ({ id, name: agentNameById.value.get(id) ?? id }))
)
const enabledAgentIdSet = computed(() => new Set(props.enabledAgentIds))
const availableAgents = computed(() =>
  props.agents.filter((agent) => !enabledAgentIdSet.value.has(agent.id))
)
const deleteDescription = computed(() =>
  props.enabledAgentNames.length > 0
    ? t('settings.skills.impact.confirmDeleteEnabled', {
        name: props.name,
        agents: props.enabledAgentNames.join(', ')
      })
    : t('settings.skills.impact.confirmDeleteUnused', { name: props.name })
)
const editImpactDescription = computed(() =>
  props.enabledAgentNames.length > 0
    ? t('settings.skills.impact.editEnabled', {
        agents: props.enabledAgentNames.join(', ')
      })
    : t('settings.skills.impact.editUnused')
)
const currentDraftSignature = computed(() =>
  JSON.stringify([editDescription.value, editAllowedTools.value, editContent.value])
)
const draftDirty = computed(
  () =>
    props.open && draftActive.value && currentDraftSignature.value !== baselineDraftSignature.value
)
const descriptionMissing = computed(
  () => props.open && editing.value && editDescription.value.trim().length === 0
)

const parseSkillContent = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { frontmatter: {} as Record<string, unknown>, body: content.trim() }
  }

  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = yaml.parse(match[1])
    frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    frontmatter = {}
  }

  return {
    frontmatter,
    body: content.slice(match[0].length).trim()
  }
}

const hydrateEditor = () => {
  const { frontmatter, body } = parseSkillContent(props.markdown)
  const allowedTools = frontmatter.allowedTools
  editDescription.value =
    typeof frontmatter.description === 'string' ? frontmatter.description : props.description
  editAllowedTools.value = Array.isArray(allowedTools)
    ? allowedTools.map(String).join(', ')
    : typeof allowedTools === 'string'
      ? allowedTools
      : ''
  editContent.value = body
  baselineDraftSignature.value = currentDraftSignature.value
}

const buildSkillContent = () => {
  const originalFrontmatter = parseSkillContent(props.markdown).frontmatter
  const frontmatterData: Record<string, unknown> = {
    ...originalFrontmatter,
    name: props.name,
    description: editDescription.value
  }

  const tools = editAllowedTools.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (tools.length) {
    frontmatterData.allowedTools = tools
  } else {
    delete frontmatterData.allowedTools
  }

  const yamlContent = yaml.stringify(frontmatterData, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE'
  })

  return `---\n${yamlContent}---\n\n${editContent.value}`
}

const toggleEditing = () => {
  if (props.saving) return
  if (editing.value) {
    editing.value = false
    return
  }

  if (!draftActive.value) {
    hydrateEditor()
    draftActive.value = true
  }
  editing.value = true
}

const resetDraft = () => {
  hydrateEditor()
  draftActive.value = false
  editing.value = false
  deleteConfirmOpen.value = false
  discardConfirmOpen.value = false
}

const cancelEditing = () => {
  if (props.saving) return
  resetDraft()
}

const handleOpenChange = (value: boolean) => {
  if (!value && props.saving) return
  if (!value && draftDirty.value) {
    discardConfirmOpen.value = true
    return
  }
  if (!value) resetDraft()
  emit('update:open', value)
}

const requestClose = () => handleOpenChange(false)

defineExpose({ requestClose })

const finishRouteLeave = (allowed: boolean) => {
  const resolve = pendingRouteLeave
  pendingRouteLeave = null
  resolve?.(allowed)
}

const discardAndClose = () => {
  if (props.saving) return
  const routeLeavePending = pendingRouteLeave !== null
  discardConfirmOpen.value = false
  resetDraft()
  if (routeLeavePending) {
    finishRouteLeave(true)
    return
  }
  emit('update:open', false)
}

const cancelDiscard = () => {
  discardConfirmOpen.value = false
  finishRouteLeave(false)
}

const handleDiscardConfirmOpenChange = (open: boolean) => {
  if (open) {
    discardConfirmOpen.value = true
    return
  }
  cancelDiscard()
}

const handleSave = () => {
  if (props.saving || descriptionMissing.value) return
  emit('save', buildSkillContent())
}

const handleDeleteConfirmOpenChange = (open: boolean) => {
  if (!open && props.saving) return
  deleteConfirmOpen.value = open
}

const handleDeleteCancel = () => {
  if (!props.saving) deleteConfirmOpen.value = false
}

const handleDelete = () => {
  if (!props.saving) emit('delete')
}

onBeforeRouteLeave(() => {
  if (props.saving) return false
  if (!draftDirty.value) return true

  finishRouteLeave(false)
  discardConfirmOpen.value = true
  return new Promise<boolean>((resolve) => {
    pendingRouteLeave = resolve
  })
})

onBeforeUnmount(() => finishRouteLeave(false))

watch(
  () => [props.open, props.name, props.markdown],
  () => {
    if (props.open) {
      resetDraft()
    }
  },
  { immediate: true }
)
</script>
