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
          <div
            v-if="mutable"
            data-testid="skill-detail-status-toggle"
            class="flex shrink-0 items-center gap-2 pr-8"
          >
            <div class="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <span class="text-xs text-muted-foreground">
                {{
                  deepchatDisabled
                    ? t('settings.skills.detail.disabled')
                    : t('settings.skills.detail.enabled')
                }}
              </span>
              <Switch
                :model-value="!deepchatDisabled"
                :disabled="saving"
                :aria-label="
                  deepchatDisabled
                    ? t('settings.skills.detail.enable')
                    : t('settings.skills.detail.disable')
                "
                @update:model-value="handleEnabledChange"
              />
            </div>
          </div>
        </div>
      </DialogHeader>

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
            :description="t('settings.skills.detail.confirmDeleteDescription', { name })"
            :danger="true"
            :busy="saving"
            confirm-label="t('common.delete')"
            cancel-label="t('common.cancel')"
            @update:open="handleDeleteConfirmOpenChange"
            @confirm="handleDelete"
            @cancel="handleDeleteCancel"
          />
        </div>
      </div>

      <div v-if="editing" class="min-h-0 flex-1 overflow-auto rounded-md border p-4">
        <div class="space-y-4">
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
    confirm-label="t('settings.leaveGuard.discard')"
    cancel-label="t('settings.leaveGuard.stay')"
    @update:open="discardConfirmOpen = $event"
    @confirm="discardAndClose"
    @cancel="discardConfirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import * as yaml from 'yaml'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const props = withDefaults(
  defineProps<{
    open: boolean
    name: string
    description?: string
    sourcePath?: string
    markdown?: string
    mutable?: boolean
    deepchatDisabled?: boolean
    saving?: boolean
  }>(),
  {
    description: '',
    sourcePath: '',
    markdown: '',
    mutable: false,
    deepchatDisabled: false,
    saving: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [content: string]
  'toggle-disabled': [disabled: boolean]
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

const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
const parsedSkill = computed(() =>
  parseSkillContent(draftActive.value ? buildSkillContent() : props.markdown)
)
const displayMarkdown = computed(() => parsedSkill.value.body.trim())
const headerDescription = computed(() =>
  draftActive.value ? editDescription.value : props.description
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

const discardAndClose = () => {
  if (props.saving) return
  discardConfirmOpen.value = false
  resetDraft()
  emit('update:open', false)
}

const handleSave = () => {
  if (props.saving || descriptionMissing.value) return
  emit('save', buildSkillContent())
}

const handleEnabledChange = (value: boolean | string) => {
  if (props.saving) return
  const enabled = typeof value === 'string' ? value === 'true' : Boolean(value)
  emit('toggle-disabled', !enabled)
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

const requestClose = () => {
  if (props.saving) return
  resetDraft()
  emit('update:open', false)
}

watch(
  () => [props.open, props.name, props.markdown],
  () => {
    if (props.open) {
      resetDraft()
    }
  },
  { immediate: true }
)

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.detail:${nanoid(8)}`,
  onDiscard: requestClose
})
const stopLeaveRiskSync = watch(
  [draftDirty, () => props.saving],
  ([dirty, saving]) => {
    leaveGuardLease.setRisk(saving ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
