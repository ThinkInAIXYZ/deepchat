<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-1.5 p-4">
      <!-- 同步功能开关 -->
      <div class="flex flex-row items-center gap-2 h-10">
        <span class="flex flex-row items-center gap-2 grow w-full" :dir="languageStore.dir">
          <Icon icon="lucide:refresh-cw" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.data.syncEnable') }}</span>
        </span>
        <div class="shrink-0">
          <Switch :model-value="syncEnabled" @update:model-value="handleSyncEnabledChange" />
        </div>
      </div>

      <!-- 同步文件夹设置 -->
      <div class="flex flex-row items-center gap-2 h-10">
        <span class="flex flex-row items-center gap-2 grow w-full" :dir="languageStore.dir">
          <Icon icon="lucide:folder" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.data.syncFolder') }}</span>
        </span>
        <div class="shrink-0 w-96 flex gap-2">
          <Input
            v-model="syncFolderPath"
            :disabled="!syncStore.syncEnabled"
            class="cursor-pointer h-8!"
            @click="syncStore.selectSyncFolder"
          />
          <Button
            size="icon-sm"
            variant="outline"
            :disabled="!syncStore.syncEnabled"
            title="打开同步文件夹"
            @click="syncStore.openSyncFolder"
          >
            <Icon icon="lucide:external-link" class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <!-- 上次同步时间 -->
      <div class="flex flex-row items-center gap-2 h-10" :dir="languageStore.dir">
        <Icon icon="lucide:clock" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-medium">{{ t('settings.data.lastSyncTime') }}:</span>
        <span class="text-sm text-muted-foreground">
          {{
            !syncStore.lastSyncTime
              ? t('settings.data.never')
              : new Date(syncStore.lastSyncTime).toLocaleString()
          }}
        </span>
      </div>

      <div class="flex flex-row gap-2">
        <Button
          variant="outline"
          @click="handleBackup"
          :disabled="!syncStore.syncEnabled || syncStore.isBackingUp"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:save" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.data.startBackup') }}</span>
          <span v-if="syncStore.isBackingUp" class="text-xs text-muted-foreground ml-2">
            ({{ t('settings.data.backingUp') }})
          </span>
        </Button>

        <!-- 导入数据 -->
        <Dialog v-model:open="isImportDialogOpen">
          <DialogTrigger as-child>
            <Button variant="outline" :disabled="!syncStore.syncEnabled" :dir="languageStore.dir">
              <Icon icon="lucide:download" class="w-4 h-4 text-muted-foreground" />
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
            <div class="px-4 pb-4 flex flex-col gap-4">
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

      <!-- 分割线 -->
      <Separator class="my-4" />

      <!-- 数据重置选项 -->
      <AlertDialog v-model:open="isResetDialogOpen">
        <AlertDialogTrigger as-child>
          <Button
            variant="destructive"
            class="w-48"
            :disabled="!syncStore.syncEnabled || syncStore.isBackingUp"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:rotate-ccw" class="w-4 h-4" />
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
                class="flex items-start space-x-3 cursor-pointer hover:bg-accent rounded-lg p-2 -m-2"
                @click="resetType = 'chat'"
              >
                <RadioGroupItem value="chat" id="reset-chat" class="mt-1" />
                <div class="flex flex-col">
                  <Label for="reset-chat" class="font-medium cursor-pointer">{{
                    t('settings.data.resetChatData')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.data.resetChatDataDesc') }}
                  </p>
                </div>
              </div>
              <div
                class="flex items-start space-x-3 cursor-pointer hover:bg-accent rounded-lg p-2 -m-2"
                @click="resetType = 'knowledge'"
              >
                <RadioGroupItem value="knowledge" id="reset-knowledge" class="mt-1" />
                <div class="flex flex-col">
                  <Label for="reset-knowledge" class="font-medium cursor-pointer">{{
                    t('settings.data.resetKnowledgeData')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.data.resetKnowledgeDataDesc') }}
                  </p>
                </div>
              </div>
              <div
                class="flex items-start space-x-3 cursor-pointer hover:bg-accent rounded-lg p-2 -m-2"
                @click="resetType = 'config'"
              >
                <RadioGroupItem value="config" id="reset-config" class="mt-1" />
                <div class="flex flex-col">
                  <Label for="reset-config" class="font-medium cursor-pointer">{{
                    t('settings.data.resetConfig')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.data.resetConfigDesc') }}
                  </p>
                </div>
              </div>
              <div
                class="flex items-start space-x-3 cursor-pointer hover:bg-accent rounded-lg p-2 -m-2"
                @click="resetType = 'all'"
              >
                <RadioGroupItem value="all" id="reset-all" class="mt-1" />
                <div class="flex flex-col">
                  <Label for="reset-all" class="font-medium cursor-pointer">{{
                    t('settings.data.resetAll')
                  }}</Label>
                  <p class="text-xs text-muted-foreground">{{ t('settings.data.resetAllDesc') }}</p>
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
                cn('bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90')
              "
              :disabled="isResetting"
              @click="handleReset"
            >
              {{ isResetting ? t('settings.data.resetting') : t('settings.data.confirmReset') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog :open="!!syncStore.importResult">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{
              syncStore.importResult?.success
                ? t('settings.data.importSuccessTitle')
                : t('settings.data.importErrorTitle')
            }}</AlertDialogTitle>
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
import { ref, onMounted, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
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
import { Separator } from '@shadcn/components/ui/separator'
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

const { t } = useI18n()
const languageStore = useLanguageStore()
const syncStore = useSyncStore()
const devicePresenter = usePresenter('devicePresenter')
const { backups: backupsRef } = storeToRefs(syncStore)
const { toast } = useToast()

const isImportDialogOpen = ref(false)
const importMode = ref('increment')
const selectedBackup = ref('')

const isResetDialogOpen = ref(false)
const resetType = ref<'chat' | 'knowledge' | 'config' | 'all'>('chat')
const isResetting = ref(false)

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

// 初始化
onMounted(async () => {
  await syncStore.initialize()
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
    title: t('settings.data.toast.backupSuccessTitle'),
    description: t('settings.data.toast.backupSuccessMessage', {
      time: new Date(backupInfo.createdAt).toLocaleString(),
      size: formatBytes(backupInfo.size)
    }),
    duration: 4000
  })
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
      title: t('settings.data.toast.importSuccessTitle'),
      description: t('settings.data.toast.importSuccessMessage', {
        count: result.count ?? 0
      }),
      duration: 4000
    })
  }
  closeImportDialog()
}

// 处理警告对话框的确认操作
const handleAlertAction = () => {
  // 如果导入成功，则重启应用
  console.log(syncStore.importResult)
  if (syncStore.importResult?.success) {
    syncStore.restartApp()
  }
  syncStore.clearImportResult()
}

const closeResetDialog = () => {
  isResetDialogOpen.value = false
  resetType.value = 'chat'
}

const handleReset = async () => {
  if (isResetting.value) return

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
</script>
