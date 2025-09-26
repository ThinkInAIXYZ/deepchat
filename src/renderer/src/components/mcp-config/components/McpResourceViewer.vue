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
import type { ResourceListEntry } from '@shared/presenter'

interface Props {
  serverName?: string
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open')

const mcpStore = useMcpStore()
const { t } = useI18n()

// 本地状态
const selectedResource = ref<string>('')
const resourceContent = ref<string>('')
const resourceLoading = ref(false)

// 计算属性：获取当前服务器的资源（如果指定了服务器）
const serverResources = computed(() => {
  if (props.serverName) {
    return mcpStore.resources.filter((resource) => resource.client.name === props.serverName)
  }
  return mcpStore.resources
})

watch(open, (newOpen) => {
  if (newOpen) {
    selectedResource.value = ''
    resourceContent.value = ''
  }
})

// 当选择资源时，清空内容
watch(selectedResource, () => {
  resourceContent.value = ''
})

// 选择Resource
const selectResource = (resource: ResourceListEntry) => {
  selectedResource.value = resource.uri
}

// 加载资源内容
const loadResourceContent = async (resource: ResourceListEntry) => {
  if (!resource) return

  try {
    resourceLoading.value = true
    const result = await mcpStore.readResource(resource)

    // 处理返回结果
    if (result && typeof result === 'object') {
      if ('text' in result && result.text) {
        resourceContent.value = result.text
      } else if ('content' in result) {
        const typedResult = result as { content: unknown }
        resourceContent.value =
          typeof typedResult.content === 'string'
            ? typedResult.content
            : JSON.stringify(typedResult.content, null, 2)
      } else {
        resourceContent.value = JSON.stringify(result, null, 2)
      }
    } else {
      resourceContent.value = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    }
  } catch (error) {
    console.error('加载资源内容失败:', error)
    resourceContent.value = `加载失败: ${error}`
  } finally {
    resourceLoading.value = false
  }
}

// 添加计算属性：获取当前选中的资源对象
const selectedResourceObj = computed(() => {
  return serverResources.value.find((r) => r.uri === selectedResource.value)
})

// 获取资源类型图标
const getResourceIcon = (uri: string) => {
  if (uri.endsWith('.json')) return 'lucide:file-json'
  if (uri.endsWith('.txt')) return 'lucide:file-text'
  if (uri.endsWith('.md')) return 'lucide:file-text'
  if (uri.endsWith('.csv')) return 'lucide:file-spreadsheet'
  if (uri.endsWith('.xml')) return 'lucide:file-code'
  if (uri.startsWith('http')) return 'lucide:globe'
  return 'lucide:file'
}

// 获取资源类型
const getResourceType = (uri: string) => {
  if (uri.endsWith('.json')) return 'JSON'
  if (uri.endsWith('.txt')) return 'Text'
  if (uri.endsWith('.md')) return 'Markdown'
  if (uri.endsWith('.csv')) return 'CSV'
  if (uri.endsWith('.xml')) return 'XML'
  if (uri.startsWith('http')) return 'URL'
  return 'File'
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      side="right"
      class="w-4/5 min-w-[80vw] max-w-[80vw] p-0 bg-white dark:bg-black h-screen flex flex-col gap-0"
    >
      <SheetHeader class="px-4 py-3 border-b bg-card shrink-0">
        <SheetTitle class="flex items-center space-x-2">
          <Icon icon="lucide:folder" class="h-5 w-5 text-primary" />
          <span>{{ props.serverName ? `${props.serverName} Resources` : 'MCP Resources' }}</span>
        </SheetTitle>
        <SheetDescription>
          {{ t('mcp.resources.dialogDescription') }}
        </SheetDescription>
      </SheetHeader>

      <div class="flex flex-col flex-1 overflow-hidden">
        <!-- 小屏幕：资源选择下拉菜单 -->
        <div class="shrink-0 px-4 py-4 lg:hidden">
          <Select v-model="selectedResource">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Select a resource" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="resource in serverResources"
                :key="resource.uri"
                :value="resource.uri"
              >
                {{ resource.name || resource.uri }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 大屏幕：左右分列布局 -->
        <div class="flex-1 flex overflow-hidden min-h-0">
          <!-- 左侧资源列表 (仅大屏幕显示) -->
          <div class="hidden lg:flex lg:w-1/3 lg:border-r lg:flex-col">
            <ScrollArea class="flex-1 min-h-0">
              <div v-if="mcpStore.toolsLoading" class="flex justify-center py-8">
                <Icon icon="lucide:loader" class="h-6 w-6 animate-spin text-muted-foreground" />
              </div>

              <div v-else-if="serverResources.length === 0" class="text-center py-8">
                <div
                  class="mx-auto w-12 h-12 bg-muted/30 rounded-full flex items-center justify-center mb-3"
                >
                  <Icon icon="lucide:folder" class="h-5 w-5 text-muted-foreground" />
                </div>
                <p class="text-sm text-muted-foreground">No resources available</p>
              </div>

              <div v-else class="p-2 space-y-1">
                <Button
                  v-for="resource in serverResources"
                  :key="resource.uri"
                  variant="ghost"
                  class="w-full justify-start h-auto p-3 text-left"
                  :class="{
                    'bg-accent text-accent-foreground': selectedResource === resource.uri
                  }"
                  @click="selectResource(resource)"
                >
                  <div class="flex items-start space-x-2 w-full">
                    <Icon
                      :icon="getResourceIcon(resource.uri)"
                      class="h-4 w-4 text-primary mt-0.5 shrink-0"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm truncate">
                        {{ resource.name || resource.uri }}
                      </div>
                      <div class="text-xs text-muted-foreground truncate mt-1">
                        {{ resource.uri }}
                      </div>
                      <div class="flex items-center mt-2 space-x-1">
                        <Badge variant="outline" class="text-xs">
                          {{ resource.client.name }}
                        </Badge>
                        <Badge variant="secondary" class="text-xs">
                          {{ getResourceType(resource.uri) }}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Button>
              </div>
            </ScrollArea>
          </div>

          <!-- 右侧详情区域 -->
          <div class="flex-1 flex flex-col overflow-hidden lg:w-2/3 min-h-0">
            <div v-if="!selectedResourceObj" class="flex items-center justify-center h-full">
              <div class="text-center">
                <div
                  class="mx-auto w-12 h-12 bg-muted/30 rounded-full flex items-center justify-center mb-3"
                >
                  <Icon icon="lucide:mouse-pointer-click" class="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 class="text-base font-medium text-foreground mb-2">Select a resource</h3>
              </div>
            </div>

            <div v-else class="h-full flex flex-col overflow-hidden min-h-0">
              <ScrollArea class="flex-1 min-h-0">
                <div class="px-4 py-4 space-y-4 pb-8">
                  <!-- 资源信息 -->
                  <div>
                    <div class="flex items-center space-x-2 mb-2">
                      <Icon
                        :icon="getResourceIcon(selectedResourceObj.uri)"
                        class="h-5 w-5 text-primary"
                      />
                      <h2 class="text-lg font-semibold">
                        {{ selectedResourceObj.name || selectedResourceObj.uri }}
                      </h2>
                    </div>
                    <div class="flex items-center mt-2 space-x-2">
                      <Badge variant="outline">{{ selectedResourceObj.client.name }}</Badge>
                      <Badge variant="secondary">{{
                        getResourceType(selectedResourceObj.uri)
                      }}</Badge>
                    </div>
                  </div>

                  <!-- 资源URI -->
                  <div class="space-y-2">
                    <h3 class="text-sm font-medium text-foreground">Resource URI</h3>
                    <div class="p-2 bg-muted/30 rounded-md border border-border/30">
                      <code class="text-xs font-mono text-foreground break-all">{{
                        selectedResourceObj.uri
                      }}</code>
                    </div>
                  </div>

                  <!-- 加载资源按钮 -->
                  <div>
                    <Button
                      class="w-full"
                      :disabled="resourceLoading"
                      @click="loadResourceContent(selectedResourceObj as ResourceListEntry)"
                    >
                      <Icon
                        v-if="resourceLoading"
                        icon="lucide:loader"
                        class="mr-2 h-4 w-4 animate-spin"
                      />
                      <Icon v-else icon="lucide:download" class="mr-2 h-4 w-4" />
                      {{ resourceLoading ? 'Loading...' : 'Load Content' }}
                    </Button>
                  </div>

                  <!-- 资源内容显示 -->
                  <div v-if="resourceContent || resourceLoading">
                    <McpJsonViewer
                      :content="resourceContent"
                      :loading="resourceLoading"
                      title="Resource Content"
                      readonly
                    />
                  </div>

                  <!-- 空状态 -->
                  <div v-else class="text-center py-12">
                    <div
                      class="mx-auto w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mb-4"
                    >
                      <Icon icon="lucide:file-text" class="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 class="text-sm font-medium text-foreground mb-2">No content loaded</h3>
                    <p class="text-xs text-muted-foreground">
                      Click "Load Content" to view the resource
                    </p>
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
