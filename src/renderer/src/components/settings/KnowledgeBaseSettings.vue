<template>
  <ScrollArea class="w-full h-full p-2">
    <div v-show="!showBuiltinKnowledgeDetail" class="w-full h-full flex flex-col gap-1.5">
      <!-- 知识库配置标题 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full">
          <Icon icon="lucide:book-marked" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.knowledgeBase.title') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            class="flex items-center gap-1"
            @click="openAddKnowledgeBaseDialog"
          >
            <Icon icon="lucide:plus" class="w-4 h-4" />
            {{ t('settings.knowledgeBase.addKnowledgeBase') }}
          </Button>
        </div>
      </div>

      <!-- 知识库列表 -->
      <div class="space-y-4 px-2 pb-4">
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
        <!-- 未来可以添加更多知识库类型 -->
        <div
          class="border rounded-lg p-4 border-dashed flex items-center justify-center text-muted-foreground"
        >
          <span class="text-sm">{{ t('settings.knowledgeBase.moreComingSoon') }}</span>
        </div>
      </div>

      <!-- 添加知识库对话框 -->
      <Dialog v-model:open="isAddKnowledgeBaseDialogOpen">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('settings.knowledgeBase.addKnowledgeBase') }}</DialogTitle>
            <DialogDescription>
              {{ t('settings.knowledgeBase.selectKnowledgeBaseType') }}
            </DialogDescription>
          </DialogHeader>
          <div class="grid gap-4 py-4">
            <div
              class="flex items-center p-3 border rounded-md cursor-pointer hover:bg-accent"
              @click="selectKnowledgeBaseType('dify')"
            >
              <img src="@/assets/images/dify.png" class="h-5 mr-3" />
              <div class="flex-1">
                <h3 class="text-sm font-medium">{{ t('settings.knowledgeBase.dify') }}</h3>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.knowledgeBase.difyDescription') }}
                </p>
              </div>
            </div>
            <div
              class="flex items-center p-3 border rounded-md cursor-pointer hover:bg-accent"
              @click="selectKnowledgeBaseType('ragflow')"
            >
              <img src="@/assets/images/ragflow.png" class="h-5 mr-3" />
              <div class="flex-1">
                <h3 class="text-sm font-medium">{{ t('settings.knowledgeBase.ragflowTitle') }}</h3>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.knowledgeBase.ragflowDescription') }}
                </p>
              </div>
            </div>
            <div
              class="flex items-center p-3 border rounded-md cursor-pointer hover:bg-accent"
              @click="selectKnowledgeBaseType('fastgpt')"
            >
              <img src="@/assets/images/fastgpt.png" class="h-5 mr-3" />
              <div class="flex-1">
                <h3 class="text-sm font-medium">{{ t('settings.knowledgeBase.fastgptTitle') }}</h3>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.knowledgeBase.fastgptDescription') }}
                </p>
              </div>
            </div>
            <div
              class="flex items-center p-3 border rounded-md cursor-pointer hover:bg-accent"
              @click="selectKnowledgeBaseType('builtinKnowledge')"
            >
              <Icon icon="lucide:book-open" class="h-5 mr-3 text-primary" />
              <div class="flex-1">
                <h3 class="text-sm font-medium">
                  {{ t('settings.knowledgeBase.builtInKnowledgeTitle') }}
                </h3>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.knowledgeBase.builtInKnowledgeDescription') }}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="closeAddKnowledgeBaseDialog">{{
              t('common.cancel')
            }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
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

// 对话框状态
const isAddKnowledgeBaseDialogOpen = ref(false)

// 打开添加知识库对话框
const openAddKnowledgeBaseDialog = () => {
  isAddKnowledgeBaseDialogOpen.value = true
}

// 关闭添加知识库对话框
const closeAddKnowledgeBaseDialog = () => {
  isAddKnowledgeBaseDialogOpen.value = false
}

// 选择知识库类型
const selectKnowledgeBaseType = (type: string) => {
  closeAddKnowledgeBaseDialog()
  if (type === 'builtinKnowledge') {
    if (builtinSettingsRef.value) {
      builtinSettingsRef.value.openAddConfig()
    }
  }
  if (type === 'dify') {
    if (difySettingsRef.value) {
      difySettingsRef.value.openAddConfig()
    }
  }
  if (type === 'ragflow') {
    if (ragflowSettingsRef.value) {
      ragflowSettingsRef.value.openAddConfig()
    }
  }
  if (type === 'fastgpt') {
    if (fastGptSettingsRef.value) {
      fastGptSettingsRef.value.openAddConfig()
    }
  }
}
</script>
