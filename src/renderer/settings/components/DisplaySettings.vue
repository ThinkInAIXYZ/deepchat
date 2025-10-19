<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-1.5 p-4">
      <!-- 语言选择 -->
      <div class="flex items-center gap-3 h-10">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:languages" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.common.language') }}</span>
        </span>
        <div class="ml-auto w-auto">
          <Select v-model="selectedLanguage">
            <SelectTrigger class="h-8!">
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

      <!-- 主题设置 -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:sun-moon" class="w-4 h-4 text-muted-foreground" />
            <span class="truncate">{{ t('settings.common.theme') }}</span>
          </span>
          <span class="ml-auto text-xs text-muted-foreground">
            {{ t('settings.common.themeSelect') }}
          </span>
        </div>
        <div class="flex flex-wrap gap-3">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            class="group relative flex w-full max-w-[120px] basis-[120px] flex-col items-center text-left outline-none transition disabled:cursor-not-allowed disabled:opacity-80"
            :aria-pressed="themeMode === option.value"
            :disabled="isUpdatingTheme"
            @click="selectThemeMode(option.value)"
          >
            <div
              :class="[
                'relative h-28 w-full rounded-xl border transition-all duration-200',
                themeMode === option.value
                  ? 'border-primary shadow-[0_18px_36px_-20px_rgba(59,130,246,0.7)] ring-2 ring-primary/30'
                  : 'border-border/70 bg-background/30 group-hover:border-muted-foreground/60 group-hover:bg-background/50'
              ]"
            >
              <span
                v-if="themeMode === option.value"
                class="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30"
              >
                <Icon icon="lucide:check" class="h-3.5 w-3.5" />
              </span>
              <div class="absolute inset-2 rounded-[14px]">
                <template v-if="option.value !== 'system'">
                  <div
                    :class="[
                      'flex h-full w-full flex-col overflow-hidden rounded-[12px] border',
                      themePreviewStyles[option.value].window
                    ]"
                  >
                    <div
                      :class="[
                        'flex items-center gap-1 rounded-t-[12px] border-b px-2.5 py-1.5',
                        themePreviewStyles[option.value].toolbar
                      ]"
                    >
                      <span class="h-2 w-2 rounded-full bg-red-400/90"></span>
                      <span class="h-2 w-2 rounded-full bg-amber-400/90"></span>
                      <span class="h-2 w-2 rounded-full bg-emerald-400/90"></span>
                    </div>
                    <div class="flex flex-1">
                      <div
                        :class="[
                          'flex w-14 shrink-0 flex-col gap-1.5 border-r p-2',
                          themePreviewStyles[option.value].sidebar
                        ]"
                      >
                        <span
                          v-for="index in 3"
                          :key="'sidebar-' + index"
                          :class="[
                            'h-2 rounded-full',
                            index === 1
                              ? themePreviewStyles[option.value].accent
                              : themePreviewStyles[option.value].muted
                          ]"
                        ></span>
                      </div>
                      <div
                        :class="[
                          'flex flex-1 flex-col gap-1.5 p-2.5',
                          themePreviewStyles[option.value].content
                        ]"
                      >
                        <span
                          v-for="index in 3"
                          :key="'content-' + index"
                          :class="[
                            'h-2.5 rounded-full',
                            index === 1
                              ? themePreviewStyles[option.value].accent
                              : themePreviewStyles[option.value].text
                          ]"
                        ></span>
                        <div
                          :class="[
                            'mt-auto h-2 w-1/2 rounded-full',
                            themePreviewStyles[option.value].muted
                          ]"
                        ></div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div
                    class="grid h-full w-full grid-cols-2 overflow-hidden rounded-[12px] bg-gradient-to-br from-slate-900/70 via-background/80 to-white/90"
                  >
                    <div class="flex flex-col gap-1.5 bg-slate-950/80 p-2">
                      <span
                        class="flex items-center gap-1 text-[10px] font-medium text-slate-200/90"
                      >
                        <span class="h-2 w-2 rounded-full bg-sky-400/80"></span>
                        Dark
                      </span>
                      <span class="h-2 rounded-full bg-sky-400/70"></span>
                      <span class="h-2 rounded-full bg-slate-700/70"></span>
                      <span class="h-2 rounded-full bg-slate-700/70"></span>
                      <div class="mt-auto h-2 w-1/2 rounded-full bg-slate-800/70"></div>
                    </div>
                    <div class="flex flex-col gap-1.5 bg-white/95 p-2">
                      <span class="flex items-center gap-1 text-[10px] font-medium text-slate-600">
                        <span class="h-2 w-2 rounded-full bg-blue-500/70"></span>
                        Light
                      </span>
                      <span class="h-2 rounded-full bg-blue-500/60"></span>
                      <span class="h-2 rounded-full bg-slate-200/80"></span>
                      <span class="h-2 rounded-full bg-slate-200/80"></span>
                      <div class="mt-auto h-2 w-1/2 rounded-full bg-slate-300/80"></div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
            <div class="mt-2 text-xs font-medium text-foreground">
              {{ option.label }}
            </div>
          </button>
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
        <ButtonGroup class="flex-wrap">
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
        </ButtonGroup>
      </div>

      <!-- 代码字体大小设置 -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:code" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.display.codeFontSize') }}</span>
        </span>
        <ButtonGroup class="flex-wrap">
          <Button
            v-for="(sizeOption, index) in codeFontSizeOptions"
            :key="index"
            :variant="codeFontSizeLevel === index ? 'default' : 'outline'"
            size="sm"
            class="px-2 py-1.5 text-xs shrink-0"
            @click="codeFontSizeLevel = index"
          >
            {{ sizeOption }}
          </Button>
        </ButtonGroup>
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
import { storeToRefs } from 'pinia'

import { useSettingsStore } from '@/stores/settings'
import { useLanguageStore } from '@/stores/language'
import { useFloatingButtonStore } from '@/stores/floatingButton'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { ButtonGroup } from '@shadcn/components/ui/button-group'
import { Switch } from '@shadcn/components/ui/switch'

const languageStore = useLanguageStore()
const settingsStore = useSettingsStore()
const floatingButtonStore = useFloatingButtonStore()
const themeStore = useThemeStore()
const { t } = useI18n()
const { themeMode } = storeToRefs(themeStore)

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
  { value: 'fa-IR', label: 'فارسی (ایران)' },
  { value: 'pt-BR', label: 'Português (Brasil)' }
]

watch(selectedLanguage, async (newValue) => {
  console.log('selectedLanguage', newValue)
  await languageStore.updateLanguage(newValue)
})

// --- Theme Settings ---
type ThemePreviewMode = Exclude<ThemeMode, 'system'>

const themePreviewStyles: Record<
  ThemePreviewMode,
  {
    window: string
    toolbar: string
    sidebar: string
    content: string
    accent: string
    muted: string
    text: string
  }
> = {
  light: {
    window: 'border-slate-200/80 bg-gradient-to-b from-white via-slate-50 to-slate-100',
    toolbar: 'border-slate-200/80 bg-white/90',
    sidebar: 'border-slate-200/80 bg-white/90',
    content: 'bg-slate-50/80',
    accent: 'bg-blue-500/70',
    muted: 'bg-slate-200/80',
    text: 'bg-slate-300/80'
  },
  dark: {
    window: 'border-slate-800/70 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800',
    toolbar: 'border-slate-800/80 bg-slate-900/90',
    sidebar: 'border-slate-800/80 bg-slate-900/70',
    content: 'bg-slate-900/70',
    accent: 'bg-sky-400/70',
    muted: 'bg-slate-700/70',
    text: 'bg-slate-600/70'
  }
}

const themeOptions = computed(() => [
  { value: 'light' as ThemeMode, label: t('settings.common.themeLight') },
  { value: 'dark' as ThemeMode, label: t('settings.common.themeDark') },
  { value: 'system' as ThemeMode, label: t('settings.common.themeSystem') }
])

const isUpdatingTheme = ref(false)

const selectThemeMode = async (mode: ThemeMode) => {
  if (themeMode.value === mode || isUpdatingTheme.value) return
  isUpdatingTheme.value = true
  try {
    await themeStore.setThemeMode(mode)
  } catch (error) {
    console.error('Failed to update theme mode', error)
  } finally {
    isUpdatingTheme.value = false
  }
}

// --- Font Size Settings ---
const fontSizeOptions = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']

const fontSizeLevel = computed({
  get: () => settingsStore.fontSizeLevel,
  set: (value) => settingsStore.updateFontSizeLevel(value)
})

// --- Code Font Size Settings ---
const codeFontSizeOptions = ['12px', '14px', '16px', '18px', '20px']

const codeFontSizeLevel = computed({
  get: () => settingsStore.codeFontSizeLevel,
  set: (value) => settingsStore.updateCodeFontSizeLevel(value)
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
