<template>
  <SettingsPageShell
    :title="t('routes.settings-common')"
    :eyebrow="t('settings.controlCenter.groups.setup')"
    data-testid="settings-general-page"
  >
    <div class="flex w-full flex-col gap-3">
      <UploadFileSettingsSection />
      <ProxySettingsSection />
      <CommandShellSettingsSection />
      <DcToggleRow
        id="launch-at-login-switch"
        icon="lucide:power"
        :label="t('settings.common.launchAtLoginEnabled')"
        label-min-width="220px"
        :model-value="launchAtLoginEnabled"
        @update:model-value="handleLaunchAtLoginChange"
      />
      <DcToggleRow
        id="auto-scroll-switch"
        icon="lucide:arrow-down"
        :label="t('settings.common.autoScrollEnabled')"
        label-min-width="220px"
        :model-value="autoScrollEnabled"
        @update:model-value="handleAutoScrollChange"
      />
      <DcToggleRow
        id="copy-with-cot-switch"
        icon="lucide:file-text"
        :label="t('settings.common.copyWithCotEnabled')"
        label-min-width="220px"
        :model-value="copyWithCotEnabled"
        @update:model-value="handleCopyWithCotChange"
      />
      <DcToggleRow
        id="trace-debug-switch"
        icon="lucide:bug"
        :label="t('settings.common.traceDebugEnabled')"
        :description="t('settings.common.traceDebugEnabledDesc')"
        label-min-width="220px"
        :model-value="traceDebugEnabled"
        @update:model-value="handleTraceDebugChange"
      />
      <LoggingSettingsSection />
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { DcToggleRow } from '@dc-ui/components/toggle-row'
import ProxySettingsSection from './common/ProxySettingsSection.vue'
import CommandShellSettingsSection from './common/CommandShellSettingsSection.vue'
import LoggingSettingsSection from './common/LoggingSettingsSection.vue'
import UploadFileSettingsSection from './common/UploadFileSettingsSection.vue'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()

const autoScrollEnabled = computed(() => uiSettingsStore.autoScrollEnabled)
const copyWithCotEnabled = computed(() => uiSettingsStore.copyWithCotEnabled)
const traceDebugEnabled = computed(() => uiSettingsStore.traceDebugEnabled)
const launchAtLoginEnabled = computed(() => uiSettingsStore.launchAtLoginEnabled)

const handleAutoScrollChange = (value: boolean) => {
  uiSettingsStore.setAutoScrollEnabled(value)
}

const handleLaunchAtLoginChange = (value: boolean) => {
  uiSettingsStore.setLaunchAtLoginEnabled(value)
}

const handleCopyWithCotChange = (value: boolean) => {
  uiSettingsStore.setCopyWithCotEnabled(value)
}

const handleTraceDebugChange = (value: boolean) => {
  uiSettingsStore.setTraceDebugEnabled(value)
}
</script>
