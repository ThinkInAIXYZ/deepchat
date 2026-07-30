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
      <div class="flex flex-row gap-2 shrink-0">
        <Button
          v-if="ctrlBtn === 'paused'"
          variant="outline"
          size="sm"
          :disabled="pageActionPending"
          @click="toggleStatus(true)"
          :title="t('settings.knowledgeBase.resumeAllPausedTasks')"
        >
          <Icon icon="lucide:play" class="w-4 h-4 text-green-500" />
        </Button>
        <Button
          v-if="ctrlBtn === 'processing'"
          variant="outline"
          size="sm"
          :disabled="pageActionPending"
          @click="toggleStatus(false)"
          :title="t('settings.knowledgeBase.pauseAllRunningTasks')"
        >
          <Icon icon="lucide:pause" class="w-4 h-4 text-yellow-500" />
        </Button>
        <Button variant="outline" size="sm" :disabled="uploading" @click="openSearchDialog">
          <Icon icon="lucide:search" class="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" :disabled="uploading" @click="onReturn">
          <Icon icon="lucide:corner-down-left" class="w-4 h-4" />
          {{ t('settings.knowledgeBase.return') }}
        </Button>
      </div>
    </div>
    <p v-if="pageError" role="alert" class="text-xs text-destructive">
      {{ pageError }}
    </p>
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
      <div class="flex flex-col gap-2 text-balance">
        <label
          for="upload"
          :class="{ 'pointer-events-none opacity-60': uploading || !surfaceReady }"
        >
          <div
            @dragover.prevent
            @drop.prevent="handleDrop"
            class="h-20 border border-border rounded-lg text-muted-foreground hover:bg-muted/0 transition-colors"
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
                <span class="text-sm" :title="acceptExts.join(', ')">
                  {{
                    t('settings.knowledgeBase.fileSupport', {
                      accept: acceptExts.slice(0, 5).join('，'),
                      count: acceptExts.length
                    })
                  }}
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
          :disabled="uploading || !surfaceReady"
          @change="handleChange"
          :accept="acceptExts.map((ext) => '.' + ext).join(',')"
        />
        <div
          v-if="uploading"
          role="status"
          class="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Spinner class="size-3.5" />
          <span>{{ t('common.loading') }}</span>
        </div>
        <div
          v-if="uploadFailures.length > 0"
          role="alert"
          class="space-y-1 text-xs text-destructive"
        >
          <p>{{ t('settings.knowledgeBase.uploadError') }} ({{ uploadFailures.length }})</p>
          <p
            v-for="failure in uploadFailures.slice(0, 3)"
            :key="failure.id"
            class="truncate"
            :title="`${failure.name}: ${failure.reason}`"
          >
            {{ failure.name }}: {{ failure.reason }}
          </p>
        </div>
        <div v-for="file in fileList" :key="file.id">
          <KnowledgeFileItem
            :file="file"
            :progress="fileProgressById.get(file.id)"
            :disabled="pendingFileActions.has(file.id)"
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
          <div class="flex w-full items-center gap-1 relative">
            <Input
              v-model="searchKey"
              :disabled="loading"
              :placeholder="t('settings.knowledgeBase.searchKnowledgePlaceholder')"
              @update:model-value="searchError = null"
            />
            <Button
              size="sm"
              variant="ghost"
              v-if="searchKey"
              class="absolute right-16 text-xs text-muted-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-zinc-200"
              @click.stop="clearSearchKey"
            >
              <Icon icon="lucide:x" class="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button :disabled="loading || !searchKey.trim()" @click="handleSearch">
              <Icon icon="lucide:search" class="w-4 h-4" />
            </Button>
          </div>
          <p v-if="searchError" role="alert" class="text-xs text-destructive">
            {{ searchError }}
          </p>
          <ScrollArea class="max-h-[calc(100vh-200px)]">
            <div class="relative min-h-[180px]">
              <div v-if="loading" class="absolute flex h-full w-full items-center justify-center">
                <div class="text-center">
                  <Spinner class="mx-auto mb-2 size-6 text-muted-foreground" />
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
                        size="sm"
                        class="absolute right-2 top-1 h-6 w-6 flex items-center justify-center rounded-sm hover:bg-primary/80 hover:text-white transition-colors"
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
              <Empty v-if="searchResult.length === 0 && !loading" class="border-0 py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Icon icon="lucide:book-open-text" />
                  </EmptyMedia>
                  <EmptyDescription>
                    {{ t('settings.knowledgeBase.noData') }}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          </ScrollArea>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@shadcn/components/ui/empty'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Input } from '@shadcn/components/ui/input'
import { createDeviceClient } from '@api/DeviceClient'
import { createFileClient } from '@api/FileClient'
import { createKnowledgeClient } from '@api/KnowledgeClient'
import KnowledgeFileItem from './KnowledgeFileItem.vue'
import type {
  BuiltinKnowledgeConfig,
  KnowledgeFileMessage,
  QueryResult
} from '@shared/types/knowledge'

const props = defineProps<{
  builtinKnowledgeDetail: BuiltinKnowledgeConfig
}>()

const emit = defineEmits<{
  (e: 'hideKnowledgeFile'): void
}>()

const ctrlBtn = computed(() => {
  if (fileList.value.length > 0) {
    const hasProcessing = fileList.value.find((file) => file.status === 'processing')
    if (hasProcessing) {
      return 'processing'
    }
    const hasPaused = fileList.value.find((file) => file.status === 'paused')
    if (hasPaused) {
      return 'paused'
    }
  }
  return null
})

const { t } = useI18n()
// 文件列表
const fileList = ref<KnowledgeFileMessage[]>([])
const pageError = ref<string | null>(null)
const pageActionPending = ref(false)
const uploading = ref(false)
const uploadFailures = ref<Array<{ id: number; name: string; reason: string }>>([])
const pendingFileActions = ref(new Set<string>())
const fileProgressById = reactive(
  new Map<string, { completed: number; error: number; total: number }>()
)
const surfaceReady = ref(false)
let uploadFailureSequence = 0
// 允许的文件扩展名 - 动态加载
const defaultSupported = ['txt', 'md', 'markdown', 'docx', 'pptx', 'pdf']
const acceptExts = ref<string[]>([...defaultSupported])
const deviceClient = createDeviceClient()
const fileClient = createFileClient()
const knowledgeClient = createKnowledgeClient()
let stopFileUpdated: (() => void) | null = null
let stopFileProgress: (() => void) | null = null
// 弹窗状态
const isSearchDialogOpen = ref(false)

// 打开搜索弹窗
const openSearchDialog = () => {
  isSearchDialogOpen.value = true
  searchKey.value = ''
  searchResult.value = []
  copyId.value = ''
  loading.value = false
  searchError.value = null
}

// 返回知识库页面
const onReturn = () => {
  emit('hideKnowledgeFile')
}

const loading = ref<boolean>(false)
const searchKey = ref('')
const searchResult = ref<QueryResult[]>([])
const copyId = ref<string>('')
const searchError = ref<string | null>(null)

// 查询知识库
const handleSearch = async () => {
  const query = searchKey.value.trim()
  if (!query || loading.value) return
  copyId.value = ''
  searchError.value = null
  loading.value = true
  try {
    const res = await knowledgeClient.similarityQuery(props.builtinKnowledgeDetail.id, query)
    searchResult.value = res || []
  } catch (error) {
    console.error('[KnowledgeFile] Search failed', error)
    searchError.value = t('settings.knowledgeBase.searchError')
    searchResult.value = []
  } finally {
    loading.value = false
  }
}

// 复制文本
const handleCopy = (content: string, id: string) => {
  copyId.value = id
  deviceClient.copyText(content)
}

const clearSearchKey = () => {
  searchKey.value = ''
  searchError.value = null
}

// 加载支持的文件扩展名
const loadSupportedExtensions = async () => {
  try {
    const extensions = await knowledgeClient.getSupportedFileExtensions()
    // 保证 defaultSupported 排在最前，且不重复
    const uniqueExts = Array.from(
      new Set(extensions.filter((ext) => !defaultSupported.includes(ext)))
    )
    acceptExts.value = [...defaultSupported, ...uniqueExts]
  } catch (error) {
    console.error('[KnowledgeFile] Failed to load supported extensions', error)
    // 使用回退扩展名列表
    acceptExts.value = [...defaultSupported]
  }
}

// 文件点击上传
const handleChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = input.files
  try {
    if (files && files.length > 0) {
      await handleFileUpload(Array.from(files))
    }
  } finally {
    input.value = ''
  }
}

// 加载文件列表
const loadList = async () => {
  try {
    fileList.value = (await knowledgeClient.listFiles(props.builtinKnowledgeDetail.id)) || []
    fileProgressById.clear()
    pageError.value = null
  } catch (error) {
    console.error('[KnowledgeFile] Failed to load files', error)
    pageError.value = t('common.error.requestFailed')
  }
}

const toggleStatus = async (run: boolean) => {
  if (pageActionPending.value) return
  pageActionPending.value = true
  pageError.value = null
  try {
    const changed = run
      ? await knowledgeClient.resumeAllPausedTasks(props.builtinKnowledgeDetail.id)
      : await knowledgeClient.pauseAllRunningTasks(props.builtinKnowledgeDetail.id)
    if (!changed) {
      pageError.value = t('common.error.operationFailed')
      return
    }
    await loadList()
  } catch (error) {
    console.error('[KnowledgeFile] Failed to change task status', error)
    pageError.value = t('common.error.operationFailed')
  } finally {
    pageActionPending.value = false
  }
}

// 处理文件上传的通用方法
const handleFileUpload = async (files: File[]) => {
  if (!surfaceReady.value || uploading.value || files.length === 0) return
  uploading.value = true
  uploadFailures.value = []

  const addFailure = (file: File, reason?: string) => {
    uploadFailures.value.push({
      id: ++uploadFailureSequence,
      name: file.name,
      reason: reason || t('settings.knowledgeBase.uploadError')
    })
  }

  try {
    for (const file of files) {
      try {
        const path = fileClient.getPathForFile(file)
        const validationResult = await knowledgeClient.validateFile(path)

        if (!validationResult.isSupported) {
          addFailure(
            file,
            t('settings.knowledgeBase.fileSupport', {
              accept: acceptExts.value.slice(0, 5).join(', '),
              count: acceptExts.value.length
            })
          )
          continue
        }

        const result = await knowledgeClient.addFile(props.builtinKnowledgeDetail.id, path)
        if (result.error) {
          addFailure(file)
          continue
        }
        if (result.data) {
          const incoming = result.data
          const existingFile = fileList.value.find((candidate) => candidate.id === incoming.id)
          if (!existingFile) {
            fileList.value.unshift(incoming)
          }
        } else {
          addFailure(file)
        }
      } catch (error) {
        console.error('[KnowledgeFile] Failed to add file', error)
        addFailure(file)
      }
    }
  } finally {
    uploading.value = false
  }
}

// 上传文件到内置知识库 - 拖拽处理
const handleDrop = async (e: DragEvent) => {
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    await handleFileUpload(Array.from(e.dataTransfer.files))
  }
}

// 刪除文件
const deleteFile = async (fileId: string) => {
  if (pendingFileActions.value.has(fileId)) return
  pendingFileActions.value.add(fileId)
  pageError.value = null
  try {
    const deleted = await knowledgeClient.deleteFile(props.builtinKnowledgeDetail.id, fileId)
    if (!deleted) {
      pageError.value = t('common.error.operationFailed')
      return
    }
    fileList.value = fileList.value.filter((file) => file.id !== fileId)
    fileProgressById.delete(fileId)
  } catch (error) {
    console.error('[KnowledgeFile] Failed to delete file', error)
    pageError.value = t('common.error.operationFailed')
  } finally {
    pendingFileActions.value.delete(fileId)
  }
}

// 重新上传文件
const reAddFile = async (file: KnowledgeFileMessage) => {
  if (pendingFileActions.value.has(file.id)) return
  pendingFileActions.value.add(file.id)
  fileProgressById.delete(file.id)
  try {
    const result = await knowledgeClient.reAddFile(props.builtinKnowledgeDetail.id, file.id)
    if (result.error) {
      file.status = 'error'
      file.metadata = {
        ...file.metadata,
        errorReason: t('settings.knowledgeBase.uploadError')
      }
      return
    }
    if (result.data) {
      Object.assign(file, result.data)
    } else {
      file.status = 'error'
      file.metadata = {
        ...file.metadata,
        errorReason: t('settings.knowledgeBase.uploadError')
      }
    }
  } catch (error) {
    console.error('[KnowledgeFile] Failed to re-add file', error)
    file.status = 'error'
    file.metadata = {
      ...file.metadata,
      errorReason: t('settings.knowledgeBase.uploadError')
    }
  } finally {
    pendingFileActions.value.delete(file.id)
  }
}

// 初始化文件列表和支持的扩展名
onMounted(() => {
  stopFileUpdated = knowledgeClient.onFileUpdated((data) => {
    const file = fileList.value.find((file) => file.id === data.id)
    if (!file) {
      return
    }
    // 合并所有属性
    Object.assign(file, data)
    if (data.status !== 'processing') {
      fileProgressById.delete(data.id)
    }
  })
  stopFileProgress = knowledgeClient.onFileProgress((data) => {
    fileProgressById.set(data.fileId, {
      completed: data.completed,
      error: data.error,
      total: data.total
    })
  })
  void Promise.all([loadList(), loadSupportedExtensions()]).finally(() => {
    surfaceReady.value = true
  })
})
onBeforeUnmount(() => {
  stopFileUpdated?.()
  stopFileUpdated = null
  stopFileProgress?.()
  stopFileProgress = null
  fileProgressById.clear()
})
</script>
