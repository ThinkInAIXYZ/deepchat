<template>
  <div class="w-full h-full py-4 flex flex-col">
    <div class="pb-4 px-4 flex flex-row items-center justify-between">
      <div class="flex items-center gap-2" :dir="languageStore.dir">
        <span class="font-medium">{{ t('settings.shortcuts.title') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="resetShortcutKeys()">
          <Loader2 v-if="resetLoading" class="mr-1 h-4 w-4 animate-spin" />
          <Icon v-else icon="lucide:refresh-cw" class="w-4 h-4 mr-1" />
          {{ t('common.resetData') }}
        </Button>
      </div>
    </div>
    <ScrollArea class="px-4 flex-1 w-full h-full">
      <div class="flex flex-col gap-4">
        <div v-for="shortcut in shortcuts" :key="shortcut.id" class="flex flex-row items-center">
          <span class="flex flex-row items-center gap-2 grow" :dir="languageStore.dir">
            <Icon :icon="shortcut.icon" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t(shortcut.label) }}</span>
          </span>

          <div class="shrink-0 min-w-[240px]">
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
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-muted-foreground hover:text-primary"
                  :title="t('common.edit')"
                  @click.stop="startRecording(shortcut.id)"
                >
                  <Icon icon="lucide:pencil" class="h-4 w-4" />
                </Button>
                <Button
                  v-if="!shortcut.disabled && shortcut.key.length"
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
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Loader2 } from 'lucide-vue-next'

import { useShortcutKeyStore } from '@/stores/shortcutKey'
import { useLanguageStore } from '@/stores/language'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Kbd, KbdGroup } from '@shadcn/components/ui/kbd'
import type { ShortcutKey } from '@shared/presenter'

const { t } = useI18n()
const languageStore = useLanguageStore()
const shortcutKeyStore = useShortcutKeyStore()
const { shortcutKeys } = storeToRefs(shortcutKeyStore)

const resetLoading = ref(false)
const recordingShortcutId = ref<string | null>(null)
const tempShortcut = ref('')
const shortcutError = ref('')

// 禁止作为快捷键的修饰键
const FORBIDDEN_SINGLE_KEYS = ['Control', 'Command', 'Alt', 'Shift', 'Meta', 'Escape', 'Tab']

// 标准化快捷键字符串，处理 CommandOrControl 特殊情况
const normalizeShortcut = (shortcut: string): string[] => {
  // 在 macOS 上，CommandOrControl 应该视为 Command，在其他系统上视为 Control
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const normalized = shortcut
    .replace(/CommandOrControl/g, isMac ? 'Command' : 'Control')
    .replace(/CmdOrCtrl/g, isMac ? 'Command' : 'Control')

  return normalized.split('+')
}

// 检查两个快捷键是否等价（考虑 CommandOrControl 的情况）
const areShortcutsEquivalent = (shortcut1: string, shortcut2: string): boolean => {
  if (shortcut1 === shortcut2) return true

  const parts1 = normalizeShortcut(shortcut1)
  const parts2 = normalizeShortcut(shortcut2)

  // 如果组成部分数量不同，则不等价
  if (parts1.length !== parts2.length) return false

  // 检查每个部分是否匹配（忽略顺序）
  const sortedParts1 = [...parts1].sort()
  const sortedParts2 = [...parts2].sort()

  for (let i = 0; i < sortedParts1.length; i++) {
    if (sortedParts1[i] !== sortedParts2[i]) return false
  }

  return true
}

// 检查快捷键是否冲突
const isShortcutConflict = (key: string, currentId: string): boolean => {
  // 检查快捷键是否已经被其他功能使用
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
  NewWindow: {
    icon: 'lucide:app-window',
    label: 'settings.shortcuts.newWindow'
  },
  NewTab: {
    icon: 'lucide:plus',
    label: 'settings.shortcuts.newTab'
  },
  CloseTab: {
    icon: 'lucide:x',
    label: 'settings.shortcuts.closeTab'
  },
  SwitchNextTab: {
    icon: 'lucide:arrow-right',
    label: 'settings.shortcuts.nextTab'
  },
  SwitchPrevTab: {
    icon: 'lucide:arrow-left',
    label: 'settings.shortcuts.previousTab'
  },
  NumberTabs: {
    icon: 'lucide:list-ordered',
    label: 'settings.shortcuts.specificTab',
    key: 'CommandOrControl+1...8',
    disabled: true
  },
  SwtichToLastTab: {
    icon: 'lucide:move-horizontal',
    label: 'settings.shortcuts.lastTab'
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
    return Object.entries(shortcutMapping).map(([key, value]) => ({
      id: key,
      icon: value.icon,
      label: value.label,
      key: formatShortcut(shortcutKeys.value[key] || value.key),
      disabled: value.disabled
    }))
  } catch (error) {
    console.error('Parse shortcut key error', error)
    return []
  }
})

const formatShortcut = (_shortcut: string | undefined | null): string[] => {
  // 如果 _shortcut 为空，返回空数组
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

  // 取消当前的录制状态并清除错误信息
  if (recordingShortcutId.value) {
    cancelRecording()
  }

  // 确保所有状态都被重置
  shortcutError.value = ''
  tempShortcut.value = ''
  recordingShortcutId.value = null

  try {
    await shortcutKeyStore.resetShortcutKeys()
    // 确保快捷键功能重新启用
    shortcutKeyStore.disableShortcutKey()
    shortcutKeyStore.enableShortcutKey()
  } catch (error) {
    console.error('重置快捷键失败:', error)
  } finally {
    resetLoading.value = false
  }
}

// 开始录制快捷键
const startRecording = (shortcutId: string) => {
  // 停止之前的录制
  if (recordingShortcutId.value && recordingShortcutId.value !== shortcutId) {
    stopRecording()
  }

  recordingShortcutId.value = shortcutId
  tempShortcut.value = ''
  shortcutError.value = ''

  shortcutKeyStore.disableShortcutKey()

  // 添加键盘事件监听
  window.addEventListener('keydown', handleKeyDown, { capture: true })

  // 阻止页面滑动和其他默认行为
  document.body.style.overflow = 'hidden'
}

// 处理键盘按下事件
const handleKeyDown = (event: KeyboardEvent) => {
  if (!recordingShortcutId.value) return

  event.preventDefault()

  // 如果按下 Esc 键，取消录制
  if (event.key === 'Escape') {
    cancelRecording()
    return
  }

  // 如果按下 Enter 键并且已经有临时快捷键，验证并保存
  if (event.key === 'Enter' && tempShortcut.value) {
    // 验证快捷键是否合法
    if (validateShortcut(tempShortcut.value)) {
      saveAndStopRecording()
      shortcutKeyStore.enableShortcutKey()
    }
    // 注意：错误信息会在 validateShortcut 中设置，不需要在这里清除
    return
  }

  // 清除之前的错误信息（只在输入新按键时清除，而不是在按 Enter 时）
  shortcutError.value = ''

  const keys: string[] = []

  // 添加修饰键
  if (event.ctrlKey) keys.push('Control')
  if (event.metaKey) keys.push('Command')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')

  // 添加主键
  const key = event.key
  if (!['Control', 'Alt', 'Shift', 'Meta', 'Enter', 'Escape'].includes(key)) {
    keys.push(key.length === 1 ? key.toUpperCase() : key)
  }

  if (keys.length > 0) {
    // 更新临时快捷键
    tempShortcut.value = keys.join('+')
    // 不再每次按键都验证，只在按 Enter 时验证
  }
}

// 验证快捷键
const validateShortcut = (shortcut: string): boolean => {
  // 检查是否只有一个修饰键
  if (FORBIDDEN_SINGLE_KEYS.includes(shortcut)) {
    shortcutError.value = t('settings.shortcuts.noModifierOnly')
    return false
  }

  // 检查是否有快捷键冲突
  if (recordingShortcutId.value && isShortcutConflict(shortcut, recordingShortcutId.value)) {
    shortcutError.value = t('settings.shortcuts.keyConflict')
    return false
  }

  return true
}

// 取消录制
const cancelRecording = () => {
  tempShortcut.value = ''
  shortcutError.value = ''
  stopRecording()
}

// 保存并停止录制
const saveAndStopRecording = () => {
  if (shortcutKeys.value && recordingShortcutId.value && tempShortcut.value) {
    const shortcutKey = recordingShortcutId.value as keyof typeof shortcutKeys.value
    shortcutKeys.value[shortcutKey] = tempShortcut.value
    saveChanges()
  }
  shortcutError.value = ''
  stopRecording()
}

// 停止录制
const stopRecording = () => {
  if (recordingShortcutId.value) {
    recordingShortcutId.value = null
    window.removeEventListener('keydown', handleKeyDown, { capture: true })

    // 恢复默认行为
    document.body.style.overflow = ''
  }
}

// 保存更改
const saveChanges = async () => {
  try {
    await shortcutKeyStore.saveShortcutKeys()

    shortcutKeyStore.disableShortcutKey()
    shortcutKeyStore.enableShortcutKey()
  } catch (error) {
    console.error('Save shortcut keys error:', error)
  }
}

// 清理快捷键
const clearShortcut = async (shortcutId: string) => {
  if (!shortcutKeys.value) return

  try {
    // 设置为空字符串
    const shortcutKey = shortcutId as keyof typeof shortcutKeys.value
    shortcutKeys.value[shortcutKey] = ''

    // 保存更改
    await saveChanges()

    console.log(`Shortcut ${shortcutId} cleared`)
  } catch (error) {
    console.error('Clear shortcut error:', error)
  }
}
</script>
