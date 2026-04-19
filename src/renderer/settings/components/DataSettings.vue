<template>
  <ScrollArea class="w-full h-full">
    <div class="flex h-full w-full flex-col gap-4 p-4">
      <div class="rounded-xl border border-border bg-card/30 p-4">
        <div class="mb-4 flex items-center gap-2" :dir="languageStore.dir">
          <Icon icon="lucide:refresh-cw" class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">{{ t('settings.data.syncSectionTitle') }}</h2>
        </div>

        <div class="flex flex-col gap-4">
          <div
            class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:refresh-cw" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.syncEnable') }}</span>
            </span>
            <div class="shrink-0">
              <Switch :model-value="syncEnabled" @update:model-value="handleSyncEnabledChange" />
            </div>
          </div>

          <div
            class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:folder" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.syncFolder') }}</span>
            </span>
            <div class="flex w-full gap-2 lg:w-96">
              <Input
                v-model="syncFolderPath"
                :disabled="!syncStore.syncEnabled"
                class="h-8! cursor-pointer"
                @click="syncStore.selectSyncFolder"
              />
              <Button
                size="icon-sm"
                variant="outline"
                :disabled="!syncStore.syncEnabled"
                :title="t('settings.data.openSyncFolder')"
                @click="syncStore.openSyncFolder"
              >
                <Icon icon="lucide:external-link" class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            :dir="languageStore.dir"
          >
            <span class="flex flex-row items-center gap-2">
              <Icon icon="lucide:clock" class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ t('settings.data.lastSyncTime') }}</span>
            </span>
            <span class="text-sm text-muted-foreground">
              {{
                !syncStore.lastSyncTime
                  ? t('settings.data.never')
                  : new Date(syncStore.lastSyncTime).toLocaleString()
              }}
            </span>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              class="w-full sm:w-auto"
              :dir="languageStore.dir"
              :disabled="!syncStore.syncEnabled || syncStore.isBackingUp"
              @click="handleBackup"
            >
              <Icon
                :icon="syncStore.isBackingUp ? 'lucide:loader-2' : 'lucide:save'"
                class="h-4 w-4 text-muted-foreground"
                :class="syncStore.isBackingUp ? 'animate-spin' : ''"
              />
              <span class="text-sm font-medium">
                {{
                  syncStore.isBackingUp
                    ? t('settings.data.backingUp')
                    : t('settings.data.startBackup')
                }}
              </span>
            </Button>

            <Dialog v-model:open="isImportDialogOpen">
              <DialogTrigger as-child>
                <Button
                  variant="outline"
                  class="w-full sm:w-auto"
                  :disabled="!syncStore.syncEnabled"
                  :dir="languageStore.dir"
                >
                  <Icon icon="lucide:download" class="h-4 w-4 text-muted-foreground" />
                  <span class="text-sm font-medium">{{ t('settings.data.importData') }}</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{{ t('settings.data.importConfirmTitle') }}</DialogTitle>
                  <DialogDescription>
                    {{ t('settings.data.importConfirmDescription') }}
                  </DialogDescription>
                </DialogHeader>
                <div class="flex flex-col gap-4 px-4 pb-4">
                  <div class="flex flex-col gap-2">
                    <Label class="text-sm font-medium" :dir="languageStore.dir">
                      {{ t('settings.data.backupSelectLabel') }}
                    </Label>
                    <Select v-model="selectedBackup" :disabled="!availableBackups.length">
                      <SelectTrigger class="h-8!" :dir="languageStore.dir">
                        <SelectValue :placeholder="t('settings.data.selectBackupPlaceholder')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          v-for="backup in availableBackups"
                          :key="backup.fileName"
                          :value="backup.fileName"
                          :dir="languageStore.dir"
                        >
                          {{ formatBackupLabel(backup.fileName, backup.createdAt, backup.size) }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p class="text-xs text-muted-foreground" :dir="languageStore.dir">
                      {{
                        availableBackups.length
                          ? t('settings.data.backupSelectDescription')
                          : t('settings.data.noBackupsAvailable')
                      }}
                    </p>
                  </div>

                  <RadioGroup v-model="importMode" class="flex flex-col gap-2">
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="increment" />
                      <Label>{{ t('settings.data.incrementImport') }}</Label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="overwrite" />
                      <Label>{{ t('settings.data.overwriteImport') }}</Label>
                    </div>
                  </RadioGroup>
                </div>
                <DialogFooter>
                  <Button variant="outline" @click="closeImportDialog">
                    {{ t('dialog.cancel') }}
                  </Button>
                  <Button
                    variant="default"
                    :disabled="syncStore.isImporting || !selectedBackup"
                    @click="handleImport"
                  >
                    {{
                      syncStore.isImporting
                        ? t('settings.data.importing')
                        : t('settings.data.confirmImport')
                    }}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-border bg-card/30 p-4">
        <div class="mb-4 flex items-center gap-2" :dir="languageStore.dir">
          <Icon icon="lucide:wrench" class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">{{ t('settings.data.operationsSectionTitle') }}</h2>
        </div>

        <div class="flex flex-col divide-y divide-border">
          <div
            class="flex flex-col gap-3 py-4 first:pt-0 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:database" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.databaseRepair.title') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.databaseRepair.description') }}
                </p>
                <p v-if="repairSummaryText" class="text-xs text-muted-foreground">
                  {{
                    t('settings.data.databaseRepair.lastResultLabel', {
                      result: repairSummaryText
                    })
                  }}
                </p>
                <p v-if="repairManualHintText" class="text-xs text-amber-600 dark:text-amber-400">
                  {{ repairManualHintText }}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              class="w-full shrink-0 lg:w-56"
              :disabled="isRepairActionDisabled"
              :dir="languageStore.dir"
              @click="runSchemaRepair()"
            >
              <Icon
                :icon="isRepairing ? 'lucide:loader-2' : 'lucide:wrench'"
                class="h-4 w-4 text-muted-foreground"
                :class="isRepairing ? 'animate-spin' : ''"
              />
              <span class="text-sm font-medium">
                {{
                  isRepairing
                    ? t('settings.data.databaseRepair.running')
                    : t('settings.data.databaseRepair.button')
                }}
              </span>
            </Button>
          </div>

          <div
            class="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:refresh-cw" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">
                  {{ t('settings.data.modelConfigUpdate.title') }}
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.modelConfigUpdate.descriptionPrefix') }}
                  <a
                    class="inline-flex items-center gap-1 hover:text-primary"
                    :href="PUBLIC_PROVIDER_CONF_URL"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.prevent="openExternalLink(PUBLIC_PROVIDER_CONF_URL)"
                  >
                    <span>{{ t('settings.data.modelConfigUpdate.linkLabel') }}</span>
                    <Icon icon="lucide:external-link" class="h-3.5 w-3.5" />
                  </a>
                  {{ t('settings.data.modelConfigUpdate.descriptionSuffix') }}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              class="w-full shrink-0 lg:w-40"
              :disabled="isUpdatingModelConfig"
              :dir="languageStore.dir"
              @click="handleRefreshProviderDb"
            >
              <Icon
                :icon="isUpdatingModelConfig ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                class="h-4 w-4 text-muted-foreground"
                :class="isUpdatingModelConfig ? 'animate-spin' : ''"
              />
              <span class="text-sm font-medium">
                {{
                  isUpdatingModelConfig
                    ? t('settings.data.modelConfigUpdate.updating')
                    : t('settings.data.modelConfigUpdate.button')
                }}
              </span>
            </Button>
          </div>

          <div
            class="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:rotate-ccw" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.resetData') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.resetDataDescription') }}
                </p>
              </div>
            </div>
            <AlertDialog v-model:open="isResetDialogOpen">
              <AlertDialogTrigger as-child>
                <Button
                  variant="destructive"
                  class="w-full shrink-0 lg:w-48"
                  :disabled="isResetActionDisabled"
                  :dir="languageStore.dir"
                >
                  <Icon icon="lucide:rotate-ccw" class="h-4 w-4" />
                  <span class="text-sm font-medium">{{ t('settings.data.resetData') }}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{{ t('settings.data.resetConfirmTitle') }}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t('settings.data.resetConfirmDescription') }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div class="p-4">
                  <RadioGroup v-model="resetType" class="flex flex-col gap-3">
                    <div
                      class="flex cursor-pointer items-start space-x-3 rounded-lg p-2 -m-2 hover:bg-accent"
                      @click="resetType = 'chat'"
                    >
                      <RadioGroupItem value="chat" id="reset-chat" class="mt-1" />
                      <div class="flex flex-col">
                        <Label for="reset-chat" class="cursor-pointer font-medium">{{
                          t('settings.data.resetChatData')
                        }}</Label>
                        <p class="text-xs text-muted-foreground">
                          {{ t('settings.data.resetChatDataDesc') }}
                        </p>
                      </div>
                    </div>
                    <div
                      class="flex cursor-pointer items-start space-x-3 rounded-lg p-2 -m-2 hover:bg-accent"
                      @click="resetType = 'knowledge'"
                    >
                      <RadioGroupItem value="knowledge" id="reset-knowledge" class="mt-1" />
                      <div class="flex flex-col">
                        <Label for="reset-knowledge" class="cursor-pointer font-medium">{{
                          t('settings.data.resetKnowledgeData')
                        }}</Label>
                        <p class="text-xs text-muted-foreground">
                          {{ t('settings.data.resetKnowledgeDataDesc') }}
                        </p>
                      </div>
                    </div>
                    <div
                      class="flex cursor-pointer items-start space-x-3 rounded-lg p-2 -m-2 hover:bg-accent"
                      @click="resetType = 'config'"
                    >
                      <RadioGroupItem value="config" id="reset-config" class="mt-1" />
                      <div class="flex flex-col">
                        <Label for="reset-config" class="cursor-pointer font-medium">{{
                          t('settings.data.resetConfig')
                        }}</Label>
                        <p class="text-xs text-muted-foreground">
                          {{ t('settings.data.resetConfigDesc') }}
                        </p>
                      </div>
                    </div>
                    <div
                      class="flex cursor-pointer items-start space-x-3 rounded-lg p-2 -m-2 hover:bg-accent"
                      @click="resetType = 'all'"
                    >
                      <RadioGroupItem value="all" id="reset-all" class="mt-1" />
                      <div class="flex flex-col">
                        <Label for="reset-all" class="cursor-pointer font-medium">{{
                          t('settings.data.resetAll')
                        }}</Label>
                        <p class="text-xs text-muted-foreground">
                          {{ t('settings.data.resetAllDesc') }}
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel @click="closeResetDialog">
                    {{ t('dialog.cancel') }}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    :class="
                      cn(
                        'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90'
                      )
                    "
                    :disabled="isResetActionDisabled"
                    @click="handleReset"
                  >
                    {{
                      isResetting ? t('settings.data.resetting') : t('settings.data.confirmReset')
                    }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div
            class="flex flex-col gap-3 pt-4 lg:flex-row lg:items-center lg:justify-between"
            :dir="languageStore.dir"
          >
            <div class="flex gap-3">
              <Icon icon="lucide:shield" class="mt-1 h-4 w-4 text-muted-foreground" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium">{{ t('settings.data.yoBrowser.title') }}</div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.yoBrowser.description') }}
                </p>
              </div>
            </div>
            <AlertDialog v-model:open="isClearSandboxDialogOpen">
              <AlertDialogTrigger as-child>
                <Button
                  variant="outline"
                  class="w-full shrink-0 lg:w-56"
                  :disabled="isClearingSandbox"
                  :dir="languageStore.dir"
                >
                  <Icon
                    :icon="isClearingSandbox ? 'lucide:loader-2' : 'lucide:trash-2'"
                    class="h-4 w-4 text-muted-foreground"
                    :class="isClearingSandbox ? 'animate-spin' : ''"
                  />
                  <span class="text-sm font-medium">
                    {{
                      isClearingSandbox
                        ? t('settings.data.yoBrowser.clearing')
                        : t('settings.data.yoBrowser.clearButton')
                    }}
                  </span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{{
                    t('settings.data.yoBrowser.confirmTitle')
                  }}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t('settings.data.yoBrowser.confirmDescription') }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel @click="isClearSandboxDialogOpen = false">
                    {{ t('dialog.cancel') }}
                  </AlertDialogCancel>
                  <AlertDialogAction :disabled="isClearingSandbox" @click="handleClearSandboxData">
                    {{
                      isClearingSandbox
                        ? t('settings.data.yoBrowser.clearing')
                        : t('settings.data.yoBrowser.confirmAction')
                    }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <AlertDialog :open="!!syncStore.importResult && !syncStore.importResult?.success">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ t('settings.data.importErrorTitle') }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{
                syncStore.importResult?.message
                  ? t(syncStore.importResult.message, { count: syncStore.importResult.count || 0 })
                  : ''
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction @click="handleAlertAction">
              {{ t('dialog.ok') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { DatabaseRepairReport } from '@shared/presenter'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
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
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Switch } from '@shadcn/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useSyncStore } from '@/stores/sync'
import { useLanguageStore } from '@/stores/language'
import { usePresenter } from '@/composables/usePresenter'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/use-toast'

const DATABASE_REPAIR_SECTION = 'database-repair'
const SETTINGS_SECTION_EVENT = 'deepchat:settings-section'
const PUBLIC_PROVIDER_CONF_URL = 'https://github.com/ThinkInAIXYZ/PublicProviderConf'

type SettingsWindowState = Window & {
  __deepchatSettingsPendingSection?: string | null
}

type PresenterErrorResult = {
  error: string
}

const isPresenterError = (value: unknown): value is PresenterErrorResult => {
  return typeof value === 'object' && value !== null && 'error' in value
}

const { t } = useI18n()
const languageStore = useLanguageStore()
const syncStore = useSyncStore()
const devicePresenter = usePresenter('devicePresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const configPresenter = usePresenter('configPresenter')
const sqlitePresenter = usePresenter('sqlitePresenter')
const {
  backups: backupsRef,
  isBackingUp: isBackingUpRef,
  isImporting: isImportingRef
} = storeToRefs(syncStore)
const { toast } = useToast()

const isImportDialogOpen = ref(false)
const importMode = ref('increment')
const selectedBackup = ref('')

const isResetDialogOpen = ref(false)
const resetType = ref<'chat' | 'knowledge' | 'config' | 'all'>('chat')
const isResetting = ref(false)
const isUpdatingModelConfig = ref(false)
const isClearingSandbox = ref(false)
const isClearSandboxDialogOpen = ref(false)
const isRepairing = ref(false)
const lastRepairReport = ref<DatabaseRepairReport | null>(null)
const isBackupActive = computed(() => isBackingUpRef.value)
const isImporting = computed(() => isImportingRef.value)
const isRepairActionDisabled = computed(() => {
  return isRepairing.value || isBackupActive.value || isImporting.value
})
const isResetActionDisabled = computed(() => {
  return isResetting.value || isBackupActive.value || isImporting.value
})

// 使用计算属性处理双向绑定
const syncEnabled = computed({
  get: () => syncStore.syncEnabled,
  set: (value) => syncStore.setSyncEnabled(value)
})

const syncFolderPath = computed({
  get: () => syncStore.syncFolderPath,
  set: (value) => syncStore.setSyncFolderPath(value)
})

const handleSyncEnabledChange = (value: boolean) => {
  syncEnabled.value = value
}

const repairSummaryText = computed(() => {
  const report = lastRepairReport.value
  if (!report) {
    return ''
  }

  if (report.status === 'healthy') {
    return t('settings.data.databaseRepair.summaryHealthy')
  }

  const repairedCount = report.repairedIssues.length
  const manualCount = report.remainingIssues.length

  if (manualCount > 0 && repairedCount > 0) {
    return t('settings.data.databaseRepair.summaryRepairedWithManual', {
      repaired: repairedCount,
      manual: manualCount
    })
  }

  if (manualCount > 0) {
    return t('settings.data.databaseRepair.summaryManualOnly', {
      manual: manualCount
    })
  }

  return t('settings.data.databaseRepair.summaryRepaired', {
    count: repairedCount
  })
})

const repairManualHintText = computed(() => {
  const report = lastRepairReport.value
  if (!report || report.remainingIssues.length === 0) {
    return ''
  }

  return t('settings.data.databaseRepair.manualHint', {
    count: report.remainingIssues.length
  })
})

const consumePendingRepairSection = (): boolean => {
  const state = window as SettingsWindowState
  if (state.__deepchatSettingsPendingSection !== DATABASE_REPAIR_SECTION) {
    return false
  }

  state.__deepchatSettingsPendingSection = null
  return true
}

const buildRepairToastDescription = (report: DatabaseRepairReport) => {
  if (report.status === 'healthy') {
    return t('settings.data.databaseRepair.toastHealthyDescription')
  }

  if (report.remainingIssues.length > 0) {
    return t('settings.data.databaseRepair.toastManualDescription', {
      repaired: report.repairedIssues.length,
      manual: report.remainingIssues.length
    })
  }

  return t('settings.data.databaseRepair.toastRepairedDescription', {
    count: report.repairedIssues.length
  })
}

const openExternalLink = (url: string) => {
  if (window.api?.openExternal) {
    window.api.openExternal(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

const runSchemaRepair = async () => {
  if (isRepairActionDisabled.value) {
    return
  }

  isRepairing.value = true

  try {
    const result = await sqlitePresenter.repairSchema()
    if (isPresenterError(result) || !result) {
      toast({
        title: t('settings.data.databaseRepair.toastFailedTitle'),
        description: t('settings.data.databaseRepair.toastFailedDescription'),
        variant: 'destructive'
      })
      return
    }

    lastRepairReport.value = result
    toast({
      title: t(
        result.status === 'healthy'
          ? 'settings.data.databaseRepair.toastHealthyTitle'
          : 'settings.data.databaseRepair.toastCompletedTitle'
      ),
      description: buildRepairToastDescription(result),
      variant: result.remainingIssues.length > 0 ? 'destructive' : 'default'
    })
  } catch (error) {
    console.error('Failed to repair database schema:', error)
    toast({
      title: t('settings.data.databaseRepair.toastFailedTitle'),
      description: t('settings.data.databaseRepair.toastFailedDescription'),
      variant: 'destructive'
    })
  } finally {
    isRepairing.value = false
  }
}

const handleSettingsSectionNavigation = (event: Event) => {
  const detail = (event as CustomEvent<{ section?: string }>).detail
  if (detail?.section !== DATABASE_REPAIR_SECTION || isRepairActionDisabled.value) {
    return
  }

  ;(window as SettingsWindowState).__deepchatSettingsPendingSection = null
  void runSchemaRepair()
}

// 初始化
onMounted(async () => {
  await syncStore.initialize()
  window.addEventListener(SETTINGS_SECTION_EVENT, handleSettingsSectionNavigation as EventListener)

  if (!isRepairActionDisabled.value && consumePendingRepairSection()) {
    void runSchemaRepair()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener(
    SETTINGS_SECTION_EVENT,
    handleSettingsSectionNavigation as EventListener
  )
})

const availableBackups = computed(() => backupsRef.value || [])

watch(availableBackups, (backups) => {
  if (!backups.length) {
    selectedBackup.value = ''
    return
  }
  if (!selectedBackup.value || !backups.find((item) => item.fileName === selectedBackup.value)) {
    selectedBackup.value = backups[0].fileName
  }
})

watch(isImportDialogOpen, async (open) => {
  if (open) {
    await syncStore.refreshBackups()
    if (availableBackups.value.length > 0) {
      selectedBackup.value = availableBackups.value[0].fileName
    } else {
      selectedBackup.value = ''
    }
  }
})

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

const formatBackupLabel = (fileName: string, createdAt: number, size: number) => {
  const date = new Date(createdAt)
  const formatted = Number.isFinite(createdAt)
    ? `${date.toLocaleString()} (${formatBytes(size)})`
    : `${fileName} (${formatBytes(size)})`
  return formatted
}

const handleBackup = async () => {
  const backupInfo = await syncStore.startBackup()
  if (!backupInfo) {
    return
  }

  toast({
    title: t('settings.provider.toast.backupSuccessTitle'),
    description: t('settings.provider.toast.backupSuccessMessage', {
      time: new Date(backupInfo.createdAt).toLocaleString(),
      size: formatBytes(backupInfo.size)
    }),
    duration: 4000
  })
}

const handleRefreshProviderDb = async () => {
  if (isUpdatingModelConfig.value) return

  isUpdatingModelConfig.value = true
  try {
    const result = await configPresenter.refreshProviderDb(true)

    if (!result || result.status === 'error') {
      console.error('Failed to refresh provider DB:', result?.message)
      toast({
        title: t('settings.data.modelConfigUpdate.failedTitle'),
        description: t('settings.data.modelConfigUpdate.failedDescription'),
        variant: 'destructive',
        duration: 4000
      })
      return
    }

    const isUpToDate = result.status === 'not-modified' || result.status === 'skipped'
    toast({
      title: t(
        isUpToDate
          ? 'settings.data.modelConfigUpdate.upToDateTitle'
          : 'settings.data.modelConfigUpdate.updatedTitle'
      ),
      description: t(
        isUpToDate
          ? 'settings.data.modelConfigUpdate.upToDateDescription'
          : 'settings.data.modelConfigUpdate.updatedDescription'
      ),
      duration: 4000
    })
  } catch (error) {
    console.error('Failed to refresh provider DB:', error)
    toast({
      title: t('settings.data.modelConfigUpdate.failedTitle'),
      description: t('settings.data.modelConfigUpdate.failedDescription'),
      variant: 'destructive',
      duration: 4000
    })
  } finally {
    isUpdatingModelConfig.value = false
  }
}

// 关闭导入对话框
const closeImportDialog = () => {
  isImportDialogOpen.value = false
  importMode.value = 'increment' // 重置为默认值
}

// 处理导入
const handleImport = async () => {
  if (!selectedBackup.value) {
    return
  }
  const result = await syncStore.importData(
    selectedBackup.value,
    importMode.value as 'increment' | 'overwrite'
  )
  if (result?.success) {
    toast({
      title: t('settings.provider.toast.importSuccessTitle'),
      description: t('settings.provider.toast.importSuccessMessage', {
        count: result.count ?? 0
      }),
      duration: 4000
    })
  }
  closeImportDialog()
}

// 处理警告对话框的确认操作
const handleAlertAction = () => {
  syncStore.clearImportResult()
}

const closeResetDialog = () => {
  isResetDialogOpen.value = false
  resetType.value = 'chat'
}

const handleReset = async () => {
  if (isResetActionDisabled.value) return

  isResetting.value = true
  try {
    await devicePresenter.resetDataByType(resetType.value)
    closeResetDialog()
  } catch (error) {
    console.error('重置数据失败:', error)
  } finally {
    isResetting.value = false
  }
}

const handleClearSandboxData = async () => {
  if (isClearingSandbox.value) return

  isClearingSandbox.value = true
  try {
    await yoBrowserPresenter.clearSandboxData()
    toast({
      title: t('settings.data.yoBrowser.clearedTitle'),
      description: t('settings.data.yoBrowser.clearedDescription'),
      duration: 4000
    })
  } catch (error) {
    console.error('Failed to clear YoBrowser sandbox data:', error)
    toast({
      title: t('settings.data.yoBrowser.clearFailedTitle'),
      description: t('settings.data.yoBrowser.clearFailedDescription'),
      variant: 'destructive',
      duration: 4000
    })
  } finally {
    isClearingSandbox.value = false
    isClearSandboxDialogOpen.value = false
  }
}
</script>
