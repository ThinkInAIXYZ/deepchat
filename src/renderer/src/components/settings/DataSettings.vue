<template>
  <ScrollArea class="w-full h-full p-2">
    <div class="w-full h-full flex flex-col gap-1.5">
      <!-- 同步功能开关 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="languageStore.dir">
          <Icon icon="lucide:refresh-cw" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.data.syncEnable') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Switch v-model:checked="syncEnabled" />
        </div>
      </div>

      <!-- 同步文件夹设置 -->
      <div class="flex flex-col p-2 gap-2 px-2">
        <div class="flex flex-row items-center gap-2">
          <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="languageStore.dir">
            <Icon icon="lucide:folder" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.data.syncFolder') }}</span>
          </span>
          <div class="flex-shrink-0 w-96 flex gap-2">
            <Input
              v-model="syncFolderPath"
              :disabled="!syncStore.syncEnabled"
              class="cursor-pointer"
              @click="syncStore.selectSyncFolder"
            />
            <Button
              size="icon"
              variant="outline"
              :disabled="!syncStore.syncEnabled"
              title="打开同步文件夹"
              @click="syncStore.openSyncFolder"
            >
              <Icon icon="lucide:external-link" class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 上次同步时间 -->
      <div class="p-2 flex flex-row items-center gap-2" :dir="languageStore.dir">
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

      <!-- 手动备份 -->
      <div
        class="p-2 flex flex-row items-center gap-2 hover:bg-accent rounded-lg cursor-pointer"
        :class="{
          'opacity-50 cursor-not-allowed': !syncStore.syncEnabled || syncStore.isBackingUp
        }"
        :dir="languageStore.dir"
        @click="syncStore.startBackup"
      >
        <Icon icon="lucide:save" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-medium">{{ t('settings.data.startBackup') }}</span>
        <span v-if="syncStore.isBackingUp" class="text-xs text-muted-foreground ml-2">
          ({{ t('settings.data.backingUp') }})
        </span>
      </div>

      <!-- 导入数据 -->
      <Dialog v-model:open="isImportDialogOpen">
        <DialogTrigger as-child>
          <div
            class="p-2 flex flex-row items-center gap-2 hover:bg-accent rounded-lg cursor-pointer"
            :class="{ 'opacity-50 cursor-not-allowed': !syncStore.syncEnabled }"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:download" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.data.importData') }}</span>
          </div>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('settings.data.importConfirmTitle') }}</DialogTitle>
            <DialogDescription>
              {{ t('settings.data.importConfirmDescription') }}
            </DialogDescription>
          </DialogHeader>
          <div class="p-4">
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
            <Button variant="default" :disabled="syncStore.isImporting" @click="handleImport">
              {{
                syncStore.isImporting
                  ? t('settings.data.importing')
                  : t('settings.data.confirmImport')
              }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- 分割线 -->
      <Separator class="my-4" />

      <!-- 数据重置选项 -->
      <AlertDialog v-model:open="isResetDialogOpen">
        <AlertDialogTrigger as-child>
          <div
            class="p-2 flex flex-row items-center gap-2 hover:bg-accent rounded-lg cursor-pointer"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:rotate-ccw" class="w-4 h-4 text-destructive" />
            <span class="text-sm font-medium text-destructive">{{
              t('settings.data.resetData')
            }}</span>
          </div>
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
              {{ syncStore.importResult?.message ? t(syncStore.importResult.message) : '' }}
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { ref, onMounted, computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useSyncStore } from '@/stores/sync'
import { useLanguageStore } from '@/stores/language'
import { usePresenter } from '@/composables/usePresenter'
import { cn } from '@/lib/utils'

const { t } = useI18n()
const languageStore = useLanguageStore()
const syncStore = useSyncStore()
const devicePresenter = usePresenter('devicePresenter')

const isImportDialogOpen = ref(false)
const importMode = ref('increment')

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

// 初始化
onMounted(async () => {
  await syncStore.initialize()
})

// 关闭导入对话框
const closeImportDialog = () => {
  isImportDialogOpen.value = false
  importMode.value = 'increment' // 重置为默认值
}

// 处理导入
const handleImport = async () => {
  await syncStore.importData(importMode.value as 'increment' | 'overwrite')
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
