<template>
  <ScrollArea class="w-full h-full p-4">
    <div v-show="!showBuiltinKnowledgeDetail" class="w-full h-full flex flex-col gap-4">
      <!-- 知识库配置标题 -->
      <div class="flex flex-row items-center gap-2">
        <span class="font-medium flex-1">{{ t('settings.knowledgeBase.title') }}</span>
      </div>

      <!-- 知识库列表 -->
      <div class="space-y-4">
        <!-- RAGFlow知识库 -->
        <RagflowKnowledgeSettings ref="ragflowSettingsRef" />
        <!-- Dify知识库 -->
        <DifyKnowledgeSettings ref="difySettingsRef" />
        <!-- FastGPT知识库 -->
        <FastGptKnowledgeSettings ref="fastGptSettingsRef" />
        <!-- 内置知识库 -->
        <BuiltinKnowledgeSettings
          v-if="enableBuiltinKnowledge"
          ref="builtinSettingsRef"
          @showDetail="showDetail"
        />
      </div>
    </div>
    <div v-if="showBuiltinKnowledgeDetail">
      <KnowledgeFile
        v-if="builtinKnowledgeDetail"
        :builtinKnowledgeDetail="builtinKnowledgeDetail"
        @hideKnowledgeFile="showBuiltinKnowledgeDetail = false"
      ></KnowledgeFile>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import RagflowKnowledgeSettings from './RagflowKnowledgeSettings.vue'
import DifyKnowledgeSettings from './DifyKnowledgeSettings.vue'
import FastGptKnowledgeSettings from './FastGptKnowledgeSettings.vue'
import BuiltinKnowledgeSettings from './BuiltinKnowledgeSettings.vue'
import KnowledgeFile from './KnowledgeFile.vue'
import { BuiltinKnowledgeConfig } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'

const difySettingsRef = ref<InstanceType<typeof DifyKnowledgeSettings> | null>(null)
const ragflowSettingsRef = ref<InstanceType<typeof RagflowKnowledgeSettings> | null>(null)
const fastGptSettingsRef = ref<InstanceType<typeof FastGptKnowledgeSettings> | null>(null)
const builtinSettingsRef = ref<InstanceType<typeof BuiltinKnowledgeSettings> | null>(null)

// 根据系统版本控制是否展示内置知识库
const knowledgePresenter = usePresenter('knowledgePresenter')
const enableBuiltinKnowledge = ref(false)
knowledgePresenter.isSupported().then((res) => {
  enableBuiltinKnowledge.value = res
})

const { t } = useI18n()
// 是否展示内置知识库文件详情
const showBuiltinKnowledgeDetail = ref(false)
const builtinKnowledgeDetail = ref<BuiltinKnowledgeConfig | null>(null)
const showDetail = (detail: BuiltinKnowledgeConfig) => {
  showBuiltinKnowledgeDetail.value = true
  builtinKnowledgeDetail.value = detail
}
</script>
