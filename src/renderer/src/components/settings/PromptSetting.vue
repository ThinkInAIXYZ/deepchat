<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full flex flex-col gap-4 p-4">
      <!-- 页面标题和操作按钮 -->
      <div class="flex flex-row items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon icon="lucide:book-open-text" class="w-5 h-5 text-primary" />
          <span class="text-lg font-semibold">{{ t('promptSetting.title') }}</span>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="exportPrompts">
            <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
            {{ t('promptSetting.export') }}
          </Button>
          <Button variant="outline" size="sm" @click="importPrompts">
            <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
            {{ t('promptSetting.import') }}
          </Button>
          <Button variant="default" size="sm" @click="openAddDialog = true">
            <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
            {{ t('common.add') }}
          </Button>
        </div>
      </div>

      <!-- 默认系统提示词设置区域 -->
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <Icon
              :icon="getStatusIcon()"
              :class="[
                'w-5 h-5 transition-colors duration-200',
                getStatusColor(),
                defaultPromptSaveStatus === 'saving' ? 'animate-spin' : ''
              ]"
            />
            <Label class="text-base font-medium">{{
              t('promptSetting.defaultSystemPrompt')
            }}</Label>
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              <span v-if="defaultPromptSaveStatus === 'typing'">{{
                t('promptSetting.typing')
              }}</span>
              <span v-else-if="defaultPromptSaveStatus === 'saving'">{{
                t('promptSetting.saving')
              }}</span>
              <span v-else-if="defaultPromptSaveStatus === 'saved'">{{
                t('promptSetting.saved')
              }}</span>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-3 text-xs"
              :disabled="defaultPromptSaveStatus === 'saving'"
              @click="resetToDefaultPrompt"
            >
              <Icon icon="lucide:rotate-ccw" class="w-3.5 h-3.5" />
              {{ t('settings.promptSetting.resetToDefault') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-3 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground"
              :disabled="defaultPromptSaveStatus === 'saving'"
              @click="clearSystemPrompt"
            >
              <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
              {{ t('settings.promptSetting.clear') }}
            </Button>
          </div>
        </div>
        <div class="space-y-2">
          <textarea
            ref="defaultPromptTextarea"
            v-model="defaultSystemPrompt"
            class="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-y-auto"
            :placeholder="t('promptSetting.defaultSystemPromptPlaceholder')"
            @blur="handleDefaultPromptBlur"
          ></textarea>
          <p class="text-xs text-muted-foreground">
            {{ t('promptSetting.defaultSystemPromptDescription') }}
          </p>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="prompts.length === 0" class="text-center text-muted-foreground py-12">
        <Icon icon="lucide:book-open-text" class="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p class="text-lg font-medium">{{ t('promptSetting.noPrompt') }}</p>
        <p class="text-sm mt-1">{{ t('promptSetting.noPromptDesc') }}</p>
      </div>

      <!-- Prompt卡片网格 -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="(prompt, index) in prompts"
          :key="prompt.id"
          class="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors duration-200"
        >
          <!-- 卡片头部 -->
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <div class="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                <Icon icon="lucide:scroll-text" class="w-5 h-5 text-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate" :title="prompt.name">
                  {{ prompt.name }}
                </div>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-xs px-2 py-0.5 bg-muted rounded-md text-muted-foreground">
                    {{ getSourceLabel(prompt.source) }}
                  </span>
                  <span
                    :class="[
                      'text-xs px-2 py-0.5 rounded-md cursor-pointer transition-colors',
                      prompt.enabled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    ]"
                    :title="
                      prompt.enabled
                        ? t('promptSetting.clickToDisable')
                        : t('promptSetting.clickToEnable')
                    "
                    @click="togglePromptEnabled(index)"
                  >
                    {{ prompt.enabled ? t('promptSetting.active') : t('promptSetting.inactive') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-1 flex-shrink-0 ml-2">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                :title="t('common.edit')"
                @click="editPrompt(index)"
              >
                <Icon icon="lucide:pencil" class="w-3.5 h-3.5" />
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    :title="t('common.delete')"
                  >
                    <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{{
                      t('promptSetting.confirmDelete', { name: prompt.name })
                    }}</AlertDialogTitle>
                    <AlertDialogDescription>{{
                      t('promptSetting.confirmDeleteDescription')
                    }}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                    <AlertDialogAction @click="deletePrompt(index)">{{
                      t('common.confirm')
                    }}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <!-- 描述 -->
          <div class="text-xs text-muted-foreground mb-3 line-clamp-2" :title="prompt.description">
            {{ prompt.description || t('promptSetting.noDescription') }}
          </div>

          <!-- 内容预览 -->
          <div class="relative mb-3">
            <div
              :class="[
                'text-xs bg-muted/50 rounded-md p-2 border text-muted-foreground break-all',
                !isExpanded(prompt.id) && 'line-clamp-2'
              ]"
            >
              {{ prompt.content }}
            </div>
            <Button
              v-if="prompt.content.length > 100"
              variant="ghost"
              size="sm"
              class="text-xs text-primary h-6 px-2 mt-1"
              @click="toggleShowMore(prompt.id)"
            >
              {{
                isExpanded(prompt.id) ? t('promptSetting.showLess') : t('promptSetting.showMore')
              }}
            </Button>
          </div>

          <!-- 底部统计信息 -->
          <div class="flex items-center justify-between pt-2 border-t border-border">
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <div class="flex items-center gap-1">
                <Icon icon="lucide:type" class="w-3 h-3" />
                <span>{{ prompt.content.length }}</span>
              </div>
              <div v-if="prompt.parameters?.length" class="flex items-center gap-1">
                <Icon icon="lucide:settings" class="w-3 h-3" />
                <span>{{ prompt.parameters.length }}</span>
              </div>
            </div>
            <div class="text-xs text-muted-foreground">
              {{ formatDate(prompt.id) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增/编辑抽屉窗口 -->
    <Sheet v-model:open="openAddDialog">
      <SheetContent
        side="right"
        class="!w-[75vw] !max-w-[95vw] h-full flex flex-col p-0 bg-background"
      >
        <SheetHeader class="px-6 py-4 border-b bg-card/50">
          <SheetTitle class="flex items-center gap-2">
            <Icon
              :icon="editingIdx === null ? 'lucide:plus-circle' : 'lucide:edit-3'"
              class="w-5 h-5 text-primary"
            />
            <span>
              {{ editingIdx === null ? t('promptSetting.addTitle') : t('promptSetting.editTitle') }}
            </span>
          </SheetTitle>
          <SheetDescription>
            {{
              editingIdx === null
                ? t('promptSetting.addDescription')
                : t('promptSetting.editDescription')
            }}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea class="flex-1 px-6">
          <div class="py-6 space-y-6">
            <!-- 基本信息区域 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 pb-2 border-b border-border">
                <Icon icon="lucide:info" class="w-4 h-4 text-primary" />
                <Label class="text-sm font-medium text-muted-foreground">{{
                  t('promptSetting.basicInfo')
                }}</Label>
              </div>

              <div class="space-y-4">
                <div>
                  <Label class="text-sm font-medium">{{ t('promptSetting.name') }}</Label>
                  <Input
                    v-model="form.name"
                    :placeholder="t('promptSetting.namePlaceholder')"
                    class="mt-2"
                  />
                </div>
                <div>
                  <Label class="text-sm font-medium">{{ t('promptSetting.description') }}</Label>
                  <Input
                    v-model="form.description"
                    :placeholder="t('promptSetting.descriptionPlaceholder')"
                    class="mt-2"
                  />
                </div>
              </div>

              <div class="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="prompt-enabled"
                  :checked="form.enabled"
                  @update:checked="(value) => (form.enabled = value)"
                />
                <Label for="prompt-enabled" class="text-sm">{{
                  t('promptSetting.enablePrompt')
                }}</Label>
              </div>
            </div>

            <!-- 内容区域 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 pb-2 border-b border-border">
                <Icon icon="lucide:file-text" class="w-4 h-4 text-primary" />
                <Label class="text-sm font-medium text-muted-foreground">{{
                  t('promptSetting.content')
                }}</Label>
              </div>

              <div>
                <textarea
                  v-model="form.content"
                  class="w-full min-h-48 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-y"
                  :placeholder="t('promptSetting.contentPlaceholder')"
                ></textarea>
                <p class="text-xs text-muted-foreground mt-2">
                  {{ t('promptSetting.contentTip', { openBrace: '{', closeBrace: '}' }) }}
                </p>
              </div>
            </div>

            <!-- 参数区域 -->
            <div class="space-y-4">
              <div class="flex items-center justify-between pb-2 border-b border-border">
                <div class="flex items-center gap-2">
                  <Icon icon="lucide:settings" class="w-4 h-4 text-primary" />
                  <Label class="text-sm font-medium text-muted-foreground">{{
                    t('promptSetting.parameters')
                  }}</Label>
                </div>
                <Button variant="outline" size="sm" @click="addParameter">
                  <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
                  {{ t('promptSetting.addParameter') }}
                </Button>
              </div>

              <div v-if="form.parameters?.length" class="space-y-4">
                <div
                  v-for="(param, index) in form.parameters"
                  :key="index"
                  class="relative p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <!-- 删除按钮 -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="absolute top-3 right-3 h-7 w-7 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all duration-200"
                    :title="t('common.delete')"
                    @click="removeParameter(index)"
                  >
                    <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
                  </Button>

                  <!-- 参数内容 -->
                  <div class="space-y-4 pr-12">
                    <!-- 参数名称和必填选项 -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div class="md:col-span-2">
                        <Label class="text-sm text-muted-foreground">{{
                          t('promptSetting.parameterName')
                        }}</Label>
                        <Input
                          v-model="param.name"
                          :placeholder="t('promptSetting.parameterNamePlaceholder')"
                          class="mt-2"
                        />
                      </div>
                      <div class="flex items-center gap-2">
                        <Checkbox
                          :id="'required-' + index"
                          :checked="param.required"
                          @update:checked="(value) => (param.required = value)"
                        />
                        <Label :for="'required-' + index" class="text-sm whitespace-nowrap">
                          {{ t('promptSetting.required') }}
                        </Label>
                      </div>
                    </div>

                    <!-- 参数描述 -->
                    <div>
                      <Label class="text-sm text-muted-foreground">{{
                        t('promptSetting.parameterDescription')
                      }}</Label>
                      <Input
                        v-model="param.description"
                        :placeholder="t('promptSetting.parameterDescriptionPlaceholder')"
                        class="mt-2"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else
                class="text-center text-muted-foreground py-12 border-2 border-dashed border-muted rounded-lg bg-muted/20"
              >
                <Icon icon="lucide:settings" class="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p class="text-sm">{{ t('promptSetting.noParameters') }}</p>
                <p class="text-xs text-muted-foreground/70 mt-1">
                  {{ t('promptSetting.noParametersDesc') }}
                </p>
              </div>
            </div>

            <!-- 文件管理区域 -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 pb-2 border-b border-border">
                <Icon icon="lucide:folder" class="w-4 h-4 text-primary" />
                <Label class="text-sm font-medium text-muted-foreground">{{
                  t('promptSetting.fileManagement')
                }}</Label>
              </div>

              <!-- 上传选项 -->
              <div>
                <!-- 上传文件 -->
                <div
                  class="group border-2 border-dashed border-muted rounded-lg p-4 hover:border-primary/50 hover:bg-muted/20 transition-all cursor-pointer"
                  @click="uploadFile"
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors"
                    >
                      <Icon icon="lucide:upload" class="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p class="text-sm font-medium">{{ t('promptSetting.uploadFromDevice') }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{ t('promptSetting.uploadFromDeviceDesc') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 已上传文件列表 -->
              <div v-if="form.files?.length" class="space-y-3">
                <Label class="text-sm text-muted-foreground">{{
                  t('promptSetting.uploadedFiles')
                }}</Label>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div
                    v-for="(file, index) in form.files"
                    :key="index"
                    class="relative p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
                  >
                    <!-- 删除按钮 -->
                    <Button
                      variant="ghost"
                      size="icon"
                      class="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all duration-200"
                      :title="t('common.delete')"
                      @click="removeFile(index)"
                    >
                      <Icon icon="lucide:trash-2" class="w-3 h-3" />
                    </Button>

                    <!-- 文件信息 -->
                    <div class="pr-8">
                      <div class="flex items-center gap-2 mb-2">
                        <div class="p-1.5 bg-primary/10 rounded">
                          <Icon :icon="getMimeTypeIcon(file.type)" class="w-4 h-4 text-primary" />
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium truncate" :title="file.name">
                            {{ file.name }}
                          </p>
                        </div>
                      </div>

                      <div class="flex items-center justify-between text-xs text-muted-foreground">
                        <span
                          class="px-2 py-0.5 bg-muted rounded truncate text-ellipsis whitespace-nowrap flex-1"
                          >{{ file.type || 'unknown' }}</span
                        >
                        <span class="flex-shrink-0">{{ formatFileSize(file.size) }}</span>
                      </div>

                      <p
                        v-if="file.description"
                        class="text-xs text-muted-foreground mt-2 line-clamp-2"
                      >
                        {{ file.description }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 空状态 -->
              <div
                v-else
                class="text-center text-muted-foreground py-12 border-2 border-dashed border-muted rounded-lg bg-muted/20"
              >
                <Icon icon="lucide:folder-open" class="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p class="text-sm">{{ t('promptSetting.noFiles') }}</p>
                <p class="text-xs text-muted-foreground/70 mt-1">
                  {{ t('promptSetting.noFilesUploadDesc') }}
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter class="px-6 py-4 border-t bg-card/50">
          <div class="flex items-center justify-between w-full">
            <div class="text-xs text-muted-foreground">
              {{ form.content.length }} {{ t('promptSetting.characters') }}
            </div>
            <div class="flex items-center gap-3">
              <Button variant="outline" @click="closeDialog">{{ t('common.cancel') }}</Button>
              <Button :disabled="!form.name || !form.content" @click="savePrompt">
                <Icon
                  :icon="editingIdx === null ? 'lucide:plus' : 'lucide:save'"
                  class="w-4 h-4 mr-1"
                />
                {{ t('common.confirm') }}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </ScrollArea>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { usePromptsStore } from '@/stores/prompts'
import { useSettingsStore } from '@/stores/settings'
import { useDebounceFn } from '@vueuse/core'
import { MessageFile } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { nanoid } from 'nanoid'
import { getMimeTypeIcon } from '@/lib/utils'
import { FileItem } from '@shared/presenter'

const { t } = useI18n()
const { toast } = useToast()
const promptsStore = usePromptsStore()
const settingsStore = useSettingsStore()

// 默认系统提示词相关状态
const defaultSystemPrompt = ref('')
const defaultPromptSaveStatus = ref<'idle' | 'typing' | 'saving' | 'saved'>('idle')
const defaultPromptTextarea = ref<HTMLTextAreaElement>()

interface PromptItem {
  id: string
  name: string
  description: string
  content: string
  parameters?: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[] // 关联的文件
  enabled?: boolean // 是否启用
  source?: 'local' | 'imported' | 'builtin' // 来源类型
  createdAt?: number // 创建时间
  updatedAt?: number // 更新时间
}

const prompts = ref<PromptItem[]>([])
const expandedPrompts = ref<Set<string>>(new Set())
const openAddDialog = ref(false)
const editingIdx = ref<number | null>(null)
const form = reactive<PromptItem>({
  id: '',
  name: '',
  description: '',
  content: '',
  parameters: [],
  files: [],
  enabled: true,
  source: 'local'
})

// 安全的深拷贝函数，避免克隆不可序列化的对象
const safeClone = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeClone(item))
  }

  // 对于普通对象，只复制可序列化的属性
  const cloned: Record<string, unknown> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = (obj as Record<string, unknown>)[key]
      // 跳过函数、Symbol和其他不可序列化的值
      if (
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        typeof value !== 'undefined'
      ) {
        cloned[key] = safeClone(value)
      }
    }
  }
  return cloned
}

const loadPrompts = async () => {
  await promptsStore.loadPrompts()

  // 检查是否需要迁移数据（为旧数据添加新字段）
  let needsMigration = false
  const migratedPrompts = promptsStore.prompts.map((prompt) => {
    const hasNewFields = prompt.enabled !== undefined && prompt.source !== undefined
    if (!hasNewFields) {
      needsMigration = true
    }

    return {
      ...prompt,
      enabled: prompt.enabled ?? true, // 默认启用
      source: prompt.source ?? 'local', // 默认本地
      createdAt: prompt.createdAt ?? Date.now(),
      updatedAt: prompt.updatedAt ?? Date.now()
    }
  }) as PromptItem[]

  // 如果需要迁移，保存更新后的数据
  if (needsMigration) {
    try {
      // 使用安全的深拷贝函数
      const safePrompts = migratedPrompts.map((p) => safeClone(toRaw(p)) as PromptItem)
      await promptsStore.savePrompts(safePrompts)
    } catch (error) {
      console.warn('Failed to migrate prompt data:', error)
    }
  }

  prompts.value = migratedPrompts
}

const isExpanded = (promptId: string) => expandedPrompts.value.has(promptId)

const toggleShowMore = (promptId: string) => {
  if (expandedPrompts.value.has(promptId)) {
    expandedPrompts.value.delete(promptId)
  } else {
    expandedPrompts.value.add(promptId)
  }
}

const addParameter = () => {
  if (!form.parameters) {
    form.parameters = []
  }
  form.parameters.push({
    name: '',
    description: '',
    required: true
  })
}

const removeParameter = (index: number) => {
  form.parameters?.splice(index, 1)
}

const resetForm = () => {
  form.id = ''
  form.name = ''
  form.description = ''
  form.content = ''
  form.parameters = []
  form.files = []
  form.enabled = true
  form.source = 'local'
  editingIdx.value = null
}

const savePrompt = async () => {
  if (!form.name || !form.content) return

  const timestamp = Date.now()

  if (editingIdx.value === null) {
    // 新增
    const newPrompt = {
      ...toRaw(form),
      id: timestamp.toString(),
      enabled: form.enabled ?? true,
      source: 'local' as const,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await promptsStore.addPrompt(newPrompt)
  } else {
    // 编辑
    const updatedPrompt = {
      ...toRaw(form),
      updatedAt: timestamp
    }
    await promptsStore.updatePrompt(form.id, updatedPrompt)
  }
  openAddDialog.value = false
  resetForm()
  await loadPrompts()
}

const editPrompt = (idx: number) => {
  const p = prompts.value[idx]
  form.id = p.id
  form.name = p.name
  form.description = p.description
  form.content = p.content
  form.enabled = p.enabled ?? true
  form.source = p.source ?? 'local'
  if (p.parameters) {
    form.parameters = p.parameters.map((param) => {
      return {
        name: param.name,
        description: param.description,
        required: !!param.required
      }
    })
  } else {
    form.parameters = []
  }
  // 复制文件数组
  if (p.files) {
    form.files = [...p.files]
  } else {
    form.files = []
  }
  editingIdx.value = idx
  openAddDialog.value = true
}

const deletePrompt = async (idx: number) => {
  const prompt = prompts.value[idx]
  try {
    await promptsStore.deletePrompt(prompt.id)
    await loadPrompts()
    toast({
      title: t('promptSetting.deleteSuccess'),
      variant: 'default'
    })
  } catch {
    toast({
      title: t('promptSetting.deleteFailed'),
      variant: 'destructive'
    })
  }
}

// 切换提示词启用状态
const togglePromptEnabled = async (idx: number) => {
  const prompt = prompts.value[idx]
  const newEnabled = !(prompt.enabled ?? true) // 处理 undefined 的情况

  try {
    // 更新本地状态
    prompts.value[idx] = {
      ...prompt,
      enabled: newEnabled,
      updatedAt: Date.now()
    }

    // 更新存储
    await promptsStore.updatePrompt(prompt.id, {
      enabled: newEnabled,
      updatedAt: Date.now()
    })

    toast({
      title: newEnabled ? t('promptSetting.enableSuccess') : t('promptSetting.disableSuccess'),
      variant: 'default'
    })
  } catch {
    // 如果更新失败，恢复状态
    await loadPrompts()
    toast({
      title: t('promptSetting.toggleFailed'),
      variant: 'destructive'
    })
  }
}

const exportPrompts = () => {
  try {
    const data = JSON.stringify(
      prompts.value.map((prompt) => toRaw(prompt)),
      null,
      2
    )
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompts.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast({
      title: t('promptSetting.exportSuccess'),
      variant: 'default'
    })
  } catch {
    toast({
      title: t('promptSetting.exportFailed'),
      variant: 'destructive'
    })
  }
}

const importPrompts = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string
          const importedPrompts = JSON.parse(content)

          if (Array.isArray(importedPrompts)) {
            // 获取当前所有提示词
            const currentPrompts = [...prompts.value]

            // 创建一个 Map 来快速查找现有提示词
            const currentPromptsMap = new Map(currentPrompts.map((p) => [p.id, p]))

            let updatedCount = 0
            let addedCount = 0

            // 处理导入的每个提示词
            for (const importedPrompt of importedPrompts) {
              const timestamp = Date.now()

              if (!importedPrompt.id) {
                // 如果导入的提示词没有ID，生成一个新的ID
                importedPrompt.id = timestamp.toString() + Math.random().toString(36).substr(2, 9)
              }

              // 设置导入状态
              if (!importedPrompt.source) {
                importedPrompt.source = 'imported'
              }
              if (importedPrompt.enabled === undefined) {
                importedPrompt.enabled = true
              }
              if (!importedPrompt.createdAt) {
                importedPrompt.createdAt = timestamp
              }
              importedPrompt.updatedAt = timestamp

              if (currentPromptsMap.has(importedPrompt.id)) {
                // 如果ID已存在，更新现有提示词
                const index = currentPrompts.findIndex((p) => p.id === importedPrompt.id)
                if (index !== -1) {
                  currentPrompts[index] = importedPrompt
                  updatedCount++
                }
              } else {
                // 如果ID不存在，添加新提示词
                currentPrompts.push(importedPrompt)
                addedCount++
              }
            }

            // 保存合并后的提示词
            // 使用安全的深拷贝函数，避免克隆错误
            const rawPrompts = currentPrompts.map(
              (prompt) => safeClone(toRaw(prompt)) as PromptItem
            )
            await promptsStore.savePrompts(rawPrompts)
            await loadPrompts()

            toast({
              title: t('promptSetting.importSuccess'),
              description: `${t('promptSetting.importStats', { added: addedCount, updated: updatedCount })}`,
              variant: 'default'
            })
          } else {
            throw new Error('Invalid format: not an array')
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          toast({
            title: t('promptSetting.importFailed'),
            description: `错误: ${errorMessage}`,
            variant: 'destructive'
          })
        }
      }

      reader.onerror = () => {
        toast({
          title: t('promptSetting.importFailed'),
          description: '文件读取失败',
          variant: 'destructive'
        })
      }

      reader.readAsText(file)
    }
  }
  input.click()
}

// 格式化日期
const formatDate = (id: string) => {
  try {
    const timestamp = parseInt(id)
    if (isNaN(timestamp)) {
      return t('promptSetting.customDate')
    }
    const date = new Date(timestamp)
    return date.toLocaleDateString()
  } catch {
    return t('promptSetting.customDate')
  }
}

// 获取来源标签
const getSourceLabel = (source?: string) => {
  switch (source) {
    case 'local':
      return t('promptSetting.sourceLocal')
    case 'imported':
      return t('promptSetting.sourceImported')
    case 'builtin':
      return t('promptSetting.sourceBuiltin')
    default:
      return t('promptSetting.sourceLocal')
  }
}

// 关闭对话框
const closeDialog = () => {
  openAddDialog.value = false
  resetForm()
}

// 保存默认系统提示词的防抖函数
const saveDefaultSystemPrompt = useDebounceFn(async (prompt: string) => {
  if (defaultPromptSaveStatus.value === 'saving') return

  defaultPromptSaveStatus.value = 'saving'
  try {
    await settingsStore.setDefaultSystemPrompt(prompt)
    defaultPromptSaveStatus.value = 'saved'

    // 2秒后重置状态
    setTimeout(() => {
      if (defaultPromptSaveStatus.value === 'saved') {
        defaultPromptSaveStatus.value = 'idle'
      }
    }, 2000)
  } catch {
    defaultPromptSaveStatus.value = 'idle'
    toast({
      title: t('promptSetting.saveDefaultPromptFailed'),
      variant: 'destructive'
    })
  }
}, 1000)

// 监听默认系统提示词变化
watch(defaultSystemPrompt, (newValue) => {
  if (defaultPromptSaveStatus.value !== 'saving') {
    defaultPromptSaveStatus.value = 'typing'
  }
  saveDefaultSystemPrompt(newValue)
})

// 处理输入框失去焦点
const handleDefaultPromptBlur = () => {
  if (defaultPromptSaveStatus.value === 'typing') {
    saveDefaultSystemPrompt(defaultSystemPrompt.value)
  }
}

// 获取状态图标
const getStatusIcon = () => {
  switch (defaultPromptSaveStatus.value) {
    case 'typing':
      return 'lucide:edit-3'
    case 'saving':
      return 'lucide:loader-2'
    case 'saved':
      return 'lucide:check'
    default:
      return 'lucide:settings'
  }
}

// 获取状态颜色
const getStatusColor = () => {
  switch (defaultPromptSaveStatus.value) {
    case 'typing':
      return 'text-blue-500'
    case 'saving':
      return 'text-yellow-500'
    case 'saved':
      return 'text-green-500'
    default:
      return 'text-primary'
  }
}

// 重置为默认系统提示词
const resetToDefaultPrompt = async () => {
  if (defaultPromptSaveStatus.value === 'saving') return

  try {
    defaultPromptSaveStatus.value = 'saving'
    await settingsStore.resetToDefaultPrompt()
    // 重新加载当前值
    defaultSystemPrompt.value = await settingsStore.getDefaultSystemPrompt()
    defaultPromptSaveStatus.value = 'saved'

    toast({
      title: t('settings.promptSetting.resetToDefaultSuccess'),
      variant: 'default'
    })

    // 2秒后重置状态
    setTimeout(() => {
      if (defaultPromptSaveStatus.value === 'saved') {
        defaultPromptSaveStatus.value = 'idle'
      }
    }, 2000)
  } catch {
    defaultPromptSaveStatus.value = 'idle'
    toast({
      title: t('settings.promptSetting.resetToDefaultFailed'),
      variant: 'destructive'
    })
  }
}

// 清空系统提示词
const clearSystemPrompt = async () => {
  if (defaultPromptSaveStatus.value === 'saving') return

  try {
    defaultPromptSaveStatus.value = 'saving'
    await settingsStore.clearSystemPrompt()
    // 清空当前值
    defaultSystemPrompt.value = ''
    defaultPromptSaveStatus.value = 'saved'

    toast({
      title: t('settings.promptSetting.clearSuccess'),
      variant: 'default'
    })

    // 2秒后重置状态
    setTimeout(() => {
      if (defaultPromptSaveStatus.value === 'saved') {
        defaultPromptSaveStatus.value = 'idle'
      }
    }, 2000)
  } catch {
    defaultPromptSaveStatus.value = 'idle'
    toast({
      title: t('settings.promptSetting.clearFailed'),
      variant: 'destructive'
    })
  }
}

const filePresenter = usePresenter('filePresenter')

// 文件管理相关方法
const uploadFile = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.txt,.md,.csv,.json,.xml,.pdf,.doc,.docx'
  input.onchange = async (e) => {
    const files = (e.target as HTMLInputElement).files
    if (files) {
      await Promise.all(
        Array.from(files).map(async (file) => {
          const path = window.api.getPathForFile(file)
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)

          const fileItem: FileItem = {
            id: nanoid(8),
            name: fileInfo.name,
            type: fileInfo.mimeType,
            size: fileInfo.metadata.fileSize,
            path: fileInfo.path,
            description: fileInfo.metadata.fileDescription,
            content: fileInfo.content,
            createdAt: Date.now()
          }

          if (!form.files) {
            form.files = []
          }
          form.files.push(fileItem)
        })
      )
      toast({
        title: t('promptSetting.uploadSuccess'),
        description: `${t('promptSetting.uploadedCount', { count: files.length })}`,
        variant: 'default'
      })
    }
  }
  input.click()
}

const removeFile = (index: number) => {
  if (form.files) {
    form.files.splice(index, 1)
  }
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

onMounted(async () => {
  await loadPrompts()
  // 加载默认系统提示词
  defaultSystemPrompt.value = await settingsStore.getDefaultSystemPrompt()
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
