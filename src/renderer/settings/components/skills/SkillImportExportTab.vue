<template>
  <div class="space-y-4">
    <div class="rounded-md border px-4 py-3">
      <div class="mb-2 text-sm font-medium">{{ t('settings.skills.importExport.directory') }}</div>
      <div class="flex gap-2">
        <Input v-model="directory" class="font-mono text-xs" />
        <Button variant="outline" @click="browse">
          <Icon icon="lucide:folder-open" class="mr-1 h-4 w-4" />
          {{ t('settings.skills.importExport.browse') }}
        </Button>
        <Button :disabled="!directory || saving" @click="saveDirectory">
          <Icon
            :icon="saving ? 'lucide:loader-2' : 'lucide:save'"
            class="mr-1 h-4 w-4"
            :class="{ 'animate-spin': saving }"
          />
          {{ t('settings.skills.importExport.save') }}
        </Button>
      </div>
    </div>

    <Tabs v-model="activeTab">
      <TabsList class="grid w-full max-w-xs grid-cols-2">
        <TabsTrigger value="export">{{ t('settings.skills.importExport.export') }}</TabsTrigger>
        <TabsTrigger value="import">{{ t('settings.skills.importExport.import') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="export" class="mt-4 space-y-4">
        <div class="rounded-md border">
          <label
            v-for="skill in skills"
            :key="skill.name"
            class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
          >
            <Checkbox
              :checked="selectedExportNames.has(skill.name)"
              :disabled="skill.deepchatDisabled && !includeDisabled"
              @update:checked="toggleExport(skill.name)"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium" :title="skill.name">
                {{ skill.name }}
              </span>
              <span class="block truncate text-xs text-muted-foreground" :title="skill.description">
                {{ skill.description }}
              </span>
            </span>
            <Badge variant="outline">
              {{
                skill.deepchatDisabled
                  ? t('settings.skills.card.disabled')
                  : t('settings.skills.card.enabled')
              }}
            </Badge>
          </label>
          <div
            v-if="skills.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.skills.empty') }}
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <Checkbox :checked="includeDisabled" @update:checked="toggleIncludeDisabled" />
          {{ t('settings.skills.importExport.includeDisabled') }}
        </label>

        <div class="rounded-md border">
          <div
            v-for="item in exportPreview?.items ?? []"
            :key="item.sourcePath"
            class="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1 truncate" :title="item.name">{{ item.name }}</div>
            <Badge variant="outline" :class="stateClass(item.state)">
              {{ t(`settings.skills.importExport.state.${item.state}`) }}
            </Badge>
          </div>
          <div
            v-if="!exportPreview || exportPreview.items.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.skills.importExport.noExportPreview') }}
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="!config || previewing" @click="previewExport">
            {{ t('settings.skills.importExport.previewExport') }}
          </Button>
          <Button :disabled="!exportPreview || exporting" @click="executeExport">
            <Icon
              :icon="exporting ? 'lucide:loader-2' : 'lucide:upload'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': exporting }"
            />
            {{ t('settings.skills.importExport.exportNow') }}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="import" class="mt-4 space-y-4">
        <div class="flex justify-end">
          <Button variant="outline" :disabled="!config || previewing" @click="previewImport">
            <Icon
              :icon="previewing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': previewing }"
            />
            {{ t('settings.skills.importExport.previewImport') }}
          </Button>
        </div>

        <div class="rounded-md border">
          <label
            v-for="item in importPreview?.items ?? []"
            :key="item.sourcePath"
            class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
            :class="{ 'cursor-not-allowed opacity-60': item.state === 'invalid' }"
          >
            <Checkbox
              :checked="selectedImportNames.has(item.name)"
              :disabled="item.state === 'invalid'"
              @update:checked="toggleImport(item.name)"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium" :title="item.name">
                {{ item.name }}
              </span>
              <span
                class="block truncate font-mono text-xs text-muted-foreground"
                :title="item.sourcePath"
              >
                {{ item.sourcePath }}
              </span>
              <span v-if="item.error" class="block text-xs text-destructive">{{ item.error }}</span>
            </span>
            <Badge variant="outline" :class="stateClass(item.state)">
              {{ t(`settings.skills.importExport.state.${item.state}`) }}
            </Badge>
          </label>
          <div
            v-if="!importPreview || importPreview.items.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.skills.importExport.noImportPreview') }}
          </div>
        </div>

        <div class="space-y-2 rounded-md border px-3 py-3">
          <div class="text-sm font-medium">{{ t('settings.skills.importExport.strategy') }}</div>
          <RadioGroup v-model="importStrategy" class="grid gap-2 sm:grid-cols-3">
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="rename" />
              {{ t('settings.skills.importExport.rename') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="overwrite" />
              {{ t('settings.skills.importExport.overwrite') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="skip" />
              {{ t('settings.skills.importExport.skip') }}
            </label>
          </RadioGroup>
        </div>

        <div class="flex justify-end">
          <Button :disabled="!canImport" @click="executeImport">
            <Icon
              :icon="importing ? 'lucide:loader-2' : 'lucide:download'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': importing }"
            />
            {{ t('settings.skills.importExport.importSelected') }}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Input } from '@shadcn/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { useToast } from '@/components/use-toast'
import { createDeviceClient } from '@api/DeviceClient'
import { createSkillClient } from '@api/SkillClient'
import type {
  SkillInstallConflictStrategy,
  SkillSyncDirectoryExportPreview,
  SkillSyncDirectoryImportPreview,
  SkillSyncDirectoryPreviewItem
} from '@shared/types/skill'
import type { SkillSyncDirectoryConfig } from '@shared/types/skillManagement'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

const props = defineProps<{
  skills: UnifiedSkillItem[]
}>()

const emit = defineEmits<{
  completed: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillClient = createSkillClient()
const deviceClient = createDeviceClient()

const activeTab = ref<'export' | 'import'>('export')
const config = ref<SkillSyncDirectoryConfig | null>(null)
const directory = ref('')
const saving = ref(false)
const previewing = ref(false)
const exporting = ref(false)
const importing = ref(false)
const includeDisabled = ref(false)
const selectedExportNames = ref<Set<string>>(new Set())
const selectedImportNames = ref<Set<string>>(new Set())
const exportPreview = ref<SkillSyncDirectoryExportPreview | null>(null)
const importPreview = ref<SkillSyncDirectoryImportPreview | null>(null)
const importStrategy = ref<SkillInstallConflictStrategy>('rename')

const skills = computed(() => props.skills.filter((skill) => skill.mutable))
const canImport = computed(
  () => Boolean(importPreview.value) && selectedImportNames.value.size > 0 && !importing.value
)

const loadConfig = async () => {
  config.value = await skillClient.getSkillsSyncConfig()
  directory.value = config.value?.skillsDirectory ?? ''
}

const browse = async () => {
  const result = await deviceClient.selectDirectory()
  if (!result.canceled && result.filePaths[0]) {
    directory.value = result.filePaths[0]
  }
}

const saveDirectory = async () => {
  saving.value = true
  try {
    config.value = await skillClient.setSkillsSyncDirectory(directory.value)
    directory.value = config.value.skillsDirectory
    toast({ title: t('settings.skills.importExport.saved') })
  } finally {
    saving.value = false
  }
}

const toggleExport = (name: string) => {
  selectedExportNames.value = toggleSet(selectedExportNames.value, name)
}

const toggleImport = (name: string) => {
  selectedImportNames.value = toggleSet(selectedImportNames.value, name)
}

const toggleIncludeDisabled = () => {
  includeDisabled.value = !includeDisabled.value
  if (!includeDisabled.value) {
    selectedExportNames.value = new Set(
      [...selectedExportNames.value].filter(
        (name) => !props.skills.find((skill) => skill.name === name)?.deepchatDisabled
      )
    )
  }
}

const toggleSet = (current: Set<string>, name: string) => {
  const next = new Set(current)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

const previewExport = async () => {
  previewing.value = true
  try {
    exportPreview.value = await skillClient.previewSyncDirectoryExport({
      skillNames: [...selectedExportNames.value],
      includeDisabled: includeDisabled.value
    })
  } finally {
    previewing.value = false
  }
}

const executeExport = async () => {
  exporting.value = true
  try {
    const result = await skillClient.executeSyncDirectoryExport({
      skillNames: [...selectedExportNames.value],
      includeDisabled: includeDisabled.value
    })
    toast({
      title: t('settings.skills.importExport.exported'),
      description: t('settings.skills.importExport.result', {
        count: result.exported ?? 0,
        failed: result.failed.length
      })
    })
    emit('completed')
  } finally {
    exporting.value = false
  }
}

const previewImport = async () => {
  previewing.value = true
  try {
    importPreview.value = await skillClient.previewSyncDirectoryImport()
    selectedImportNames.value = new Set(
      importPreview.value.items
        .filter((item) => item.state !== 'invalid' && item.state !== 'same')
        .map((item) => item.name)
    )
  } finally {
    previewing.value = false
  }
}

const executeImport = async () => {
  importing.value = true
  try {
    const result = await skillClient.executeSyncDirectoryImport({
      skillNames: [...selectedImportNames.value],
      strategy: importStrategy.value
    })
    toast({
      title: t('settings.skills.importExport.imported'),
      description: t('settings.skills.importExport.result', {
        count: result.imported ?? 0,
        failed: result.failed.length
      })
    })
    emit('completed')
  } finally {
    importing.value = false
  }
}

const stateClass = (state: SkillSyncDirectoryPreviewItem['state']) => {
  if (state === 'conflict' || state === 'modified') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (state === 'invalid') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  if (state === 'new') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  return ''
}

onMounted(async () => {
  await loadConfig()
  selectedExportNames.value = new Set(
    skills.value.filter((skill) => !skill.deepchatDisabled).map((skill) => skill.name)
  )
})
</script>
