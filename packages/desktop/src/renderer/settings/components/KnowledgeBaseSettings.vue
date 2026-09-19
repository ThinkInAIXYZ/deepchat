<template>
  <SettingsPageShell
    :title="t('settings.knowledgeBase.title')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-knowledge-base-page"
  >
    <div
      v-if="!showBuiltinKnowledgeDetail"
      ref="overviewRegion"
      role="region"
      tabindex="-1"
      :aria-label="t('settings.knowledgeBase.title')"
      class="flex w-full flex-col gap-4"
    >
      <div class="space-y-4">
        <RagflowKnowledgeSettings />
        <DifyKnowledgeSettings />
        <FastGptKnowledgeSettings />
        <BuiltinKnowledgeSettings v-if="enableBuiltinKnowledge" @showDetail="showDetail" />
        <NowledgeMemSettings />
      </div>
    </div>
    <div
      v-if="showBuiltinKnowledgeDetail"
      ref="detailRegion"
      role="region"
      tabindex="-1"
      :aria-label="builtinKnowledgeDetail?.description || t('settings.knowledgeBase.title')"
    >
      <KnowledgeFile
        v-if="builtinKnowledgeDetail"
        :builtinKnowledgeDetail="builtinKnowledgeDetail"
        @hideKnowledgeFile="hideDetail"
      ></KnowledgeFile>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import RagflowKnowledgeSettings from './RagflowKnowledgeSettings.vue'
import DifyKnowledgeSettings from './DifyKnowledgeSettings.vue'
import FastGptKnowledgeSettings from './FastGptKnowledgeSettings.vue'
import NowledgeMemSettings from './NowledgeMemSettings.vue'
import BuiltinKnowledgeSettings from './BuiltinKnowledgeSettings.vue'
import KnowledgeFile from './KnowledgeFile.vue'
import type { BuiltinKnowledgeConfig } from '@shared/types/knowledge'
import { createKnowledgeClient } from '@api/KnowledgeClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const knowledgeClient = createKnowledgeClient()
const enableBuiltinKnowledge = ref(false)
knowledgeClient.isSupported().then((res) => {
  enableBuiltinKnowledge.value = res
})

const { t } = useI18n()
const showBuiltinKnowledgeDetail = ref(false)
const builtinKnowledgeDetail = ref<BuiltinKnowledgeConfig | null>(null)
const detailRegion = ref<HTMLElement | null>(null)
const overviewRegion = ref<HTMLElement | null>(null)
const hideDetail = async () => {
  showBuiltinKnowledgeDetail.value = false
  await nextTick()
  overviewRegion.value?.focus({ preventScroll: true })
}
const showDetail = async (detail: BuiltinKnowledgeConfig) => {
  if (!(await settingsLeaveGuard.requestLeave())) return
  showBuiltinKnowledgeDetail.value = true
  builtinKnowledgeDetail.value = detail
  await nextTick()
  detailRegion.value?.focus({ preventScroll: true })
}
</script>
