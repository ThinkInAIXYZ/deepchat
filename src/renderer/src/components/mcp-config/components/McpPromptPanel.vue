<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@shadcn/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useMcpStore } from '@/stores/mcp'
import { useI18n } from 'vue-i18n'
import McpJsonViewer from './McpJsonViewer.vue'
import type { PromptListEntry } from '@shared/presenter'

interface Props {
  serverName?: string
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open')

const mcpStore = useMcpStore()
const { t } = useI18n()

// 本地状态
const selectedPrompt = ref<string>('')
const promptResult = ref<string>('')
const promptParams = ref<string>('{}')
const promptLoading = ref(false)
const jsonPromptError = ref(false)
const isParametersExpanded = ref(false)

// 计算属性：获取当前服务器的提示模板（如果指定了服务器）
const serverPrompts = computed(() => {
  if (props.serverName) {
    return mcpStore.prompts.filter((prompt) => prompt.client.name === props.serverName)
  }
  return mcpStore.prompts
})

watch(open, (newOpen) => {
  if (newOpen) {
    selectedPrompt.value = ''
    promptResult.value = ''
    promptParams.value = '{}'
    isParametersExpanded.value = false
  }
})

// 当选择提示模板时，初始化参数
watch(selectedPrompt, () => {
  promptParams.value = defaultPromptParams.value
  promptResult.value = ''
  isParametersExpanded.value = false
})

// 验证Prompt参数JSON格式
const validatePromptJson = (input: string): boolean => {
  try {
    JSON.parse(input)
    jsonPromptError.value = false
    return true
  } catch (e) {
    jsonPromptError.value = true
    return false
  }
}

// 选择Prompt
const selectPrompt = (prompt: PromptListEntry) => {
  selectedPrompt.value = prompt.name
}

// 调用Prompt
const callPrompt = async (prompt: PromptListEntry) => {
  if (!prompt) return
  if (!validatePromptJson(promptParams.value)) return

  try {
    promptLoading.value = true
    const params = JSON.parse(promptParams.value)
    const result = await mcpStore.getPrompt(prompt, params)

    // 处理返回结果
    if (result && typeof result === 'object') {
      const typedResult = result as Record<string, unknown>
      if ('messages' in typedResult) {
        promptResult.value = JSON.stringify(typedResult.messages, null, 2)
      } else {
        promptResult.value = JSON.stringify(typedResult, null, 2)
      }
    } else {
      promptResult.value = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    }
  } catch (error) {
    console.error('调用Prompt失败:', error)
    promptResult.value = `调用失败: ${error}`
  } finally {
    promptLoading.value = false
  }
}

// 格式化JSON
const formatJson = (input: string): string => {
  try {
    const obj = JSON.parse(input)
    return JSON.stringify(obj, null, 2)
  } catch (e) {
    return input
  }
}

// 格式化提示参数
const formatPromptParams = () => {
  promptParams.value = formatJson(promptParams.value)
}

// 添加计算属性：获取当前选中的提示模板对象
const selectedPromptObj = computed(() => {
  return serverPrompts.value.find((p) => p.name === selectedPrompt.value)
})

// 添加计算属性：获取默认参数模板
const defaultPromptParams = computed(() => {
  if (!selectedPromptObj.value) return '{}'

  // 获取 arguments 字段
  const promptArgs = selectedPromptObj.value.arguments || {}

  // 如果 arguments 是数组，将其转换为对象
  if (Array.isArray(promptArgs)) {
    const argsObject = promptArgs.reduce(
      (acc, arg) => {
        acc[arg.name] = '' // 为每个参数设置空值
        return acc
      },
      {} as Record<string, string>
    )
    return JSON.stringify(argsObject, null, 2)
  }

  // 如果已经是对象，直接返回
  return JSON.stringify(promptArgs, null, 2)
})

// 添加计算属性：获取参数描述
const promptArgsDescription = computed(() => {
  if (!selectedPromptObj.value) return []
  const promptArgs = selectedPromptObj.value.arguments || {}

  if (Array.isArray(promptArgs)) {
    return promptArgs.map((arg) => ({
      name: arg.name,
      description: arg.description || '',
      required: arg.required || false
    }))
  }

  return []
})
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="right"
      class="w-4/5 min-w-[80vw] max-w-[80vw] p-0 bg-white dark:bg-black h-screen flex flex-col gap-0"
    >
      <SheetHeader class="px-4 py-3 border-b bg-card shrink-0">
        <SheetTitle class="flex items-center space-x-2">
          <Icon icon="lucide:message-square-text" class="h-5 w-5 text-primary" />
          <span>{{ props.serverName ? `${props.serverName}` : '' }}</span>
        </SheetTitle>
        <SheetDescription>
          {{ t('mcp.prompts.dialogDescription') }}
        </SheetDescription>
      </SheetHeader>

      <div class="flex flex-col flex-1 overflow-hidden">
        <!-- 小屏幕：提示模板选择下拉菜单 -->
        <div class="shrink-0 px-4 py-4 lg:hidden">
          <Select v-model="selectedPrompt">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('mcp.prompts.selectPrompt')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="prompt in serverPrompts" :key="prompt.name" :value="prompt.name">
                {{ prompt.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 大屏幕：左右分列布局 -->
        <div class="flex-1 flex overflow-hidden min-h-0">
          <!-- 左侧提示模板列表 (仅大屏幕显示) -->
          <div class="hidden lg:flex lg:w-1/3 lg:border-r lg:flex-col">
            <ScrollArea class="flex-1 min-h-0">
              <div v-if="mcpStore.toolsLoading" class="flex justify-center py-8">
                <Icon icon="lucide:loader" class="h-6 w-6 animate-spin text-muted-foreground" />
              </div>

              <div v-else-if="serverPrompts.length === 0" class="text-center py-8">
                <div
                  class="mx-auto w-12 h-12 bg-muted/30 rounded-full flex items-center justify-center mb-3"
                >
                  <Icon icon="lucide:message-square" class="h-5 w-5 text-muted-foreground" />
                </div>
                <p class="text-sm text-muted-foreground">
                  {{ t('mcp.prompts.noPromptsAvailable') }}
                </p>
              </div>

              <div v-else class="p-2 space-y-1">
                <Button
                  v-for="prompt in serverPrompts"
                  :key="prompt.name"
                  variant="ghost"
                  class="w-full justify-start h-auto p-3 text-left"
                  :class="{
                    'bg-accent text-accent-foreground': selectedPrompt === prompt.name
                  }"
                  @click="selectPrompt(prompt)"
                >
                  <div class="flex items-start space-x-2 w-full">
                    <Icon
                      icon="lucide:message-square-text"
                      class="h-4 w-4 text-primary mt-0.5 shrink-0"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm truncate">{{ prompt.name }}</div>
                    </div>
                  </div>
                </Button>
              </div>
            </ScrollArea>
          </div>

          <!-- 右侧详情区域 -->
          <div class="flex-1 flex flex-col overflow-hidden lg:w-2/3 min-h-0">
            <div v-if="!selectedPromptObj" class="flex items-center justify-center h-full">
              <div class="text-center">
                <div
                  class="mx-auto w-12 h-12 bg-muted/30 rounded-full flex items-center justify-center mb-3"
                >
                  <Icon icon="lucide:mouse-pointer-click" class="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 class="text-base font-medium text-foreground mb-2">
                  {{ t('mcp.prompts.selectPrompt') }}
                </h3>
              </div>
            </div>

            <div v-else class="h-full flex flex-col overflow-hidden min-h-0">
              <ScrollArea class="flex-1 min-h-0">
                <div class="px-4 py-4 space-y-4 pb-8">
                  <!-- 提示模板信息 -->
                  <div>
                    <div class="flex items-center space-x-2 mb-2">
                      <Icon icon="lucide:message-square-text" class="h-5 w-5 text-primary" />
                      <h2 class="text-lg font-semibold">
                        {{ selectedPromptObj.name }}
                      </h2>
                    </div>
                    <p class="text-sm text-secondary-foreground">
                      {{ selectedPromptObj.description || t('mcp.prompts.noDescription') }}
                    </p>
                  </div>

                  <!-- 参数说明（可折叠） -->
                  <div v-if="promptArgsDescription.length > 0" class="border rounded-lg">
                    <Button
                      variant="ghost"
                      class="w-full justify-between p-3 h-auto"
                      @click="isParametersExpanded = !isParametersExpanded"
                    >
                      <span class="font-medium"
                        >{{ t('mcp.prompts.parameters') }} ({{
                          promptArgsDescription.length
                        }})</span
                      >
                      <Icon
                        :icon="isParametersExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                        class="h-4 w-4"
                      />
                    </Button>
                    <div v-if="isParametersExpanded" class="px-3 pb-3 space-y-2">
                      <div
                        v-for="arg in promptArgsDescription"
                        :key="arg.name"
                        class="p-2 bg-muted/30 rounded-md border border-border/30"
                      >
                        <div class="flex items-center space-x-1 mb-1">
                          <code class="text-xs font-mono font-medium text-foreground">{{
                            arg.name
                          }}</code>
                          <Badge
                            v-if="arg.required"
                            variant="destructive"
                            class="text-xs px-1 py-0"
                          >
                            {{ t('mcp.prompts.required') }}
                          </Badge>
                        </div>
                        <p v-if="arg.description" class="text-xs text-muted-foreground">
                          {{ arg.description }}
                        </p>
                      </div>
                    </div>
                  </div>

                  <!-- 参数输入（调试区域） -->
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <h3 class="text-sm font-medium text-foreground">
                        {{ t('mcp.prompts.input') }}
                      </h3>
                      <div class="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-6 text-xs px-2"
                          @click="promptParams = defaultPromptParams"
                        >
                          <Icon icon="lucide:refresh-cw" class="mr-1 h-3 w-3" />
                          {{ t('mcp.prompts.resetToDefault') }}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-6 text-xs px-2"
                          @click="formatPromptParams"
                        >
                          <Icon icon="lucide:align-left" class="mr-1 h-3 w-3" />
                          {{ t('common.format') }}
                        </Button>
                      </div>
                    </div>

                    <div class="relative">
                      <textarea
                        v-model="promptParams"
                        class="flex h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        :class="{ 'border-destructive': jsonPromptError }"
                        placeholder="{}"
                        @input="validatePromptJson(promptParams)"
                        @blur="promptParams = formatJson(promptParams)"
                      />
                      <div
                        v-if="jsonPromptError"
                        class="absolute right-3 top-3 text-xs text-destructive"
                      >
                        {{ t('mcp.prompts.invalidJson') }}
                      </div>
                    </div>
                    <p class="text-xs text-muted-foreground">
                      {{ t('mcp.prompts.parametersHint') }}
                    </p>

                    <!-- 执行按钮 -->
                    <Button
                      class="w-full"
                      :disabled="promptLoading || jsonPromptError"
                      @click="callPrompt(selectedPromptObj as PromptListEntry)"
                    >
                      <Icon
                        v-if="promptLoading"
                        icon="lucide:loader"
                        class="mr-2 h-4 w-4 animate-spin"
                      />
                      <Icon v-else icon="lucide:play" class="mr-2 h-4 w-4" />
                      {{
                        promptLoading
                          ? t('mcp.prompts.runningPrompt')
                          : t('mcp.prompts.executeButton')
                      }}
                    </Button>
                  </div>

                  <!-- 结果显示 -->
                  <div v-if="promptResult">
                    <McpJsonViewer
                      :content="promptResult"
                      :title="t('mcp.prompts.resultTitle')"
                      readonly
                    />
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
