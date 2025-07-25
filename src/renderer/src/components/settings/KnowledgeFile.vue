<template>
  <div class="w-full h-full flex flex-col gap-1.5 p-2">
    <!-- 顶部 -->
    <div class="flex flex-row justify-between items-center gap-2">
      <!-- 知识库信息 -->
      <div class="flex flex-row items-center gap-2">
        <Icon icon="lucide:book-marked" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-bold">
          {{ builtinKnowledgeDetail.description }}
          <span
            class="text-xs px-2 py-0.5 rounded-md ml-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
          >
            {{ builtinKnowledgeDetail.embedding.modelId }}
          </span>
        </span>
      </div>
      <!-- 操作按钮 -->
      <div class="flex flex-row gap-2 flex-shrink-0">
        <Button v-if="ctrlBtn === 'paused'" variant="outline" size="sm" @click="toggleStatus(true)">
          <Icon icon="lucide:play" class="w-4 h-4 text-green-500" />
        </Button>
        <Button
          v-if="ctrlBtn === 'processing'"
          variant="outline"
          size="sm"
          @click="toggleStatus(false)"
        >
          <Icon icon="lucide:pause" class="w-4 h-4 text-yellow-500" />
        </Button>
        <Button variant="outline" size="sm" @click="openSearchDialog">
          <Icon icon="lucide:search" class="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" @click="onReturn">
          <Icon icon="lucide:corner-down-left" class="w-4 h-4" />
          {{ t('settings.knowledgeBase.return') }}
        </Button>
      </div>
    </div>
    <!-- 文件上传 -->
    <div class="bg-card border border-border rounded-lg px-4 pb-2">
      <div class="text-sm p-2">
        {{ t('settings.knowledgeBase.file') }}
        <span
          class="text-xs px-2 py-0.5 rounded-md ml-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
        >
          {{ fileList.length }}
        </span>
      </div>
      <div className="flex flex-col gap-2 text-balance">
        <label for="upload">
          <div
            @dragover.prevent
            @drop.prevent="handleDrop"
            class="h-20 border border-border cursor-pointer rounded-lg text-muted-foreground hover:bg-muted/0 transition-colors"
          >
            <div class="flex flex-col items-center justify-center h-full gap-2">
              <div class="flex items-center gap-1">
                <Icon icon="lucide:file-up" class="w-4 h-4" />
                <span class="text-sm">
                  {{ t('settings.knowledgeBase.uploadHelper') }}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <Icon icon="lucide:clipboard" class="w-4 h-4" />
                <span class="text-sm">
                  {{ t('settings.knowledgeBase.onlySupport') }}
                  {{ acceptExts.join('，') }}
                </span>
              </div>
            </div>
          </div>
        </label>
        <Input
          v-show="false"
          multiple
          type="file"
          id="upload"
          @change="handleChange"
          :accept="acceptExts.map((ext) => '.' + ext).join(',')"
        />
        <div v-for="file in fileList" :key="file.id">
          <KnowledgeFileItem
            :file="file"
            @delete="deleteFile(file.id)"
            @reAdd="reAddFile(file)"
          ></KnowledgeFileItem>
        </div>
      </div>
    </div>
    <!-- 搜索弹窗 -->
    <Dialog v-model:open="isSearchDialogOpen">
      <TooltipProvider>
        <DialogContent>
          <DialogHeader>
            <DialogTitle> {{ t('settings.knowledgeBase.searchKnowledge') }} </DialogTitle>
          </DialogHeader>
          <div className="flex w-full items-center gap-1 relative">
            <Input
              v-model="searchKey"
              :placeholder="t('settings.knowledgeBase.searchKnowledgePlaceholder')"
            />
            <Button
              size="xs"
              variant="ghost"
              v-if="searchKey"
              class="absolute right-16 text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-zinc-200"
              @click.stop="clearSearchKey"
            >
              <Icon icon="lucide:x" class="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button @click="handleSearch">
              <Icon icon="lucide:search" class="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea class="max-h-[calc(100vh-200px)]">
            <div class="relative min-h-[180px]">
              <div v-if="loading" class="absolute h-full w-full flex items-center justify-center">
                <div class="text-center">
                  <Icon
                    icon="lucide:loader"
                    class="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground"
                  />
                  <p class="text-xs text-muted-foreground">{{ t('common.loading') }}</p>
                </div>
              </div>
              <div v-if="searchResult.length > 0">
                <div
                  v-for="item in searchResult"
                  :key="item.id"
                  class="relative px-6 py-4 mt-2 bg-card border border-border rounded-sm bg-secondary"
                >
                  <div
                    class="absolute right-10 top-1 text-xs text-white p-1 rounded-sm bg-primary-600"
                  >
                    score:{{ (item.distance * 100).toFixed(2) + '%' }}
                  </div>
                  <Tooltip :delay-duration="200">
                    <TooltipTrigger as-child>
                      <Button
                        variant="ghost"
                        size="xs"
                        class="absolute right-2 top-1 h-6 w-6 flex items-center justify-center rounded-sm hover:bg-primary/80 hover:text-white/100 transition-colors"
                        @click="handleCopy(item.metadata.content, item.id)"
                      >
                        <Icon v-if="copyId === item.id" icon="lucide:check" />
                        <Icon v-else icon="lucide:copy" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div v-if="copyId === item.id">
                        {{ t('settings.knowledgeBase.copySuccess') }} <
                      </div>
                      <div v-else>{{ t('settings.knowledgeBase.copy') }}</div>
                    </TooltipContent>
                  </Tooltip>
                  <div class="text-xs">
                    {{ item.metadata.content }}
                  </div>
                  <div class="border-t border-gray-300 pt-2 mt-2 text-xs text-muted-foreground">
                    {{ t('settings.knowledgeBase.source') }} ：{{ item.metadata.from }}
                  </div>
                </div>
              </div>
              <!-- 空状态 -->
              <div
                v-if="searchResult.length === 0 && !loading"
                class="text-center text-muted-foreground py-12"
              >
                <Icon icon="lucide:book-open-text" class="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p class="text-sm mt-1">{{ t('settings.knowledgeBase.noData') }}</p>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '../ui/toast'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { usePresenter } from '@/composables/usePresenter'
import KnowledgeFileItem from './KnowledgeFileItem.vue'
import { BuiltinKnowledgeConfig, KnowledgeFileMessage } from '@shared/presenter'
import { RAG_EVENTS } from '@/events'

const props = defineProps<{
  builtinKnowledgeDetail: BuiltinKnowledgeConfig
}>()

const emit = defineEmits<{
  (e: 'hideKnowledgeFile'): void
}>()

const ctrlBtn = ref<'paused' | 'processing' | null>(null)

const { t } = useI18n()
// 文件列表
const fileList = ref<KnowledgeFileMessage[]>([])
// 允许的文件扩展名
const acceptExts = ['txt', 'md', 'markdown', 'docx', 'pptx', 'pdf']
const knowledgePresenter = usePresenter('knowledgePresenter')
// 弹窗状态
const isSearchDialogOpen = ref(false)

// 打开搜索弹窗
const openSearchDialog = () => {
  isSearchDialogOpen.value = true
  searchKey.value = ''
  searchResult.value = []
  copyId.value = ''
  loading.value = false
}

// 返回知识库页面
const onReturn = () => {
  emit('hideKnowledgeFile')
}

const loading = ref<boolean>(false)
const searchKey = ref('')
const searchResult = ref<any>([])
const copyId = ref<string>('')

// 查询知识库
const handleSearch = async () => {
  if (!searchKey.value) return
  copyId.value = ''
  loading.value = true
  try {
    const res = await knowledgePresenter.similarityQuery(
      props.builtinKnowledgeDetail.id,
      searchKey.value
    )
    searchResult.value = res || []
  } catch (error) {
    console.error('[KnowledgeFile] Search failed:', error)
    toast({
      title: t('settings.knowledgeBase.searchError'),
      variant: 'destructive',
      duration: 3000
    })
    searchResult.value = []
  } finally {
    loading.value = false
  }
}

// 复制文本
const handleCopy = (content: string, id: string) => {
  copyId.value = id
  window.api.copyText(content)
}

const clearSearchKey = () => {
  searchKey.value = ''
}

// 文件点击上传
const handleChange = (event: Event) => {
  const files = (event.target as HTMLInputElement).files
  if (files && files.length > 0) {
    // 构造一个假的 DragEvent-like 对象，复用 handleDrop 逻辑
    const fakeDragEvent = {
      dataTransfer: {
        files
      }
    } as DragEvent
    handleDrop(fakeDragEvent)
  }
}

// 加载文件列表
const loadList = async () => {
  fileList.value = (await knowledgePresenter.listFiles(props.builtinKnowledgeDetail.id)) || []
}

const toggleStatus = async (run: boolean) => {
  if (run) {
    await knowledgePresenter.resumeAllPausedTasks(props.builtinKnowledgeDetail.id)
  } else {
    await knowledgePresenter.pauseAllRunningTasks(props.builtinKnowledgeDetail.id)
  }
  loadList()
}

// 上传文件到内置知识库
const handleDrop = async (e: DragEvent) => {
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    for (const file of e.dataTransfer.files) {
      // 校验类型
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !acceptExts.includes(ext)) {
        toast({
          title: `"${file.name}"${t('settings.knowledgeBase.uploadError')}`,
          description: `${t('settings.knowledgeBase.onlySupport')} ${acceptExts.join('，')}`,
          variant: 'destructive',
          duration: 3000
        })
        continue
      }
      try {
        const path = window.api.getPathForFile(file)
        const result = await knowledgePresenter.addFile(props.builtinKnowledgeDetail.id, path)
        if (result.error) {
          toast({
            title: `${file.name} ${t('settings.knowledgeBase.uploadError')}`,
            description: result.error,
            variant: 'destructive',
            duration: 3000
          })
          continue
        }
        if (result.data) {
          // 判断是否存在相同id的文件，存在则跳过
          const incoming = result.data
          const existingFile = fileList.value.find((f) => f.id === incoming.id)
          if (existingFile == null) {
            fileList.value.unshift(incoming)
          }
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        return
      }
    }
  }
}

// 刪除文件
const deleteFile = async (fileId: string) => {
  await knowledgePresenter.deleteFile(props.builtinKnowledgeDetail.id, fileId)
  toast({
    title: t('settings.knowledgeBase.deleteSuccess'),
    variant: 'default',
    duration: 3000
  })
  loadList()
}

// 重新上传文件
const reAddFile = async (file: KnowledgeFileMessage) => {
  const result = await knowledgePresenter.reAddFile(props.builtinKnowledgeDetail.id, file.id)
  file.status = 'processing' // 设置状态为加载中
  if (result.error) {
    toast({
      title: `${file.name} ${t('settings.knowledgeBase.uploadError')}`,
      description: result.error,
      variant: 'destructive',
      duration: 3000
    })
  }
}

watch(
  () => fileList.value,
  () => {
    if (fileList.value.length > 0) {
      const hasProcessing = fileList.value.find((file) => file.status === 'processing')
      if (hasProcessing) {
        ctrlBtn.value = 'processing'
        return
      }
      const hasPaused = fileList.value.find((file) => file.status === 'paused')
      if (hasPaused) {
        ctrlBtn.value = 'paused'
        return
      }
    }
    ctrlBtn.value = null
  }
)
// 初始化文件列表
onMounted(() => {
  loadList()
  // 监听知识库文件更新事件
  window.electron.ipcRenderer.on(RAG_EVENTS.FILE_UPDATED, (_, data) => {
    const file = fileList.value.find((file) => file.id === data.id)
    if (!file) {
      return
    }
    // 合并所有属性
    Object.assign(file, data)
  })
})
onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeAllListeners(RAG_EVENTS.FILE_UPDATED)
})
</script>
