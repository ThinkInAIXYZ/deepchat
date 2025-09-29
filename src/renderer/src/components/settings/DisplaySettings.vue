<template>
  <ScrollArea class="w-full h-full p-2">
    <div class="w-full h-full flex flex-col gap-1.5">
      <!-- 语言选择 -->
      <div class="flex items-center gap-3 px-2 py-2">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:languages" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.common.language') }}</span>
        </span>
        <div class="ml-auto w-auto">
          <Select v-model="selectedLanguage">
            <SelectTrigger>
              <SelectValue :placeholder="t('settings.common.languageSelect')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="lang in languageOptions"
                :key="lang.value"
                :value="lang.value"
                :dir="languageStore.dir"
              >
                {{ lang.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <!-- 系统通知设置 -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:bell" class="w-4 h-4 text-muted-foreground" />
            <span class="truncate">{{ t('settings.common.notifications') || '系统通知' }}</span>
          </span>
          <div class="ml-auto">
            <Switch
              id="notifications-switch"
              :model-value="notificationsEnabled"
              @update:model-value="handleNotificationsChange"
            />
          </div>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.common.notificationsDesc') }}
        </div>
      </div>

      <!-- 字体大小设置 -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:a-large-small" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.display.fontSize') }}</span>
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            v-for="(sizeOption, index) in fontSizeOptions"
            :key="index"
            :variant="fontSizeLevel === index ? 'default' : 'outline'"
            size="sm"
            class="px-2 py-1.5 text-xs shrink-0"
            @click="fontSizeLevel = index"
          >
            {{ t('settings.display.' + sizeOption) }}
          </Button>
        </div>
      </div>

      <!-- 投屏保护开关 -->
      <div class="flex items-center gap-3 px-2 py-2">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:monitor" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.common.contentProtection') || '投屏保护' }}</span>
        </span>
        <div class="ml-auto">
          <Switch
            id="content-protection-switch"
            :model-value="contentProtectionEnabled"
            @update:model-value="handleContentProtectionChange"
          />
        </div>
      </div>

      <!-- 悬浮按钮开关 -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:mouse-pointer-click" class="w-4 h-4 text-muted-foreground" />
            <span class="truncate">{{ t('settings.display.floatingButton') }}</span>
          </span>
          <div class="ml-auto">
            <Switch
              id="floating-button-switch"
              :model-value="floatingButtonStore.enabled"
              @update:model-value="handleFloatingButtonChange"
            />
          </div>
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.display.floatingButtonDesc') }}
        </div>
      </div>
    </div>
  </ScrollArea>

  <!-- 投屏保护切换确认对话框 -->
  <Dialog v-model:open="isContentProtectionDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{
          t('settings.common.contentProtectionDialogTitle') || '确认切换投屏保护'
        }}</DialogTitle>
        <DialogDescription>
          <template v-if="newContentProtectionValue">
            {{ t('settings.common.contentProtectionEnableDesc') }}
          </template>
          <template v-else>
            {{ t('settings.common.contentProtectionDisableDesc') }}
          </template>
          <div class="mt-2 font-medium">
            {{ t('settings.common.contentProtectionRestartNotice') }}
          </div>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="cancelContentProtectionChange">
          {{ t('common.cancel') }}
        </Button>
        <Button
          :variant="newContentProtectionValue ? 'default' : 'destructive'"
          @click="confirmContentProtectionChange"
        >
          {{ t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ref, onMounted, watch, computed } from 'vue'

import { useSettingsStore } from '@/stores/settings'
import { useLanguageStore } from '@/stores/language'
import { useFloatingButtonStore } from '@/stores/floatingButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'

const languageStore = useLanguageStore()
const settingsStore = useSettingsStore()
const floatingButtonStore = useFloatingButtonStore()
const { t } = useI18n()

// --- Language Settings ---
const selectedLanguage = ref('system')
const languageOptions = [
  { value: 'system', label: t('common.languageSystem') || '跟随系统' }, // 使用i18n key 或 默认值
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'zh-TW', label: '繁體中文（台灣）' },
  { value: 'zh-HK', label: '繁體中文（香港）' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'fa-IR', label: 'فارسی (ایران)' }
]

watch(selectedLanguage, async (newValue) => {
  console.log('selectedLanguage', newValue)
  await languageStore.updateLanguage(newValue)
})

// --- Font Size Settings ---
const fontSizeOptions = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']

const fontSizeLevel = computed({
  get: () => settingsStore.fontSizeLevel,
  set: (value) => settingsStore.updateFontSizeLevel(value)
})

// --- Content Protection Settings ---
const contentProtectionEnabled = computed({
  get: () => {
    return settingsStore.contentProtectionEnabled
  },
  set: () => {
    // Setter handled by handleContentProtectionChange
  }
})
const isContentProtectionDialogOpen = ref(false)
const newContentProtectionValue = ref(false)

const handleContentProtectionChange = (value: boolean) => {
  console.log('准备切换投屏保护状态:', value)
  newContentProtectionValue.value = value
  isContentProtectionDialogOpen.value = true
}

const cancelContentProtectionChange = () => {
  isContentProtectionDialogOpen.value = false
}

const confirmContentProtectionChange = () => {
  settingsStore.setContentProtectionEnabled(newContentProtectionValue.value)
  isContentProtectionDialogOpen.value = false
}

// --- Notifications Settings ---
const notificationsEnabled = computed({
  get: () => settingsStore.notificationsEnabled,
  set: (value) => settingsStore.setNotificationsEnabled(value)
})

const handleNotificationsChange = (value: boolean) => {
  settingsStore.setNotificationsEnabled(value)
}

const handleFloatingButtonChange = (value: boolean) => {
  floatingButtonStore.setFloatingButtonEnabled(value)
}

// --- Lifecycle ---
onMounted(async () => {
  selectedLanguage.value = languageStore.language
})
</script>
