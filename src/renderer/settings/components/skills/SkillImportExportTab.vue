<template>
  <div class="space-y-4">
    <div class="rounded-md border px-4 py-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          class="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="directoryPickerDisabled"
          @click="chooseDirectory"
        >
          <div class="mb-2 text-sm font-medium">
            {{ t('settings.skills.importExport.directory') }}
          </div>
          <div class="flex min-w-0 items-center gap-2 text-sm">
            <Icon
              :icon="directoryStatusIcon"
              class="h-4 w-4 shrink-0"
              :class="directoryExists === false ? 'text-amber-500' : 'text-muted-foreground'"
            />
            <span
              class="min-w-0 truncate font-mono text-xs"
              :class="directory ? 'text-foreground' : 'text-muted-foreground'"
              :title="directory || t('settings.skills.importExport.noDirectory')"
            >
              {{ directory || t('settings.skills.importExport.noDirectory') }}
            </span>
          </div>
          <p
            v-if="directory && directoryExists === false"
            class="mt-2 text-xs text-amber-600 dark:text-amber-400"
          >
            {{ t('settings.skills.importExport.directoryMissing') }}
          </p>
          <p v-else-if="!directory" class="mt-2 text-xs text-muted-foreground">
            {{ t('settings.skills.importExport.chooseDirectoryHint') }}
          </p>
        </button>
        <Button variant="outline" :disabled="directoryPickerDisabled" @click="chooseDirectory">
          <Icon
            :icon="directoryPickerDisabled ? 'lucide:loader-2' : 'lucide:folder-open'"
            class="mr-1 h-4 w-4"
            :class="{ 'animate-spin': directoryPickerDisabled }"
          />
          {{
            directory
              ? t('settings.skills.importExport.changeDirectory')
              : t('settings.skills.importExport.chooseDirectory')
          }}
        </Button>
      </div>
    </div>

    <div
      v-if="!syncDirectoryReady"
      class="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
    >
      {{
        directory
          ? t('settings.skills.importExport.directoryMissingAction')
          : t('settings.skills.importExport.noDirectoryAction')
      }}
    </div>

    <Tabs v-else v-model="activeTab">
      <TabsList class="grid w-full max-w-xs grid-cols-2">
        <TabsTrigger value="export">{{ t('settings.skills.importExport.export') }}</TabsTrigger>
        <TabsTrigger value="import">{{ t('settings.skills.importExport.import') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="export" class="mt-4 space-y-4">
        <div class="flex flex-col gap-3 rounded-md border px-3 py-3 md:flex-row md:items-center">
          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search"
              class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="exportQuery"
              :placeholder="t('settings.skills.importExport.searchPlaceholder')"
              class="h-8 pl-8"
            />
          </div>
          <label class="flex items-center gap-2 whitespace-nowrap text-sm">
            <Checkbox :checked="includeDisabled" @update:checked="setIncludeDisabled" />
            {{ t('settings.skills.importExport.includeDisabled') }}
          </label>
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.importExport.selectedCount', { count: selectedExportNames.size })
            }}
          </span>
          <div class="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" @click="selectVisibleExport">
              {{ t('settings.skills.importExport.selectVisible') }}
            </Button>
            <Button variant="outline" size="sm" @click="clearExportSelection">
              {{ t('settings.skills.importExport.clearSelection') }}
            </Button>
          </div>
        </div>

        <div class="max-h-[48vh] overflow-y-auto rounded-md border">
          <label
            v-for="skill in exportCandidates"
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
            v-if="exportCandidates.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ skills.length === 0 ? t('settings.skills.empty') : t('settings.skills.noResults') }}
          </div>
        </div>

        <div class="flex justify-end">
          <Button :disabled="!canExport" @click="requestExportConfirmation">
            <Icon
              :icon="previewing || exporting ? 'lucide:loader-2' : 'lucide:upload'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': previewing || exporting }"
            />
            {{ t('settings.skills.importExport.exportNow') }}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="import" class="mt-4 space-y-4">
        <div class="flex flex-col gap-3 rounded-md border px-3 py-3 lg:flex-row lg:items-center">
          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search"
              class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="importQuery"
              :placeholder="t('settings.skills.importExport.searchPlaceholder')"
              class="h-8 pl-8"
            />
          </div>
          <select
            v-model="importStateFilter"
            :aria-label="t('settings.skills.importExport.stateFilter')"
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">{{ t('settings.skills.importExport.allStates') }}</option>
            <option value="new">{{ t('settings.skills.importExport.state.new') }}</option>
            <option value="conflict">{{ t('settings.skills.importExport.state.conflict') }}</option>
            <option value="modified">{{ t('settings.skills.importExport.state.modified') }}</option>
            <option value="same">{{ t('settings.skills.importExport.state.same') }}</option>
            <option value="invalid">{{ t('settings.skills.importExport.state.invalid') }}</option>
          </select>
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.importExport.selectedCount', { count: selectedImportNames.size })
            }}
          </span>
          <div class="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="!config || previewing"
              @click="previewImport"
            >
              <Icon
                :icon="previewing ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                class="mr-1 h-4 w-4"
                :class="{ 'animate-spin': previewing }"
              />
              {{ t('settings.skills.importExport.refresh') }}
            </Button>
            <Button variant="outline" size="sm" @click="selectVisibleImport">
              {{ t('settings.skills.importExport.selectVisible') }}
            </Button>
            <Button variant="outline" size="sm" @click="clearImportSelection">
              {{ t('settings.skills.importExport.clearSelection') }}
            </Button>
          </div>
        </div>

        <div class="max-h-[48vh] overflow-y-auto rounded-md border">
          <label
            v-for="item in filteredImportItems"
            :key="item.sourcePath"
            class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
            :class="{ 'cursor-not-allowed opacity-60': !isSelectableImportItem(item) }"
          >
            <Checkbox
              :checked="selectedImportNames.has(item.name)"
              :disabled="!isSelectableImportItem(item)"
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
            v-if="!importPreview || filteredImportItems.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{
              importPreview
                ? t('settings.skills.noResults')
                : t('settings.skills.importExport.noImportPreview')
            }}
          </div>
        </div>

        <div class="space-y-2 rounded-md border px-3 py-3">
          <div class="text-sm font-medium">{{ t('settings.skills.importExport.strategy') }}</div>
          <RadioGroup v-model="importStrategy" class="grid gap-2 sm:grid-cols-3">
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="overwrite" />
              {{ t('settings.skills.importExport.overwrite') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="rename" />
              {{ t('settings.skills.importExport.rename') }}
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

    <Dialog v-model:open="exportConfirmOpen">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ t('settings.skills.importExport.exportConfirmTitle') }}</DialogTitle>
          <DialogDescription>
            {{
              t('settings.skills.importExport.exportConfirmDescription', {
                count: exportPreview?.items.length ?? 0,
                directory: config?.skillsDirectory ?? ''
              })
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="max-h-80 overflow-y-auto rounded-md border">
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
            {{ t('settings.skills.importExport.emptyExportConfirm') }}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="exporting" @click="exportConfirmOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="exporting || !exportPreview" @click="executeExport">
            <Icon
              :icon="exporting ? 'lucide:loader-2' : 'lucide:upload'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': exporting }"
            />
            {{ t('settings.skills.importExport.confirmExport') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { useToast } from '@/components/use-toast'
import { createDeviceClient } from '@api/DeviceClient'
import { createProjectClient } from '@api/ProjectClient'
import { createSkillClient } from '@api/SkillClient'
import type {
  SkillInstallConflictStrategy,
  SkillSyncDirectoryExportPreview,
  SkillSyncDirectoryImportPreview,
  SkillSyncDirectoryPreviewItem,
  SyncDirectorySkillState
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
const projectClient = createProjectClient()
const IMPORT_PREVIEW_CACHE_TTL_MS = 2000

const activeTab = ref<'export' | 'import'>('export')
const config = ref<SkillSyncDirectoryConfig | null>(null)
const directory = ref('')
const directoryExists = ref<boolean | null>(null)
const choosingDirectory = ref(false)
const saving = ref(false)
const previewing = ref(false)
const exporting = ref(false)
const importing = ref(false)
const includeDisabled = ref(true)
const exportQuery = ref('')
const importQuery = ref('')
const importStateFilter = ref<SyncDirectorySkillState | 'all'>('all')
const selectedExportNames = ref<Set<string>>(new Set())
const selectedImportNames = ref<Set<string>>(new Set())
const exportPreview = ref<SkillSyncDirectoryExportPreview | null>(null)
const importPreview = ref<SkillSyncDirectoryImportPreview | null>(null)
const exportConfirmOpen = ref(false)
const importStrategy = ref<SkillInstallConflictStrategy>('overwrite')
const importPreviewCache = ref<{
  key: string
  preview: SkillSyncDirectoryImportPreview
  timestamp: number
} | null>(null)
const importPreviewRequestId = ref(0)
let importPreviewInFlight: {
  key: string
  promise: Promise<SkillSyncDirectoryImportPreview>
} | null = null

const skills = computed(() => props.skills.filter((skill) => skill.mutable))
const syncDirectoryReady = computed(() =>
  Boolean(config.value?.skillsDirectory && directoryExists.value)
)
const directoryPickerDisabled = computed(() => saving.value || choosingDirectory.value)
const directoryStatusIcon = computed(() => {
  if (directory.value && directoryExists.value === false) {
    return 'lucide:circle-alert'
  }
  return directory.value ? 'lucide:folder' : 'lucide:folder-open'
})
const exportCandidates = computed(() => {
  const query = normalizeQuery(exportQuery.value)
  return skills.value.filter((skill) => {
    if (!includeDisabled.value && skill.deepchatDisabled) {
      return false
    }
    return matchesSkill(skill, query)
  })
})
const filteredImportItems = computed(() => {
  const query = normalizeQuery(importQuery.value)
  return (importPreview.value?.items ?? []).filter((item) => {
    if (importStateFilter.value !== 'all' && item.state !== importStateFilter.value) {
      return false
    }
    return matchesImportItem(item, query)
  })
})
const canExport = computed(
  () =>
    Boolean(config.value) &&
    selectedExportNames.value.size > 0 &&
    !previewing.value &&
    !exporting.value
)
const canImport = computed(
  () => Boolean(config.value) && selectedImportNames.value.size > 0 && !importing.value
)

const loadConfig = async () => {
  config.value = await skillClient.getSkillsSyncConfig()
  directory.value = config.value?.skillsDirectory ?? ''
  directoryExists.value = await checkDirectoryExists(directory.value)
  if (syncDirectoryReady.value && activeTab.value === 'import') {
    await refreshImportPreview()
  }
}

const checkDirectoryExists = async (path: string) => {
  if (!path) return null
  try {
    return await projectClient.pathExists(path)
  } catch {
    return false
  }
}

const chooseDirectory = async () => {
  if (directoryPickerDisabled.value) return
  choosingDirectory.value = true
  try {
    const result = await deviceClient.selectDirectory()
    if (!result.canceled && result.filePaths[0]) {
      await saveDirectory(result.filePaths[0])
    }
  } finally {
    choosingDirectory.value = false
  }
}

const saveDirectory = async (nextDirectory: string) => {
  if (saving.value) return
  saving.value = true
  try {
    config.value = await skillClient.setSkillsSyncDirectory(nextDirectory)
    directory.value = config.value.skillsDirectory
    directoryExists.value = await checkDirectoryExists(directory.value)
    invalidateImportPreviewCache()
    importPreview.value = null
    selectedImportNames.value = new Set()
    if (syncDirectoryReady.value && activeTab.value === 'import') {
      await refreshImportPreview({ force: true })
    }
    toast({ title: t('settings.skills.importExport.saved') })
  } finally {
    saving.value = false
  }
}

const toggleExport = (name: string) => {
  selectedExportNames.value = toggleSet(selectedExportNames.value, name)
}

const toggleImport = (name: string) => {
  const item = importPreview.value?.items.find((candidate) => candidate.name === name)
  if (item && !isSelectableImportItem(item)) {
    return
  }
  selectedImportNames.value = toggleSet(selectedImportNames.value, name)
}

const setIncludeDisabled = (checked: boolean | 'indeterminate') => {
  includeDisabled.value = checked === true
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

const normalizeQuery = (value: string) => value.trim().toLowerCase()

const matchesSkill = (skill: UnifiedSkillItem, query: string) => {
  if (!query) return true
  return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
}

const matchesImportItem = (item: SkillSyncDirectoryPreviewItem, query: string) => {
  if (!query) return true
  return (
    item.name.toLowerCase().includes(query) ||
    item.sourcePath.toLowerCase().includes(query) ||
    (item.error ?? '').toLowerCase().includes(query)
  )
}

const isSelectableImportItem = (item: SkillSyncDirectoryPreviewItem) =>
  item.state !== 'invalid' && item.state !== 'same'

const selectVisibleExport = () => {
  selectedExportNames.value = new Set(exportCandidates.value.map((skill) => skill.name))
}

const clearExportSelection = () => {
  selectedExportNames.value = new Set()
}

const selectVisibleImport = () => {
  selectedImportNames.value = new Set(
    filteredImportItems.value.filter(isSelectableImportItem).map((item) => item.name)
  )
}

const clearImportSelection = () => {
  selectedImportNames.value = new Set()
}

const filterSelectedImportNames = (
  current: Set<string>,
  preview: SkillSyncDirectoryImportPreview
) => {
  const selectable = new Set(preview.items.filter(isSelectableImportItem).map((item) => item.name))
  return new Set([...current].filter((name) => selectable.has(name)))
}

const invalidateImportPreviewCache = () => {
  importPreviewCache.value = null
  importPreviewInFlight = null
}

const showPreviewError = (error: unknown) => {
  toast({
    title: t('settings.skills.sync.previewError'),
    description: error instanceof Error ? error.message : String(error),
    variant: 'destructive'
  })
}

const requestExportConfirmation = async () => {
  previewing.value = true
  try {
    exportPreview.value = await skillClient.previewSyncDirectoryExport({
      skillNames: [...selectedExportNames.value],
      includeDisabled: includeDisabled.value
    })
    exportConfirmOpen.value = true
  } catch (error) {
    exportPreview.value = null
    exportConfirmOpen.value = false
    showPreviewError(error)
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
    invalidateImportPreviewCache()
    exportConfirmOpen.value = false
    emit('completed')
  } finally {
    exporting.value = false
  }
}

const applyImportPreview = (
  preview: SkillSyncDirectoryImportPreview,
  options: { clearSelection?: boolean } = {}
) => {
  importPreview.value = preview
  selectedImportNames.value = options.clearSelection
    ? new Set()
    : filterSelectedImportNames(selectedImportNames.value, preview)
}

const refreshImportPreview = async (
  options: { force?: boolean; clearSelection?: boolean } = {}
) => {
  if (!syncDirectoryReady.value) return
  const syncDirectory = config.value?.skillsDirectory
  if (!syncDirectory) return

  const cached = importPreviewCache.value
  const now = Date.now()
  if (
    !options.force &&
    cached?.key === syncDirectory &&
    now - cached.timestamp < IMPORT_PREVIEW_CACHE_TTL_MS
  ) {
    applyImportPreview(cached.preview, options)
    return
  }

  if (!options.force && importPreviewInFlight?.key === syncDirectory) {
    try {
      const preview = await importPreviewInFlight.promise
      applyImportPreview(preview, options)
    } catch (error) {
      importPreview.value = null
      selectedImportNames.value = new Set()
      showPreviewError(error)
    }
    return
  }

  const requestId = ++importPreviewRequestId.value
  previewing.value = true
  const promise = skillClient.previewSyncDirectoryImport()
  importPreviewInFlight = { key: syncDirectory, promise }
  try {
    const preview = await promise
    importPreviewCache.value = {
      key: syncDirectory,
      preview,
      timestamp: Date.now()
    }
    if (
      requestId === importPreviewRequestId.value &&
      config.value?.skillsDirectory === syncDirectory
    ) {
      applyImportPreview(preview, options)
    }
  } catch (error) {
    if (
      requestId === importPreviewRequestId.value &&
      config.value?.skillsDirectory === syncDirectory
    ) {
      importPreview.value = null
      selectedImportNames.value = new Set()
      showPreviewError(error)
    }
  } finally {
    if (importPreviewInFlight?.promise === promise) {
      importPreviewInFlight = null
    }
    if (requestId === importPreviewRequestId.value) {
      previewing.value = false
    }
  }
}

const previewImport = async () => {
  await refreshImportPreview({ force: true })
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
    invalidateImportPreviewCache()
    selectedImportNames.value = new Set()
    await refreshImportPreview({ force: true })
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

watch([selectedExportNames, includeDisabled], () => {
  exportPreview.value = null
  exportConfirmOpen.value = false
})

watch(activeTab, (tab) => {
  if (tab === 'import') {
    void refreshImportPreview()
  }
})

onMounted(async () => {
  await loadConfig()
})
</script>
