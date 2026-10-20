<template>
  <SettingsPageShell
    :title="t('routes.settings-display')"
    :eyebrow="t('settings.controlCenter.groups.setup')"
    data-testid="settings-appearance-page"
  >
    <DcSectionCard class="divide-y divide-border [&>div]:py-4">
      <!-- Theme settings -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-2 text-sm font-medium min-w-0 flex-1"
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
            data-testid="theme-toggle"
            :data-theme-mode="option.value"
            class="group relative flex w-full max-w-[180px] basis-[140px] flex-1 flex-col items-center text-left outline-none transition disabled:cursor-not-allowed disabled:opacity-80"
            :aria-pressed="themeMode === option.value"
            :disabled="isUpdatingTheme"
            @click="selectThemeMode(option.value)"
          >
            <div
              class="relative flex h-24 w-full overflow-hidden rounded-lg border p-2 transition-colors"
              :class="
                themeMode === option.value
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border group-hover:border-input'
              "
            >
              <div
                v-for="previewMode in option.value === 'system'
                  ? ['light', 'dark']
                  : [option.value]"
                :key="previewMode"
                aria-hidden="true"
                class="flex min-w-0 flex-1 overflow-hidden rounded-sm border border-base-500/20"
                :class="previewMode === 'dark' ? 'bg-base-950' : 'bg-base-50'"
              >
                <div
                  class="w-1/4 space-y-1 p-1.5"
                  :class="previewMode === 'dark' ? 'bg-base-800' : 'bg-base-200'"
                >
                  <div class="h-1 rounded-sm bg-primary/60" />
                  <div class="h-1 rounded-sm bg-base-500/25" />
                  <div class="h-1 rounded-sm bg-base-500/25" />
                </div>
                <div class="flex min-w-0 flex-1 flex-col gap-1 p-2">
                  <div class="h-1 w-3/4 rounded-sm bg-base-500/50" />
                  <div class="h-1 w-full rounded-sm bg-base-500/25" />
                  <div
                    class="mt-auto flex h-4 items-end justify-end rounded-sm border border-base-500/30 p-0.5"
                  >
                    <span class="size-2 rounded-sm bg-primary" />
                  </div>
                </div>
              </div>
              <span
                v-if="themeMode === option.value"
                class="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Icon icon="lucide:check" class="size-3" />
              </span>
            </div>
            <div class="mt-2 text-xs font-medium text-foreground">
              {{ option.label }}
            </div>
          </button>
        </div>
      </div>

      <!-- Language selection -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-2 text-sm font-medium min-w-0 flex-1"
            :dir="languageStore.dir"
          >
            <Icon icon="lucide:languages" class="w-4 h-4 text-muted-foreground" />
            <span class="truncate">{{ t('settings.common.language') }}</span>
          </span>
          <div class="ml-auto w-auto">
            <Select v-model="selectedLanguage">
              <SelectTrigger
                data-testid="language-select"
                :aria-label="t('settings.common.language')"
                class="h-8!"
              >
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
      </div>

      <!-- System notifications -->
      <DcToggleRow
        id="notifications-switch"
        icon="lucide:bell"
        :label="t('settings.common.notifications')"
        :description="t('settings.common.notificationsDesc')"
        label-min-width="220px"
        :model-value="notificationsEnabled"
        class="px-2 py-2"
        @update:model-value="handleNotificationsChange"
      />

      <!-- Font size settings -->
      <div class="flex flex-col gap-2 px-2 py-2">
        <span
          class="flex items-center gap-2 text-sm font-medium min-w-0 flex-1"
          :dir="languageStore.dir"
        >
          <Icon icon="lucide:a-large-small" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.display.fontSize') }}</span>
        </span>
        <ButtonGroup class="flex-wrap" :aria-label="t('settings.display.fontSize')">
          <DcButton
            v-for="(sizeOption, index) in fontSizeOptions"
            :key="index"
            :aria-pressed="fontSizeLevel === index"
            :variant="fontSizeLevel === index ? 'default' : 'outline'"
            size="sm"
            class="px-2 py-1.5 text-xs shrink-0"
            @click="fontSizeLevel = index"
          >
            {{ t('settings.display.' + sizeOption) }}
          </DcButton>
        </ButtonGroup>
      </div>

      <FontSettingsSection />

      <!-- Content protection toggle -->
      <DcToggleRow
        id="content-protection-switch"
        icon="lucide:monitor"
        :label="t('settings.common.contentProtection')"
        label-min-width="220px"
        :model-value="contentProtectionEnabled"
        class="px-2 py-2"
        @update:model-value="handleContentProtectionChange"
      />

      <!-- Floating button toggle -->
      <DcToggleRow
        v-if="FLOATING_BUTTON_AVAILABLE"
        id="floating-button-switch"
        icon="lucide:mouse-pointer-click"
        :label="t('settings.display.floatingButton')"
        :description="t('settings.display.floatingButtonDesc')"
        label-min-width="220px"
        :model-value="floatingButtonStore.enabled"
        class="px-2 py-2"
        @update:model-value="handleFloatingButtonChange"
      />
    </DcSectionCard>
  </SettingsPageShell>

  <!-- Content protection confirmation dialog -->
  <Dialog v-model:open="isContentProtectionDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('settings.common.contentProtectionDialogTitle') }}</DialogTitle>
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
        <DcButton variant="outline" @click="cancelContentProtectionChange">
          {{ t('common.cancel') }}
        </DcButton>
        <DcButton
          :variant="newContentProtectionValue ? 'default' : 'destructive'"
          @click="confirmContentProtectionChange"
        >
          {{ t('common.confirm') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { ref, onMounted, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { DcToggleRow } from '@dc-ui/components/toggle-row'
import { DcSectionCard } from '@dc-ui/components/section-card'

import { FLOATING_BUTTON_AVAILABLE } from '@shared/featureFlags'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
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
import { DcButton } from '@dc-ui/components/button'
import { ButtonGroup } from '@shadcn/components/ui/button-group'
import FontSettingsSection from './display/FontSettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES, type RequestedLocale } from '@shared/locales'

const languageStore = useLanguageStore()
const uiSettingsStore = useUiSettingsStore()
const floatingButtonStore = useFloatingButtonStore()
const themeStore = useThemeStore()
const { t } = useI18n()
const { themeMode } = storeToRefs(themeStore)

// --- Language Settings ---
const selectedLanguage = ref<RequestedLocale>('system')
const languageOptions = [
  { value: 'system', label: t('common.languageSystem') || 'System' },
  ...SUPPORTED_LOCALES.map((value) => ({ value, label: LOCALE_DISPLAY_NAMES[value] }))
]

watch(selectedLanguage, async (newValue) => {
  console.log('selectedLanguage', newValue)
  await languageStore.updateLanguage(newValue)
})

// --- Theme Settings ---
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
  get: () => uiSettingsStore.fontSizeLevel,
  set: (value) => uiSettingsStore.updateFontSizeLevel(value)
})

// --- Content Protection Settings ---
const contentProtectionEnabled = computed({
  get: () => {
    return uiSettingsStore.contentProtectionEnabled
  },
  set: () => {
    // Setter handled by handleContentProtectionChange.
  }
})
const isContentProtectionDialogOpen = ref(false)
const newContentProtectionValue = ref(false)

const handleContentProtectionChange = (value: boolean) => {
  console.log('Preparing to change content protection state:', value)
  newContentProtectionValue.value = value
  isContentProtectionDialogOpen.value = true
}

const cancelContentProtectionChange = () => {
  isContentProtectionDialogOpen.value = false
}

const confirmContentProtectionChange = () => {
  uiSettingsStore.setContentProtectionEnabled(newContentProtectionValue.value)
  isContentProtectionDialogOpen.value = false
}

// --- Notifications Settings ---
const notificationsEnabled = computed({
  get: () => uiSettingsStore.notificationsEnabled,
  set: (value) => uiSettingsStore.setNotificationsEnabled(value)
})

const handleNotificationsChange = (value: boolean) => {
  uiSettingsStore.setNotificationsEnabled(value)
}

const handleFloatingButtonChange = (value: boolean) => {
  floatingButtonStore.setFloatingButtonEnabled(value)
}

onMounted(async () => {
  selectedLanguage.value = languageStore.language
})
</script>
