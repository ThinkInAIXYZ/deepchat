<template>
  <SettingsPageShell
    :title="t('settings.knowledgeBase.title')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    data-testid="settings-knowledge-base-page"
  >
    <div v-show="!showBuiltinKnowledgeDetail" class="flex w-full flex-col gap-4">
      <div class="space-y-4">
        <RagflowKnowledgeSettings ref="ragflowSettingsRef" />
        <DifyKnowledgeSettings ref="difySettingsRef" />
        <FastGptKnowledgeSettings ref="fastGptSettingsRef" />
        <BuiltinKnowledgeSettings
          v-if="enableBuiltinKnowledge"
          ref="builtinSettingsRef"
          @showDetail="showDetail"
        />
        <NowledgeMemSettings ref="nowledgeMemSettingsRef" />
      </div>
    </div>
    <div v-if="showBuiltinKnowledgeDetail">
      <KnowledgeFile
        v-if="builtinKnowledgeDetail"
        :builtinKnowledgeDetail="builtinKnowledgeDetail"
        @hideKnowledgeFile="showBuiltinKnowledgeDetail = false"
      ></KnowledgeFile>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import RagflowKnowledgeSettings from './RagflowKnowledgeSettings.vue'
import DifyKnowledgeSettings from './DifyKnowledgeSettings.vue'
import FastGptKnowledgeSettings from './FastGptKnowledgeSettings.vue'
import NowledgeMemSettings from './NowledgeMemSettings.vue'
import BuiltinKnowledgeSettings from './BuiltinKnowledgeSettings.vue'
import KnowledgeFile from './KnowledgeFile.vue'
import { BuiltinKnowledgeConfig } from '@shared/presenter'
import { createKnowledgeClient } from '@api/KnowledgeClient'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const difySettingsRef = ref<InstanceType<typeof DifyKnowledgeSettings> | null>(null)
const ragflowSettingsRef = ref<InstanceType<typeof RagflowKnowledgeSettings> | null>(null)
const fastGptSettingsRef = ref<InstanceType<typeof FastGptKnowledgeSettings> | null>(null)
const nowledgeMemSettingsRef = ref<InstanceType<typeof NowledgeMemSettings> | null>(null)
const builtinSettingsRef = ref<InstanceType<typeof BuiltinKnowledgeSettings> | null>(null)

const knowledgeClient = createKnowledgeClient()
const enableBuiltinKnowledge = ref(false)
knowledgeClient.isSupported().then((res) => {
  enableBuiltinKnowledge.value = res
})

const { t } = useI18n()
const showBuiltinKnowledgeDetail = ref(false)
const builtinKnowledgeDetail = ref<BuiltinKnowledgeConfig | null>(null)
const showDetail = (detail: BuiltinKnowledgeConfig) => {
  showBuiltinKnowledgeDetail.value = true
  builtinKnowledgeDetail.value = detail
}
</script>
