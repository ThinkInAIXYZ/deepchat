<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-3 p-4">
      <SearchEngineSettingsSection />
      <WebContentLimitSetting />
      <SearchAssistantModelSection />
      <ProxySettingsSection />
      <SettingToggleRow
        id="search-preview-switch"
        icon="lucide:eye"
        :label="t('settings.common.searchPreview')"
        :model-value="searchPreviewEnabled"
        @update:model-value="handleSearchPreviewChange"
      />
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
      <LoggingSettingsSection />
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { useSettingsStore } from '@/stores/settings'
import { useSoundStore } from '@/stores/sound'
import SearchEngineSettingsSection from './common/SearchEngineSettingsSection.vue'
import WebContentLimitSetting from './common/WebContentLimitSetting.vue'
import SearchAssistantModelSection from './common/SearchAssistantModelSection.vue'
import ProxySettingsSection from './common/ProxySettingsSection.vue'
import LoggingSettingsSection from './common/LoggingSettingsSection.vue'
import SettingToggleRow from './common/SettingToggleRow.vue'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const soundStore = useSoundStore()

const searchPreviewEnabled = computed(() => settingsStore.searchPreviewEnabled)
const soundEnabled = computed(() => soundStore.soundEnabled)
const copyWithCotEnabled = computed(() => settingsStore.copyWithCotEnabled)

const handleSearchPreviewChange = (value: boolean) => {
  settingsStore.setSearchPreviewEnabled(value)
}

const handleSoundChange = (value: boolean) => {
  soundStore.setSoundEnabled(value)
}

const handleCopyWithCotChange = (value: boolean) => {
  settingsStore.setCopyWithCotEnabled(value)
}
</script>
