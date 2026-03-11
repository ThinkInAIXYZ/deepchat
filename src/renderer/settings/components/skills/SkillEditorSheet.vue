<template>
  <Sheet v-model:open="isOpen">
    <SheetContent class="sm:max-w-2xl flex h-full max-h-screen flex-col overflow-hidden p-6 pt-12">
      <SheetHeader>
        <SheetTitle>{{ t('settings.skills.edit.title') }}</SheetTitle>
        <SheetDescription>
          {{ skill?.name }}
        </SheetDescription>
      </SheetHeader>

      <ScrollArea class="mt-4 min-h-0 flex-1">
        <div class="space-y-4 px-1">
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

            <div class="space-y-1.5">
              <Label for="skill-content">{{ t('settings.skills.edit.content') }}</Label>
              <Textarea
                id="skill-content"
                v-model="editContent"
                :placeholder="t('settings.skills.edit.placeholder')"
                class="min-h-48 resize-y font-mono text-xs"
              />
            </div>
          </div>

          <Separator />

          <div class="space-y-3">
            <div class="space-y-1">
              <Label>{{ t('settings.skills.edit.runtimeTitle') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.skills.edit.runtimeHint') }}
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <Label>{{ t('settings.skills.edit.pythonRuntime') }}</Label>
                <Select
                  :model-value="pythonRuntime"
                  @update:model-value="handleRuntimeChange('python', $event)"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {{ t('settings.skills.edit.runtime.auto') }}
                    </SelectItem>
                    <SelectItem value="system">
                      {{ t('settings.skills.edit.runtime.system') }}
                    </SelectItem>
                    <SelectItem value="builtin">
                      {{ t('settings.skills.edit.runtime.builtin') }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1.5">
                <Label>{{ t('settings.skills.edit.nodeRuntime') }}</Label>
                <Select
                  :model-value="nodeRuntime"
                  @update:model-value="handleRuntimeChange('node', $event)"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {{ t('settings.skills.edit.runtime.auto') }}
                    </SelectItem>
                    <SelectItem value="system">
                      {{ t('settings.skills.edit.runtime.system') }}
                    </SelectItem>
                    <SelectItem value="builtin">
                      {{ t('settings.skills.edit.runtime.builtin') }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label>{{ t('settings.skills.edit.envTitle') }}</Label>
              <Button variant="ghost" size="sm" @click="addEnvRow">
                {{ t('settings.acp.addEnv') }}
              </Button>
            </div>

            <div class="space-y-2">
              <div
                v-for="row in envRows"
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
                  type="password"
                  class="col-span-6"
                  :placeholder="t('settings.acp.envValuePlaceholder')"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  class="col-span-1"
                  @click="removeEnvRow(row.id)"
                >
                  ✕
                </Button>
              </div>
            </div>

            <p class="text-xs text-amber-600 dark:text-amber-400">
              {{ t('settings.skills.edit.envWarning') }}
            </p>
          </div>

          <Separator />

          <div class="space-y-2">
            <div class="space-y-1">
              <Label>{{ t('settings.skills.edit.scriptsTitle') }}</Label>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.skills.edit.scriptsHint') }}
              </p>
            </div>

            <div v-if="scriptRows.length === 0" class="text-xs text-muted-foreground">
              {{ t('settings.skills.edit.noScripts') }}
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="script in scriptRows"
                :key="script.relativePath"
                class="border rounded-md p-3 space-y-2"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ script.relativePath }}
                    </div>
                    <div class="flex items-center gap-2 mt-1">
                      <Badge variant="outline" class="text-[11px]">
                        {{ script.runtime }}
                      </Badge>
                      <span class="text-xs text-muted-foreground">
                        {{ script.absolutePath }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <Label class="text-xs text-muted-foreground">
                      {{ t('settings.skills.edit.scriptEnabled') }}
                    </Label>
                    <Switch
                      :model-value="script.enabled"
                      @update:model-value="script.enabled = !!$event"
                    />
                  </div>
                </div>

                <div class="space-y-1.5">
                  <Label>{{ t('settings.skills.edit.scriptDescription') }}</Label>
                  <Input
                    v-model="script.description"
                    :placeholder="t('settings.skills.edit.scriptDescriptionPlaceholder')"
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

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
        <Button :disabled="saving" @click="handleSave">
          <Icon v-if="saving" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
          {{ t('common.save') }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { nanoid } from 'nanoid'
import { useI18n } from 'vue-i18n'
import * as yaml from 'yaml'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Separator } from '@shadcn/components/ui/separator'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Switch } from '@shadcn/components/ui/switch'
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
import type {
  SkillExtensionConfig,
  SkillMetadata,
  SkillRuntimePreference,
  SkillScriptDescriptor
} from '@shared/types/skill'
import SkillFolderTree from './SkillFolderTree.vue'

type EnvRow = { id: string; key: string; value: string }
type EditableScript = SkillScriptDescriptor & { description: string }

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
const skillPresenter = usePresenter('skillPresenter', { safeCall: false })

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const editName = ref('')
const editDescription = ref('')
const editAllowedTools = ref('')
const editContent = ref('')
const pythonRuntime = ref<SkillRuntimePreference>('auto')
const nodeRuntime = ref<SkillRuntimePreference>('auto')
const envRows = ref<EnvRow[]>([])
const scriptRows = ref<EditableScript[]>([])
const saving = ref(false)
const loadRequestId = ref(0)

const createDefaultExtension = (): SkillExtensionConfig => ({
  version: 1,
  env: {},
  runtimePolicy: {
    python: 'auto',
    node: 'auto'
  },
  scriptOverrides: {}
})

const resetRuntimeForm = () => {
  pythonRuntime.value = 'auto'
  nodeRuntime.value = 'auto'
  envRows.value = [{ id: nanoid(6), key: '', value: '' }]
  scriptRows.value = []
}

const resetEditorForm = () => {
  editName.value = ''
  editDescription.value = ''
  editAllowedTools.value = ''
  editContent.value = ''
  resetRuntimeForm()
}

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

  return {
    body: lines.slice(frontmatterEnd).join('\n').trim()
  }
}

const buildSkillContent = (): string => {
  const frontmatterData: Record<string, unknown> = {
    name: editName.value,
    description: editDescription.value
  }

  if (editAllowedTools.value.trim()) {
    const tools = editAllowedTools.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (tools.length > 0) {
      frontmatterData.allowedTools = tools
    }
  }

  const yamlContent = yaml.stringify(frontmatterData, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE'
  })

  return `---\n${yamlContent}---\n\n${editContent.value}`
}

const addEnvRow = () => {
  envRows.value.push({ id: nanoid(6), key: '', value: '' })
}

const removeEnvRow = (id: string) => {
  envRows.value = envRows.value.filter((row) => row.id !== id)
  if (!envRows.value.length) {
    addEnvRow()
  }
}

const hydrateRuntimeForm = (extension: SkillExtensionConfig, scripts: SkillScriptDescriptor[]) => {
  pythonRuntime.value = extension.runtimePolicy.python
  nodeRuntime.value = extension.runtimePolicy.node
  envRows.value = Object.entries(extension.env).map(([key, value]) => ({
    id: nanoid(6),
    key,
    value
  }))
  if (!envRows.value.length) {
    addEnvRow()
  }

  scriptRows.value = scripts.map((script) => ({
    ...script,
    description: script.description ?? ''
  }))
}

const isCurrentLoad = (requestId: number, skillName: string) => {
  return loadRequestId.value === requestId && props.open && props.skill?.name === skillName
}

const loadSkill = async (skill: SkillMetadata) => {
  const requestId = ++loadRequestId.value
  const skillName = skill.name
  editName.value = skill.name
  editDescription.value = skill.description
  editAllowedTools.value = skill.allowedTools?.join(', ') || ''
  editContent.value = ''
  resetRuntimeForm()

  try {
    const content = await skillPresenter.readSkillFile(skillName)
    if (!isCurrentLoad(requestId, skillName)) {
      return
    }
    editContent.value = parseSkillContent(content).body
  } catch (error) {
    if (!isCurrentLoad(requestId, skillName)) {
      return
    }
    console.error('Failed to read skill file:', error)
    editContent.value = ''
  }

  if (!isCurrentLoad(requestId, skillName)) {
    return
  }

  await skillsStore.loadSkillRuntime(skillName)
  if (!isCurrentLoad(requestId, skillName)) {
    return
  }
  hydrateRuntimeForm(
    skillsStore.skillExtensions[skillName] ?? createDefaultExtension(),
    skillsStore.skillScripts[skillName] ?? []
  )
}

watch(
  () => props.open,
  (open) => {
    if (open && props.skill) {
      void loadSkill(props.skill)
      return
    }

    if (!open) {
      loadRequestId.value += 1
      resetEditorForm()
    }
  },
  { immediate: true }
)

watch(
  () => props.skill,
  (skill) => {
    if (skill && props.open) {
      void loadSkill(skill)
    }
  }
)

const handleRuntimeChange = (target: 'python' | 'node', value: unknown) => {
  if (value !== 'auto' && value !== 'system' && value !== 'builtin') {
    return
  }

  if (target === 'python') {
    pythonRuntime.value = value
    return
  }

  nodeRuntime.value = value
}

const buildEnv = (): Record<string, string> => {
  return Object.fromEntries(
    envRows.value
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0)
  )
}

const buildScriptOverrides = (): SkillExtensionConfig['scriptOverrides'] => {
  return Object.fromEntries(
    scriptRows.value.map((script) => [
      script.relativePath,
      {
        enabled: script.enabled,
        description: script.description.trim() || undefined
      }
    ])
  )
}

const handleSave = async () => {
  if (!props.skill) return

  saving.value = true
  try {
    const skillContent = buildSkillContent()
    const runtimeExtension: SkillExtensionConfig = {
      version: 1,
      env: buildEnv(),
      runtimePolicy: {
        python: pythonRuntime.value,
        node: nodeRuntime.value
      },
      scriptOverrides: buildScriptOverrides()
    }
    const contentResult = await skillsStore.saveSkillWithExtension(
      props.skill.name,
      skillContent,
      runtimeExtension
    )

    if (!contentResult.success) {
      toast({
        title: t('settings.skills.edit.failed'),
        description: contentResult.error,
        variant: 'destructive'
      })
      return
    }

    toast({
      title: t('settings.skills.edit.success')
    })
    emit('saved')
    isOpen.value = false
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
