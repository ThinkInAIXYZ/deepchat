<template>
  <SettingsPageShell
    :title="t('settings.shortcuts.title')"
    :eyebrow="t('settings.controlCenter.groups.system')"
    data-testid="settings-shortcut-page"
  >
    <template #actions>
      <Button variant="outline" size="sm" @click="resetShortcutKeys()">
        <Loader2 v-if="resetLoading" class="mr-1 h-4 w-4 animate-spin" />
        <Icon v-else icon="lucide:refresh-cw" class="w-4 h-4 mr-1" />
        {{ t('common.resetData') }}
      </Button>
    </template>

    <div class="flex flex-col gap-4">
      <div
        v-for="shortcut in shortcuts"
        :key="shortcut.id"
        :data-testid="`shortcut-row-${shortcut.id}`"
        class="flex flex-row items-center"
      >
        <span class="flex flex-row items-center gap-2 grow" :dir="languageStore.dir">
          <Icon :icon="shortcut.icon" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t(shortcut.label) }}</span>
        </span>

        <div class="shrink-0 min-w-[240px]" :data-testid="`shortcut-value-${shortcut.id}`">
          <div
            class="group flex items-center gap-3 rounded-md border bg-background/60 px-3 transition"
            :class="{
              'border-primary ring-2 ring-primary/50':
                recordingShortcutId === shortcut.id && !shortcutError,
              'border-destructive ring-2 ring-destructive/50':
                recordingShortcutId === shortcut.id && shortcutError,
              'opacity-60': shortcut.disabled
            }"
          >
            <KbdGroup class="flex flex-wrap items-center gap-1">
              <template v-if="recordingShortcutId === shortcut.id">
                <template v-if="formattedTempShortcut.length">
                  <Kbd>
                    <template v-for="(key, idx) in formattedTempShortcut" :key="`${key}-${idx}`">
                      {{ key }}
                      <template v-if="idx < formattedTempShortcut.length - 1"> &nbsp; </template>
                    </template>
                  </Kbd>
                </template>
                <Kbd v-else class="text-muted-foreground">...</Kbd>
              </template>
              <template v-else-if="shortcut.key.length">
                <Kbd>
                  <template v-for="(key, idx) in shortcut.key" :key="`${key}-${idx}`">
                    {{ key }}
                    <template v-if="idx < shortcut.key.length - 1"> &nbsp; </template>
                  </template>
                </Kbd>
              </template>
              <Kbd v-else class="text-muted-foreground">—</Kbd>
            </KbdGroup>

            <div
              class="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
              :class="{ 'opacity-100': recordingShortcutId === shortcut.id }"
            >
              <Button
                v-if="!shortcut.disabled"
                :data-testid="`shortcut-edit-${shortcut.id}`"
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-primary"
                :title="t('common.edit')"
                @click.stop="startRecording(shortcut.id)"
              >
                <Icon icon="lucide:pencil" class="h-4 w-4" />
              </Button>
              <Button
                v-if="shortcut.key.length && !shortcut.disabled"
                :data-testid="`shortcut-clear-${shortcut.id}`"
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-destructive"
                :title="t('settings.shortcuts.clearShortcut')"
                @click.stop="clearShortcut(shortcut.id)"
              >
                <Icon icon="lucide:x" class="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div
            v-if="recordingShortcutId === shortcut.id"
            class="mt-1 text-xs"
            :class="shortcutError ? 'text-destructive' : 'text-muted-foreground'"
          >
            <span v-if="shortcutError">
              {{ shortcutError }}
            </span>
            <span v-else-if="formattedTempShortcut.length">
              {{ t('settings.shortcuts.pressEnterToSave') }}
            </span>
            <span v-else class="text-primary">
              {{ t('settings.shortcuts.pressKeys') }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Loader2 } from '@lucide/vue'

import { useShortcutKeyStore } from '@/stores/shortcutKey'
import { useLanguageStore } from '@/stores/language'
import { Button } from '@shadcn/components/ui/button'
import { Kbd, KbdGroup } from '@shadcn/components/ui/kbd'
import type { ShortcutKey } from '@shared/presenter'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const languageStore = useLanguageStore()
const shortcutKeyStore = useShortcutKeyStore()
const { shortcutKeys } = storeToRefs(shortcutKeyStore)

const resetLoading = ref(false)
const recordingShortcutId = ref<string | null>(null)
const tempShortcut = ref('')
const shortcutError = ref('')

const FORBIDDEN_SINGLE_KEYS = ['Control', 'Command', 'Alt', 'Shift', 'Meta', 'Escape', 'Tab']

const normalizeShortcut = (shortcut: string): string[] => {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const normalized = shortcut
    .replace(/CommandOrControl/g, isMac ? 'Command' : 'Control')
    .replace(/CmdOrCtrl/g, isMac ? 'Command' : 'Control')

  return normalized.split('+')
}

const areShortcutsEquivalent = (shortcut1: string, shortcut2: string): boolean => {
  if (shortcut1 === shortcut2) return true

  const parts1 = normalizeShortcut(shortcut1)
  const parts2 = normalizeShortcut(shortcut2)

  if (parts1.length !== parts2.length) return false

  const sortedParts1 = [...parts1].sort()
  const sortedParts2 = [...parts2].sort()

  for (let i = 0; i < sortedParts1.length; i++) {
    if (sortedParts1[i] !== sortedParts2[i]) return false
  }

  return true
}

const isShortcutConflict = (key: string, currentId: string): boolean => {
  for (const [id, shortcut] of Object.entries<string>(shortcutKeys.value || {})) {
    if (id !== currentId && areShortcutsEquivalent(shortcut, key)) {
      return true
    }
  }
  return false
}

const shortcutMapping: Record<
  ShortcutKey,
  { icon: string; label: string; key?: string; disabled?: boolean }
> = {
  ShowHideWindow: {
    icon: 'lucide:plus-square',
    label: 'settings.shortcuts.showHideWindow'
  },
  NewConversation: {
    icon: 'lucide:plus-square',
    label: 'settings.shortcuts.newConversation'
  },
  QuickSearch: {
    icon: 'lucide:search',
    label: 'settings.shortcuts.quickSearch'
  },
  ToggleSidebar: {
    icon: 'lucide:panel-left-close',
    label: 'settings.shortcuts.toggleSidebar'
  },
  ToggleWorkspace: {
    icon: 'lucide:panel-right-close',
    label: 'settings.shortcuts.toggleWorkspace'
  },
  NewWindow: {
    icon: 'lucide:app-window',
    label: 'settings.shortcuts.newWindow'
  },
  CloseWindow: {
    icon: 'lucide:x',
    label: 'settings.shortcuts.closeWindow'
  },
  ZoomIn: {
    icon: 'lucide:zoom-in',
    label: 'settings.shortcuts.zoomIn'
  },
  ZoomOut: {
    icon: 'lucide:zoom-out',
    label: 'settings.shortcuts.zoomOut'
  },
  ZoomResume: {
    icon: 'lucide:rotate-ccw',
    label: 'settings.shortcuts.zoomReset'
  },
  GoSettings: {
    icon: 'lucide:settings',
    label: 'settings.shortcuts.goSettings'
  },
  CleanChatHistory: {
    icon: 'lucide:eraser',
    label: 'settings.shortcuts.cleanHistory'
  },
  DeleteConversation: {
    icon: 'lucide:trash-2',
    label: 'settings.shortcuts.deleteConversation'
  },
  Quit: {
    icon: 'lucide:log-out',
    label: 'settings.shortcuts.quitApp'
  }
}

const shortcuts = computed(() => {
  if (!shortcutKeys.value || Object.keys(shortcutKeys.value).length === 0) {
    return []
  }

  try {
    return Object.entries(shortcutMapping).map(([key, value]) => {
      const savedKey = shortcutKeys.value?.[key as ShortcutKey]
      const rawKey = savedKey ?? value.key ?? ''
      const formattedKey = formatShortcut(rawKey)

      return {
        id: key as ShortcutKey,
        icon: value.icon,
        label: value.label,
        key: formattedKey,
        disabled: value.disabled
      }
    })
  } catch (error) {
    console.error('Parse shortcut key error', error)
    return []
  }
})

const formatShortcut = (_shortcut: string | undefined | null): string[] => {
  if (!_shortcut) return []

  return _shortcut
    .replace(
      'CommandOrControl',
      /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? '⌘' : 'Ctrl'
    )
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, ' + ')
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
}

const formattedTempShortcut = computed(() => formatShortcut(tempShortcut.value))

const resetShortcutKeys = async () => {
  resetLoading.value = true

  if (recordingShortcutId.value) {
    cancelRecording()
  }

  shortcutError.value = ''
  tempShortcut.value = ''
  recordingShortcutId.value = null

  try {
    await shortcutKeyStore.resetShortcutKeys()
    shortcutKeyStore.disableShortcutKey()
    shortcutKeyStore.enableShortcutKey()
  } catch (error) {
    console.error('Failed to reset shortcut keys:', error)
  } finally {
    resetLoading.value = false
  }
}

const startRecording = (shortcutId: string) => {
  if (recordingShortcutId.value && recordingShortcutId.value !== shortcutId) {
    stopRecording()
  }

  recordingShortcutId.value = shortcutId
  tempShortcut.value = ''
  shortcutError.value = ''

  shortcutKeyStore.disableShortcutKey()

  window.addEventListener('keydown', handleKeyDown, { capture: true })

  document.body.style.overflow = 'hidden'
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (!recordingShortcutId.value) return

  event.preventDefault()

  if (event.key === 'Escape') {
    cancelRecording()
    return
  }

  if (event.key === 'Enter' && tempShortcut.value) {
    if (validateShortcut(tempShortcut.value)) {
      saveAndStopRecording()
      shortcutKeyStore.enableShortcutKey()
    }
    return
  }

  shortcutError.value = ''

  const keys: string[] = []

  if (event.ctrlKey) keys.push('Control')
  if (event.metaKey) keys.push('Command')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')

  const key = event.key
  if (!['Control', 'Alt', 'Shift', 'Meta', 'Enter', 'Escape'].includes(key)) {
    keys.push(key.length === 1 ? key.toUpperCase() : key)
  }

  if (keys.length > 0) {
    tempShortcut.value = keys.join('+')
  }
}

const validateShortcut = (shortcut: string): boolean => {
  if (FORBIDDEN_SINGLE_KEYS.includes(shortcut)) {
    shortcutError.value = t('settings.shortcuts.noModifierOnly')
    return false
  }

  if (recordingShortcutId.value && isShortcutConflict(shortcut, recordingShortcutId.value)) {
    shortcutError.value = t('settings.shortcuts.keyConflict')
    return false
  }

  return true
}

const cancelRecording = () => {
  tempShortcut.value = ''
  shortcutError.value = ''
  stopRecording()
}

const saveAndStopRecording = () => {
  if (shortcutKeys.value && recordingShortcutId.value && tempShortcut.value) {
    const shortcutKey = recordingShortcutId.value as keyof typeof shortcutKeys.value
    shortcutKeys.value[shortcutKey] = tempShortcut.value
    saveChanges()
  }
  shortcutError.value = ''
  stopRecording()
}

const stopRecording = () => {
  if (recordingShortcutId.value) {
    recordingShortcutId.value = null
    window.removeEventListener('keydown', handleKeyDown, { capture: true })

    document.body.style.overflow = ''
  }
}

const saveChanges = async () => {
  try {
    await shortcutKeyStore.saveShortcutKeys()

    shortcutKeyStore.disableShortcutKey()
    shortcutKeyStore.enableShortcutKey()
  } catch (error) {
    console.error('Save shortcut keys error:', error)
  }
}

const clearShortcut = async (shortcutId: string) => {
  if (!shortcutKeys.value) return

  try {
    if (recordingShortcutId.value === shortcutId) {
      cancelRecording()
    }

    const shortcutKey = shortcutId as keyof typeof shortcutKeys.value
    shortcutKeys.value[shortcutKey] = ''

    await saveChanges()

    console.log(`Shortcut ${shortcutId} cleared`)
  } catch (error) {
    console.error('Clear shortcut error:', error)
  }
}
</script>
