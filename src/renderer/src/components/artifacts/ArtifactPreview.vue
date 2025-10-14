<template>
  <div>
    <div
      class="flex w-96 max-w-full break-all shadow-sm my-2 items-center gap-2 rounded-lg border bg-card text-card-foreground hover:bg-accent/50 cursor-pointer"
      @click="handleClick"
    >
      <div
        class="shrink-0 w-14 h-14 rounded-lg rounded-r-none inline-flex flex-row justify-center items-center bg-muted border-r"
      >
        <Icon :icon="getArtifactIcon(block.artifact?.type)" class="w-5 h-5 text-muted-foreground" />
      </div>
      <div class="grow w-0">
        <h3 class="text-sm font-medium leading-none tracking-tight truncate">
          {{ block.artifact.title || displayTitle }}
        </h3>
        <p class="text-xs text-muted-foreground mt-0.5">{{ artifactDesc }}</p>
      </div>
      <div class="shrink-0 px-3 h-14 rounded-lg rounded-l-none flex justify-center items-center">
        <Icon
          v-if="props.loading"
          icon="lucide:loader-2"
          class="w-5 h-5 animate-spin text-muted-foreground"
        />
        <Icon v-else icon="lucide:chevron-right" class="w-5 h-5 text-muted-foreground" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useArtifactStore } from '@/stores/artifact'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const artifactStore = useArtifactStore()

// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string, values?: { name?: string; participants?: string }) => {
      if (key === 'artifacts.flowchartOf') return `流程图：${values?.name || ''}`
      if (key === 'artifacts.sequenceDiagramBetween') return `时序图：${values?.participants || ''}`
      if (key === 'artifacts.classDiagramOf') return `类图：${values?.name || ''}`
      if (key === 'artifacts.stateDiagramOf') return `状态图：${values?.name || ''}`
      if (key === 'artifacts.erDiagramOf') return `ER图：${values?.name || ''}`
      if (key === 'artifacts.pieChartOf') return `饼图：${values?.name || ''}`
      if (key === 'artifacts.flowchart') return '流程图'
      if (key === 'artifacts.sequenceDiagram') return '时序图'
      if (key === 'artifacts.classDiagram') return '类图'
      if (key === 'artifacts.stateDiagram') return '状态图'
      if (key === 'artifacts.erDiagram') return 'ER图'
      if (key === 'artifacts.ganttChart') return '甘特图'
      if (key === 'artifacts.pieChart') return '饼图'
      if (key === 'artifacts.mermaidDiagram') return 'Mermaid图表'
      if (key === 'artifacts.codeSnippet') return '代码片段'
      if (key === 'artifacts.function') return '函数'
      if (key === 'artifacts.class') return '类'
      if (key === 'artifacts.reactComponent') return 'React组件'
      if (key === 'artifacts.moduleImport') return '模块导入'
      if (key === 'artifacts.variableDefinition') return `变量：${values?.name || ''}`
      if (key === 'artifacts.markdownDocument') return 'Markdown文档'
      if (key === 'artifacts.htmlDocument') return 'HTML文档'
      if (key === 'artifacts.svgImage') return 'SVG图片'
      if (key === 'artifacts.unknownDocument') return '未知文档'
      if (key === 'artifacts.clickToOpen') return '点击打开'
      return key
    }
  }
})()

const props = defineProps<{
  block: {
    artifact: {
      identifier: string
      type: string
      title: string
      language?: string
    }
    content: string
  }
  messageId: string
  threadId: string
  loading?: boolean
}>()

const displayTitle = computed(() => {
  const { type, title } = props.block.artifact
  const content = props.block.content

  // 直接处理 Mermaid 图表
  if (type === 'application/vnd.ant.mermaid') {
    const lines = content.trim().split('\n')
    const firstLine = lines[0].toLowerCase()
    let chartType = ''
    let chartTitle = ''

    // 先确定图表类型
    if (firstLine.includes('flowchart') || firstLine.includes('graph')) {
      chartType = 'flowchart'
    } else if (firstLine.includes('sequencediagram')) {
      chartType = 'sequence'
    } else if (firstLine.includes('classdiagram')) {
      chartType = 'class'
    } else if (firstLine.includes('statediagram')) {
      chartType = 'state'
    } else if (firstLine.includes('erdiagram')) {
      chartType = 'er'
    } else if (firstLine.includes('gantt')) {
      chartType = 'gantt'
    } else if (firstLine.includes('pie')) {
      chartType = 'pie'
    }

    // 先尝试从内容中提取标题
    for (const line of lines) {
      const trimmedLine = line.trim()

      // 跳过空行和图表类型声明行
      if (
        !trimmedLine ||
        trimmedLine
          .toLowerCase()
          .match(
            /^(graph|flowchart|sequencediagram|classdiagram|statediagram|erdiagram|gantt|pie)\b/i
          )
      ) {
        continue
      }

      // 根据图表类型提取标题
      if (chartType === 'flowchart') {
        // 尝试多种节点格式
        const nodePatterns = [
          /([A-Za-z0-9]+)\["([^"]+)"\]/, // 方括号格式
          /([A-Za-z0-9]+)\("([^"]+)"\)/, // 圆括号格式
          /([A-Za-z0-9]+)\['([^']+)'\]/, // 方括号格式（单引号）
          /([A-Za-z0-9]+)\('([^']+)'\)/, // 圆括号格式（单引号）
          /([A-Za-z0-9]+)\[([^\]]+)\]/, // 简单方括号格式
          /([A-Za-z0-9]+)\(([^)]+)\)/ // 简单圆括号格式
        ]

        for (const pattern of nodePatterns) {
          const nodeMatch = trimmedLine.match(pattern)
          if (nodeMatch) {
            chartTitle = nodeMatch[2]
            break
          }
        }
        if (chartTitle) break
      }
    }

    // 如果找到了具体标题，使用对应的格式
    if (chartTitle) {
      const finalTitle =
        chartType === 'flowchart'
          ? t('artifacts.flowchartOf', { name: chartTitle })
          : chartType === 'sequence'
            ? t('artifacts.sequenceDiagramBetween', { participants: chartTitle })
            : chartType === 'class'
              ? t('artifacts.classDiagramOf', { name: chartTitle })
              : chartType === 'state'
                ? t('artifacts.stateDiagramOf', { name: chartTitle })
                : chartType === 'er'
                  ? t('artifacts.erDiagramOf', { name: chartTitle })
                  : chartType === 'pie'
                    ? t('artifacts.pieChartOf', { name: chartTitle })
                    : chartTitle
      return finalTitle
    }

    // 如果没有找到具体标题，使用图表类型
    const defaultTitle =
      chartType === 'flowchart'
        ? t('artifacts.flowchart')
        : chartType === 'sequence'
          ? t('artifacts.sequenceDiagram')
          : chartType === 'class'
            ? t('artifacts.classDiagram')
            : chartType === 'state'
              ? t('artifacts.stateDiagram')
              : chartType === 'er'
                ? t('artifacts.erDiagram')
                : chartType === 'gantt'
                  ? t('artifacts.ganttChart')
                  : chartType === 'pie'
                    ? t('artifacts.pieChart')
                    : t('artifacts.mermaidDiagram')
    return defaultTitle
  }

  // 处理其他类型
  switch (type) {
    case 'application/vnd.ant.code': {
      let codeTitle = title || t('artifacts.codeSnippet')
      const lines = content.split('\n')

      // 尝试从注释中提取标题
      let foundTitle = false
      for (const line of lines) {
        const trimmedLine = line.trim()
        // 跳过空行
        if (!trimmedLine) continue

        // 匹配各种注释格式
        if (
          trimmedLine.startsWith('//') ||
          trimmedLine.startsWith('#') ||
          trimmedLine.startsWith('/*') ||
          trimmedLine.startsWith('"""') ||
          trimmedLine.startsWith("'''")
        ) {
          const commentContent = trimmedLine.replace(/^[/#*\s"']+/, '').trim()
          if (commentContent && commentContent.length > 1) {
            codeTitle = commentContent
            foundTitle = true
            break
          }
        } else {
          // 如果遇到非注释、非空行，就停止搜索
          break
        }
      }

      // 如果没有找到注释标题，尝试其他方式
      if (!foundTitle) {
        // 尝试识别函数定义
        const functionMatch = content.match(/(?:function|def|func)\s+([a-zA-Z_]\w*)\s*\([^)]*\)/)
        if (functionMatch) {
          const funcName = functionMatch[1]
          codeTitle = funcName
            .replace(/[A-Z]/g, ' $&')
            .trim() // 驼峰转空格
            .toLowerCase()
            .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase()) // 首字母大写
            .replace(/_/g, ' ') // 下划线转空格
          codeTitle += t('artifacts.function')
        } else {
          // 尝试识别类定义
          const classMatch = content.match(/(?:class)\s+([a-zA-Z_]\w*)/)
          if (classMatch) {
            const className = classMatch[1]
            codeTitle = className
              .replace(/[A-Z]/g, ' $&')
              .trim()
              .toLowerCase()
              .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
              .replace(/_/g, ' ')
            codeTitle += t('artifacts.class')
          } else {
            // 尝试识别主要的代码特征
            if (content.includes('root.render(<App />);')) {
              codeTitle = t('artifacts.reactComponent')
            } else if (content.includes('import') && content.includes('from')) {
              codeTitle = t('artifacts.moduleImport')
            } else if (
              content.includes('const') ||
              content.includes('let') ||
              content.includes('var')
            ) {
              const varMatch = content.match(/(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=/)
              if (varMatch) {
                codeTitle = t('artifacts.variableDefinition', { name: varMatch[1] })
              }
            }
          }
        }
      }

      return codeTitle
    }
    case 'text/markdown': {
      // 尝试从 Markdown 内容中提取第一个标题
      const headingMatch = content.match(/^#\s+(.+)$/m)
      return headingMatch ? headingMatch[1] : t('artifacts.markdownDocument')
    }
    case 'text/html': {
      // 尝试从 HTML 中提取 title 或第一个标题
      const htmlTitleMatch =
        content.match(/<title>(.+?)<\/title>/i) || content.match(/<h[1-6][^>]*>(.+?)<\/h[1-6]>/i)
      return htmlTitleMatch ? htmlTitleMatch[1] : t('artifacts.htmlDocument')
    }
    case 'image/svg+xml':
      return t('artifacts.svgImage')
    case 'application/vnd.ant.react':
      return t('artifacts.reactComponent')
    default:
      return title || t('artifacts.unknownDocument')
  }
})

const handleClick = () => {
  if (
    artifactStore.isOpen &&
    artifactStore.currentArtifact?.type === props.block.artifact.type &&
    artifactStore.currentArtifact?.title === displayTitle.value &&
    artifactStore.currentArtifact?.content === props.block.content
  ) {
    artifactStore.hideArtifact()
  } else {
    artifactStore.showArtifact(
      {
        id: props.block.artifact.identifier,
        type: props.block.artifact.type,
        language: props.block.artifact.language,
        title: props.block.artifact.title || displayTitle.value,
        content: props.block.content,
        status: 'loaded'
      },
      props.messageId,
      props.threadId,
      { force: true }
    )
  }
}

const getArtifactIcon = (type: string | undefined) => {
  if (!type) return 'lucide:file'
  switch (type) {
    case 'application/vnd.ant.code':
      return 'lucide:square-code'
    case 'text/markdown':
      return 'vscode-icons:file-type-markdown'
    case 'text/html':
      return 'vscode-icons:file-type-html'
    case 'image/svg+xml':
      return 'vscode-icons:file-type-svg'
    case 'application/vnd.ant.mermaid':
      return 'vscode-icons:file-type-mermaid'
    case 'application/vnd.ant.react':
      return 'vscode-icons:file-type-reactts'
    default:
      return 'lucide:file'
  }
}

const artifactDesc = computed(() => {
  const { type } = props.block.artifact
  switch (type) {
    case 'application/vnd.ant.code':
      return 'code'
    case 'text/markdown':
      return 'markdown'
    case 'text/html':
      return 'html'
    case 'image/svg+xml':
      return 'svg'
    case 'application/vnd.ant.mermaid':
      return 'mermaid'
    case 'application/vnd.ant.react':
      return 'react'
    default:
      return 'unknown'
  }
})
</script>
