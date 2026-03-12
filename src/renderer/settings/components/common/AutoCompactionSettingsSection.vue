<template>
  <section class="flex flex-col gap-2 py-2">
    <div class="flex items-center gap-2 h-10 text-sm font-medium text-muted-foreground">
      <Icon icon="lucide:sparkles" class="w-4 h-4" />
      <span>{{ t('settings.common.autoCompaction.title') }}</span>
    </div>

    <div class="rounded-lg border border-border bg-card/30 px-4 py-4">
      <div class="flex flex-col gap-3">
        <SettingToggleRow
          id="auto-compaction-switch"
          icon="lucide:scaling"
          :label="t('settings.common.autoCompaction.enabled')"
          :model-value="autoCompactionEnabled"
          @update:model-value="handleEnabledChange"
        />

        <p class="pl-6 text-xs leading-6 text-muted-foreground">
          {{ t('settings.common.autoCompaction.description') }}
        </p>

        <div class="flex flex-col gap-4 pl-6" :class="{ 'opacity-60': controlsDisabled }">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">
                {{ t('settings.common.autoCompaction.thresholdLabel') }}
              </span>
              <span class="text-xs text-muted-foreground">{{ thresholdDisplay }}</span>
            </div>

            <Slider
              id="auto-compaction-threshold-slider"
              data-testid="auto-compaction-threshold-slider"
              :model-value="[autoCompactionTriggerThreshold]"
              :min="AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN"
              :max="AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX"
              :step="AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP"
              :disabled="controlsDisabled"
              @update:model-value="handleThresholdChange"
            />

            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {{
                  t('settings.common.autoCompaction.thresholdMin', {
                    value: AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN
                  })
                }}
              </span>
              <span>
                {{
                  t('settings.common.autoCompaction.thresholdMax', {
                    value: AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX
                  })
                }}
              </span>
            </div>

            <p class="text-xs leading-6 text-muted-foreground">
              {{ t('settings.common.autoCompaction.thresholdDescription') }}
            </p>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">
                {{ t('settings.common.autoCompaction.retainPairsLabel') }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{
                  t('settings.common.autoCompaction.retainPairsValue', {
                    count: autoCompactionRetainRecentPairs
                  })
                }}
              </span>
            </div>

            <div class="flex items-center">
              <Input
                id="auto-compaction-retain-pairs-input"
                data-testid="auto-compaction-retain-pairs-input"
                type="number"
                class="h-8 w-24 text-center"
                :min="AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN"
                :max="AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX"
                :disabled="controlsDisabled"
                :model-value="autoCompactionRetainRecentPairs"
                @update:model-value="handleRetainRecentPairsInput"
              />
            </div>

            <p class="text-xs leading-6 text-muted-foreground">
              {{ t('settings.common.autoCompaction.retainPairsDescription') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
import { Slider } from '@shadcn/components/ui/slider'
import {
  AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX,
  AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN,
  AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX,
  AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN,
  AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP,
  useUiSettingsStore
} from '@/stores/uiSettingsStore'
import SettingToggleRow from './SettingToggleRow.vue'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()

const autoCompactionEnabled = computed(() => uiSettingsStore.autoCompactionEnabled)
const autoCompactionTriggerThreshold = computed(
  () => uiSettingsStore.autoCompactionTriggerThreshold
)
const autoCompactionRetainRecentPairs = computed(
  () => uiSettingsStore.autoCompactionRetainRecentPairs
)
const controlsDisabled = computed(() => !autoCompactionEnabled.value)
const thresholdDisplay = computed(() => `${autoCompactionTriggerThreshold.value}%`)

const handleEnabledChange = (value: boolean) => {
  void uiSettingsStore.setAutoCompactionEnabled(value)
}

const handleThresholdChange = (value: number[] | undefined) => {
  const nextValue = value?.[0]
  if (typeof nextValue !== 'number' || Number.isNaN(nextValue)) {
    return
  }
  void uiSettingsStore.setAutoCompactionTriggerThreshold(nextValue)
}

const handleRetainRecentPairsInput = (value: string | number) => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
  if (!Number.isFinite(parsed)) {
    return
  }
  void uiSettingsStore.setAutoCompactionRetainRecentPairs(parsed)
}
</script>
