<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

interface Props {
  content: string
  loading?: boolean
  title?: string
  readonly?: boolean
}

const props = defineProps<Props>()

interface Emits {
  (e: 'copy'): void
  (e: 'format'): void
}

defineEmits<Emits>()

const { t } = useI18n()

// 计算属性：判断内容是否是JSON
const isJsonContent = computed(() => {
  if (!props.content) return false
  try {
    JSON.parse(props.content)
    return true
  } catch (e) {
    return false
  }
})

// 计算属性：解析JSON内容为带有语法高亮的部分
const jsonParts = computed(() => {
  if (!isJsonContent.value || !props.content) return []

  try {
    // 格式化JSON字符串
    const formattedJson = JSON.stringify(JSON.parse(props.content), null, 2)

    // 解析JSON，将其分解为带有类型的部分
    const parts: Array<{ type: string; content: string }> = []

    // 简单的词法分析，识别不同类型的JSON元素
    const regex = /"([^"]+)":|"([^"]+)"|-?\d+\.?\d*|true|false|null|[[\]{}:,]/g
    let match
    let lastIndex = 0

    while ((match = regex.exec(formattedJson)) !== null) {
      // 添加匹配前的空白字符
      if (match.index > lastIndex) {
        parts.push({
          type: 'whitespace',
          content: formattedJson.substring(lastIndex, match.index)
        })
      }

      const value = match[0]

      // 确定元素类型
      if (value.endsWith(':')) {
        // 键
        parts.push({ type: 'key', content: value })
      } else if (value.startsWith('"')) {
        // 字符串值
        parts.push({ type: 'string', content: value })
      } else if (/^-?\d+\.?\d*$/.test(value)) {
        // 数字
        parts.push({ type: 'number', content: value })
      } else if (value === 'true' || value === 'false') {
        // 布尔值
        parts.push({ type: 'boolean', content: value })
      } else if (value === 'null') {
        // null值
        parts.push({ type: 'null', content: value })
      } else if (/^[[\]{}:,]$/.test(value)) {
        // 括号和分隔符
        parts.push({ type: 'bracket', content: value })
      } else {
        // 其他
        parts.push({ type: 'other', content: value })
      }

      lastIndex = regex.lastIndex
    }

    // 添加剩余部分
    if (lastIndex < formattedJson.length) {
      parts.push({
        type: 'whitespace',
        content: formattedJson.substring(lastIndex)
      })
    }

    return parts
  } catch (e) {
    return [{ type: 'text', content: props.content }]
  }
})

// 根据JSON部分类型获取CSS类名
const getJsonPartClass = (type: string): string => {
  switch (type) {
    case 'key':
      return 'json-key'
    case 'string':
      return 'json-string'
    case 'number':
      return 'json-number'
    case 'boolean':
      return 'json-boolean'
    case 'null':
      return 'json-null'
    case 'bracket':
      return 'json-bracket'
    default:
      return ''
  }
}

// 复制到剪贴板
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(props.content)
    // 这里可以添加复制成功的提示
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div class="w-full">
    <!-- 头部工具栏 -->
    <div v-if="title || !readonly" class="flex items-center justify-between mb-3">
      <h4 v-if="title" class="text-sm font-medium text-foreground">{{ title }}</h4>
      <div v-if="!readonly" class="flex space-x-2">
        <Button
          v-if="isJsonContent"
          variant="ghost"
          size="sm"
          class="h-7 text-xs"
          @click="$emit('format')"
        >
          <Icon icon="lucide:align-left" class="mr-1 h-3 w-3" />
          {{ t('common.format') }}
        </Button>
        <Button variant="ghost" size="sm" class="h-7 text-xs" @click="copyToClipboard">
          <Icon icon="lucide:copy" class="mr-1 h-3 w-3" />
          {{ t('common.copy') }}
        </Button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="relative border border-border/50 rounded-lg overflow-hidden bg-muted/20">
      <div v-if="loading" class="flex items-center justify-center py-8">
        <Icon icon="lucide:loader" class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="!content" class="flex items-center justify-center py-8 text-muted-foreground">
        <div class="text-center">
          <Icon icon="lucide:file-text" class="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">{{ t('common.noContent') }}</p>
        </div>
      </div>

      <div v-else class="max-h-96 overflow-auto">
        <!-- JSON高亮显示 -->
        <div v-if="isJsonContent" class="json-viewer p-4">
          <span
            v-for="(part, index) in jsonParts"
            :key="index"
            :class="getJsonPartClass(part.type)"
            >{{ part.content }}</span
          >
        </div>

        <!-- 普通文本显示 -->
        <pre v-else class="text-content p-4 whitespace-pre-wrap break-words text-sm font-mono">{{
          content
        }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.json-viewer {
  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  line-height: 1.6;
  font-size: 13px;
  white-space: pre;
  background: transparent;
}

.text-content {
  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  line-height: 1.6;
  color: var(--foreground);
  background: transparent;
}

.json-key {
  color: hsl(var(--primary));
  font-weight: 600;
}

.json-string {
  color: hsl(142, 76%, 36%);
}

.json-number {
  color: hsl(39, 100%, 50%);
}

.json-boolean {
  color: hsl(221, 83%, 53%);
  font-weight: 600;
}

.json-null {
  color: hsl(var(--destructive));
  font-style: italic;
  font-weight: 600;
}

.json-bracket {
  color: var(--foreground);
  font-weight: 600;
}

/* 暗色主题下的颜色调整 */
.dark .json-string {
  color: hsl(142, 52%, 52%);
}

.dark .json-number {
  color: hsl(39, 80%, 60%);
}

.dark .json-boolean {
  color: hsl(221, 68%, 68%);
}
</style>
