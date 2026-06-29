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
          <div v-if="mutable || canInstallToAgent" class="flex shrink-0 items-center gap-2">
            <Button
              v-if="canInstallToAgent"
              variant="outline"
              size="sm"
              @click="emit('install-to-agent')"
            >
              {{ t('settings.skills.detail.installToAgent') }}
            </Button>
            <div v-if="mutable" class="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <span class="text-xs text-muted-foreground">
                {{
                  deepchatDisabled
                    ? t('settings.skills.detail.disabled')
                    : t('settings.skills.detail.enabled')
                }}
              </span>
              <Switch
                :model-value="!deepchatDisabled"
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
        <div v-if="mutable" class="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" @click="toggleEditing">
            <Icon :icon="editing ? 'lucide:eye' : 'lucide:pencil'" class="mr-1 h-4 w-4" />
            {{ editing ? t('settings.skills.detail.preview') : t('settings.skills.detail.edit') }}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <Button variant="destructive" size="sm">
                <Icon icon="lucide:trash-2" class="mr-1 h-4 w-4" />
                {{ t('settings.skills.detail.delete') }}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{{
                  t('settings.skills.detail.confirmDeleteTitle')
                }}</AlertDialogTitle>
                <AlertDialogDescription>
                  {{ t('settings.skills.detail.confirmDeleteDescription', { name }) }}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                <AlertDialogAction
                  class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  @click="emit('delete')"
                >
                  {{ t('common.delete') }}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            </Label>
            <Textarea
              id="skill-detail-description"
              v-model="editDescription"
              :placeholder="t('settings.skills.edit.descriptionPlaceholder')"
              class="h-20 resize-none"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="skill-detail-tools">{{ t('settings.skills.edit.allowedTools') }}</Label>
            <Input
              id="skill-detail-tools"
              v-model="editAllowedTools"
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
        <Button variant="outline" :disabled="saving" @click="cancelEditing">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="saving" @click="handleSave">
          <Icon v-if="saving" icon="lucide:loader-2" class="mr-1 h-4 w-4 animate-spin" />
          {{ t('common.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as yaml from 'yaml'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    name: string
    description?: string
    sourcePath?: string
    markdown?: string
    mutable?: boolean
    deepchatDisabled?: boolean
    canInstallToAgent?: boolean
    saving?: boolean
  }>(),
  {
    description: '',
    sourcePath: '',
    markdown: '',
    mutable: false,
    deepchatDisabled: false,
    canInstallToAgent: false,
    saving: false
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [content: string]
  'toggle-disabled': [disabled: boolean]
  'install-to-agent': []
  delete: []
}>()

const { t } = useI18n()

const editing = ref(false)
const editDescription = ref('')
const editAllowedTools = ref('')
const editContent = ref('')

const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
const parsedSkill = computed(() => parseSkillContent(props.markdown))
const displayMarkdown = computed(() => parsedSkill.value.body.trim())
const headerDescription = computed(() =>
  editing.value ? editDescription.value : props.description
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
}

const buildSkillContent = () => {
  const frontmatterData: Record<string, unknown> = {
    name: props.name,
    description: editDescription.value
  }

  const tools = editAllowedTools.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (tools.length) {
    frontmatterData.allowedTools = tools
  }

  const yamlContent = yaml.stringify(frontmatterData, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE'
  })

  return `---\n${yamlContent}---\n\n${editContent.value}`
}

const toggleEditing = () => {
  if (editing.value) {
    editing.value = false
    return
  }

  hydrateEditor()
  editing.value = true
}

const cancelEditing = () => {
  hydrateEditor()
  editing.value = false
}

const handleOpenChange = (value: boolean) => {
  if (!value) {
    editing.value = false
  }
  emit('update:open', value)
}

const handleSave = () => {
  emit('save', buildSkillContent())
}

const handleEnabledChange = (value: boolean | string) => {
  const enabled = typeof value === 'string' ? value === 'true' : Boolean(value)
  emit('toggle-disabled', !enabled)
}

watch(
  () => [props.open, props.name, props.markdown],
  () => {
    if (props.open) {
      editing.value = false
      hydrateEditor()
    }
  },
  { immediate: true }
)
</script>
