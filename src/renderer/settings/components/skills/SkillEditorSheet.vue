<template>
  <Sheet v-model:open="isOpen">
    <SheetContent class="sm:max-w-xl flex flex-col p-6 pt-12">
      <SheetHeader>
        <SheetTitle>{{ t('settings.skills.edit.title') }}</SheetTitle>
        <SheetDescription>
          {{ skill?.name }}
        </SheetDescription>
      </SheetHeader>

      <ScrollArea class="flex-1 mt-4">
        <div class="space-y-4 px-1">
          <!-- Frontmatter fields -->
          <div class="space-y-3">
            <div class="space-y-1.5">
              <Label for="skill-name">{{ t('settings.skills.edit.name') }}</Label>
              <Input
                id="skill-name"
                v-model="editName"
                :placeholder="t('settings.skills.edit.namePlaceholder')"
                disabled
                class="bg-muted"
              />
              <p class="text-xs text-muted-foreground">
                {{ t('settings.skills.edit.nameHint') }}
              </p>
            </div>

            <div class="space-y-1.5">
              <Label for="skill-description">{{ t('settings.skills.edit.description') }}</Label>
              <Textarea
                id="skill-description"
                v-model="editDescription"
                :placeholder="t('settings.skills.edit.descriptionPlaceholder')"
                class="resize-none h-20"
              />
            </div>

            <div class="space-y-1.5">
              <Label for="skill-tools">{{ t('settings.skills.edit.allowedTools') }}</Label>
              <Input
                id="skill-tools"
                v-model="editAllowedTools"
                :placeholder="t('settings.skills.edit.allowedToolsPlaceholder')"
              />
              <p class="text-xs text-muted-foreground">
                {{ t('settings.skills.edit.allowedToolsHint') }}
              </p>
            </div>
          </div>

          <Separator />

          <!-- Folder tree -->
          <div class="space-y-1.5">
            <Label>{{ t('settings.skills.edit.files') }}</Label>
            <div class="border rounded-md p-2 bg-muted/30 max-h-48 overflow-auto">
              <SkillFolderTree v-if="skill" :skill-name="skill.name" />
            </div>
          </div>
        </div>
      </ScrollArea>

      <SheetFooter class="mt-4 pt-4 border-t">
        <Button variant="outline" @click="isOpen = false">
          {{ t('common.cancel') }}
        </Button>
        <Button @click="handleSave" :disabled="saving">
          <Icon v-if="saving" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
          {{ t('common.save') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import * as yaml from 'yaml'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Separator } from '@shadcn/components/ui/separator'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { usePresenter } from '@/composables/usePresenter'
import type { SkillMetadata } from '@shared/types/skill'
import SkillFolderTree from './SkillFolderTree.vue'

const props = defineProps<{
  skill: SkillMetadata | null
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const filePresenter = usePresenter('filePresenter')

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const editName = ref('')
const editDescription = ref('')
const editAllowedTools = ref('')
const editContent = ref('')
const saving = ref(false)

// Load skill content when skill changes
watch(
  () => props.skill,
  async (skill) => {
    if (skill) {
      editName.value = skill.name
      editDescription.value = skill.description
      editAllowedTools.value = skill.allowedTools?.join(', ') || ''
      try {
        const content = await filePresenter.readFile(skill.path)
        // Parse content to extract body (after frontmatter)
        const parsed = parseSkillContent(content)
        editContent.value = parsed.body
      } catch (error) {
        console.error('Failed to read skill file:', error)
        editContent.value = ''
      }
    }
  },
  { immediate: true }
)

// Parse SKILL.md content to extract frontmatter and body
const parseSkillContent = (content: string | null): { body: string } => {
  if (!content) {
    return { body: '' }
  }
  const lines = content.split('\n')
  let inFrontmatter = false
  let frontmatterEnd = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true
      } else {
        frontmatterEnd = i + 1
        break
      }
    }
  }

  const body = lines.slice(frontmatterEnd).join('\n').trim()
  return { body }
}

// Build SKILL.md content from edited fields using proper YAML serialization
const buildSkillContent = (): string => {
  const frontmatterData: Record<string, unknown> = {
    name: editName.value,
    description: editDescription.value
  }

  if (editAllowedTools.value.trim()) {
    const tools = editAllowedTools.value
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t)
    if (tools.length > 0) {
      frontmatterData.allowedTools = tools
    }
  }

  const yamlContent = yaml.stringify(frontmatterData, {
    lineWidth: 0, // Disable line wrapping
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE'
  })

  return `---\n${yamlContent}---\n\n${editContent.value}`
}

const handleSave = async () => {
  if (!props.skill) return

  saving.value = true
  try {
    const content = buildSkillContent()
    const result = await skillsStore.updateSkillFile(props.skill.name, content)

    if (result.success) {
      toast({
        title: t('settings.skills.edit.success')
      })
      emit('saved')
      isOpen.value = false
    } else {
      toast({
        title: t('settings.skills.edit.failed'),
        description: result.error,
        variant: 'destructive'
      })
    }
  } catch (error) {
    toast({
      title: t('settings.skills.edit.failed'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    saving.value = false
  }
}
</script>
