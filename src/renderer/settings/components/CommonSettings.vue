<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-3 p-4">
      <UploadFileSettingsSection />
      <ProxySettingsSection />
      <SettingToggleRow
        id="sound-switch"
        icon="lucide:volume-2"
        :label="t('settings.common.soundEnabled')"
        :model-value="soundEnabled"
        @update:model-value="handleSoundChange"
      />
      <SettingToggleRow
        id="copy-with-cot-switch"
        icon="lucide:file-text"
        :label="t('settings.common.copyWithCotEnabled')"
        :model-value="copyWithCotEnabled"
        @update:model-value="handleCopyWithCotChange"
      />
      <SettingToggleRow
        id="trace-debug-switch"
        icon="lucide:bug"
        :label="t('settings.common.traceDebugEnabled')"
        :model-value="traceDebugEnabled"
        @update:model-value="handleTraceDebugChange"
      />
      <LoggingSettingsSection />
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useSoundStore } from '@/stores/sound'
import ProxySettingsSection from './common/ProxySettingsSection.vue'
import LoggingSettingsSection from './common/LoggingSettingsSection.vue'
import SettingToggleRow from './common/SettingToggleRow.vue'
import UploadFileSettingsSection from './common/UploadFileSettingsSection.vue'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()
const soundStore = useSoundStore()

const soundEnabled = computed(() => soundStore.soundEnabled)
const copyWithCotEnabled = computed(() => uiSettingsStore.copyWithCotEnabled)
const traceDebugEnabled = computed(() => uiSettingsStore.traceDebugEnabled)

const handleSoundChange = (value: boolean) => {
  soundStore.setSoundEnabled(value)
}

const handleCopyWithCotChange = (value: boolean) => {
  uiSettingsStore.setCopyWithCotEnabled(value)
}

const handleTraceDebugChange = (value: boolean) => {
  uiSettingsStore.setTraceDebugEnabled(value)
}
</script>
