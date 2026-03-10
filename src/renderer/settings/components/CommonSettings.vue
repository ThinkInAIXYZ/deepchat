<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full h-full flex flex-col gap-3 p-4">
      <UploadFileSettingsSection />
      <DefaultModelSettingsSection />
      <ProxySettingsSection />
      <SettingToggleRow
        id="auto-scroll-switch"
        icon="lucide:arrow-down"
        :label="t('settings.common.autoScrollEnabled')"
        :model-value="autoScrollEnabled"
        @update:model-value="handleAutoScrollChange"
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
import ProxySettingsSection from './common/ProxySettingsSection.vue'
import LoggingSettingsSection from './common/LoggingSettingsSection.vue'
import SettingToggleRow from './common/SettingToggleRow.vue'
import UploadFileSettingsSection from './common/UploadFileSettingsSection.vue'
import DefaultModelSettingsSection from './common/DefaultModelSettingsSection.vue'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()

const autoScrollEnabled = computed(() => uiSettingsStore.autoScrollEnabled)
const copyWithCotEnabled = computed(() => uiSettingsStore.copyWithCotEnabled)
const traceDebugEnabled = computed(() => uiSettingsStore.traceDebugEnabled)

const handleAutoScrollChange = (value: boolean) => {
  uiSettingsStore.setAutoScrollEnabled(value)
}

const handleCopyWithCotChange = (value: boolean) => {
  uiSettingsStore.setCopyWithCotEnabled(value)
}

const handleTraceDebugChange = (value: boolean) => {
  uiSettingsStore.setTraceDebugEnabled(value)
}
</script>
