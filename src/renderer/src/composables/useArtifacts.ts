import { computed } from 'vue'
export interface ProcessedPart {
  type: 'text' | 'thinking' | 'artifact' | 'tool_call'
  content: string
  loading?: boolean
  artifact?: {
    identifier: string
    title: string
    type:
      | 'application/vnd.ant.code'
      | 'text/markdown'
      | 'text/html'
      | 'image/svg+xml'
      | 'application/vnd.ant.mermaid'
    language?: string
  }
  tool_call?: {
    status: 'calling' | 'response' | 'end' | 'error'
    name?: string
    error?: string
  }
}
export const useBlockContent = (props: {
  block: {
    content: string
    status?: 'loading' | 'success' | 'error'
    timestamp: number
  }
}) => {
  // 辅助函数: 从后向前找到满足条件的元素索引
  function findLastIndex<T>(array: T[], predicate: (value: T) => boolean): number {
    for (let i = array.length - 1; i >= 0; i--) {
      if (predicate(array[i])) {
        return i
      }
    }
    return -1
  }

  const processedContent = computed<ProcessedPart[]>(() => {
    if (!props.block.content) return [{ type: 'text', content: '' }]
    // if (props.block.status === 'loading') {
    //   return [
    //     {
    //       type: 'text',
    //       content: props.block.content
    //     }
    //   ]
    // }
    // 调试代码：
    // 严格的Markdown代码块检测

    // 正常的内容处理逻辑（提取代码块和Mermaid图表）
    const parts: ProcessedPart[] = []
    let content = props.block.content
    let lastIndex = 0

    // 处理 antThinking 标签
    const thinkingRegex = /<antThinking>(.*?)<\/antThinking>/gs
    let match
    let hasMatchedClosedThinkingTags = false

    while ((match = thinkingRegex.exec(content)) !== null) {
      hasMatchedClosedThinkingTags = true
      // 添加思考前的普通文本
      if (match.index > lastIndex) {
        const text = content.substring(lastIndex, match.index)
        if (text.trim()) {
          parts.push({
            type: 'text',
            content: text
          })
        }
      }

      // 添加思考内容
      parts.push({
        type: 'thinking',
        content: match[1].trim(),
        loading: false
      })

      //console.log(match[0], '\n\n', match[1])

      lastIndex = match.index + match[0].length
    }

    // 如果没有找到闭合的思考标签，尝试查找未闭合的 antThinking 标签
    if (!hasMatchedClosedThinkingTags) {
      // 重置 lastIndex 以便从头开始搜索
      lastIndex = 0
      // 只匹配开始标签的正则表达式
      const unclosedThinkingRegex = /<antThinking>([\s\S]*)/gs

      while ((match = unclosedThinkingRegex.exec(content)) !== null) {
        // 添加 thinking 前的普通文本
        if (match.index > lastIndex) {
          const text = content.substring(lastIndex, match.index)
          if (text.trim()) {
            parts.push({
              type: 'text',
              content: text
            })
          }
        }

        // 添加未闭合标签的思考内容（将剩余所有内容视为思考内容）
        parts.push({
          type: 'thinking',
          content: match[1].trim(),
          loading: false
        })

        lastIndex = match.index + match[0].length
      }
    }

    // 处理 antArtifact 标签
    const artifactRegex =
      /<antArtifact\s+(?=.*\btype="([^"]+)")(?=.*\bidentifier="([^"]+)")(?=.*\btitle="([^"]+)")(?:\s+language="([^"]+)")?\s*(?:[^>]*?)>([\s\S]*?)<\/antArtifact>/gs
    content = props.block.content
    let hasMatchedClosedTags = false
    while ((match = artifactRegex.exec(content)) !== null) {
      hasMatchedClosedTags = true
      // 添加 artifact 前的普通文本
      if (match.index > lastIndex) {
        const text = content.substring(lastIndex, match.index)
        if (text.trim()) {
          parts.push({
            type: 'text',
            content: text
          })
        }
      }

      // 提取完整的标签内容用于属性匹配
      const fullTag = match[0]
      const typeMatch = fullTag.match(/type="([^"]+)"/)
      const identifierMatch = fullTag.match(/identifier="([^"]+)"/)
      const titleMatch = fullTag.match(/title="([^"]+)"/)
      const languageMatch = fullTag.match(/language="([^"]+)"/)
      // 修复内容匹配，使用非贪婪模式匹配所有内容
      const closedContentMatch = fullTag.match(/<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/s)

      // 添加 artifact 内容
      parts.push({
        type: 'artifact',
        content: closedContentMatch ? closedContentMatch[1].trim() : '',
        artifact: {
          identifier: identifierMatch ? identifierMatch[1] : '',
          type: typeMatch
            ? (typeMatch[1] as
                | 'application/vnd.ant.code'
                | 'text/markdown'
                | 'text/html'
                | 'image/svg+xml'
                | 'application/vnd.ant.mermaid')
            : 'text/markdown',
          title: titleMatch ? titleMatch[1] : '',
          language: languageMatch ? languageMatch[1] : undefined
        },
        loading: false
      })

      lastIndex = match.index + match[0].length
    }

    // 如果没有找到闭合的标签，尝试查找未闭合的 antArtifact 标签
    if (!hasMatchedClosedTags) {
      // 重置 lastIndex 以便从头开始搜索
      // 只匹配开始标签的正则表达式
      const unclosedArtifactRegex =
        /<antArtifact\s+(?=.*\btype="([^"]+)")(?=.*\bidentifier="([^"]+)")(?=.*\btitle="([^"]+)")(?:\s+language="([^"]+)")?\s*(?:[^>]*?)>([\s\S]*)/gs

      while ((match = unclosedArtifactRegex.exec(content)) !== null) {
        // 添加 artifact 前的普通文本
        if (match.index > lastIndex) {
          const text = content.substring(lastIndex, match.index)
          if (text.trim()) {
            parts.push({
              type: 'text',
              content: text
            })
          }
        }

        // 提取完整的标签内容用于属性匹配
        const fullTag = match[0]
        const typeMatch = fullTag.match(/type="([^"]+)"/)
        const identifierMatch = fullTag.match(/identifier="([^"]+)"/)
        const titleMatch = fullTag.match(/title="([^"]+)"/)
        const languageMatch = fullTag.match(/language="([^"]+)"/)
        // 提取未闭合标签后的所有内容
        const unclosedContentMatch = fullTag.match(/<antArtifact[^>]*>([\s\S]*)/s)

        // 添加未闭合标签的 artifact 内容
        parts.push({
          type: 'artifact',
          content: unclosedContentMatch ? unclosedContentMatch[1].trim() : '',
          artifact: {
            identifier: identifierMatch ? identifierMatch[1] : '',
            type: typeMatch
              ? (typeMatch[1] as
                  | 'application/vnd.ant.code'
                  | 'text/markdown'
                  | 'text/html'
                  | 'image/svg+xml'
                  | 'application/vnd.ant.mermaid')
              : 'text/markdown',
            title: titleMatch ? titleMatch[1] : '',
            language: languageMatch ? languageMatch[1] : undefined
          },
          loading: true
        })

        lastIndex = match.index + match[0].length
      }
    }

    // 处理工具调用标签
    // 工具调用标签处理逻辑修改为使用这些正则表达式单独匹配各种标签
    // 更新正则表达式以支持带属性的标签
    const toolCallRegex = /<tool_call(?:\s+([^>]*))?>/g
    const toolCallResponseRegex = /<tool_response(?:\s+([^>]*))?>/g
    const toolCallEndRegex = /<tool_call_end(?:\s+([^>]*))?>/g
    const toolCallErrorRegex = /<tool_call_error(?:\s+([^>]*))?>/g

    // 重新设置content和lastIndex
    content = props.block.content
    lastIndex = 0

    // 临时数组，用于存储待处理的标签及其位置
    const tagPositions: Array<{
      type: string
      position: number
      attributes?: Record<string, string>
    }> = []

    // 辅助函数：解析标签属性
    function parseAttributes(attributesStr?: string): Record<string, string> {
      const attributes: Record<string, string> = {}
      if (!attributesStr) return attributes

      // 匹配所有name="value"形式的属性
      const attributeRegex = /(\w+)="([^"]*)"/g
      let attrMatch: RegExpExecArray | null
      while ((attrMatch = attributeRegex.exec(attributesStr)) !== null) {
        const [, name, value] = attrMatch
        attributes[name] = value
      }
      return attributes
    }

    // 查找所有工具调用相关的标签
    let tagMatch: RegExpExecArray | null

    // 查找所有 tool_call 标签
    while ((tagMatch = toolCallRegex.exec(content)) !== null) {
      const attributes = parseAttributes(tagMatch[1])
      tagPositions.push({
        type: 'tool_call',
        position: tagMatch.index,
        attributes
      })
    }

    // 查找所有 tool_response 标签
    while ((tagMatch = toolCallResponseRegex.exec(content)) !== null) {
      const attributes = parseAttributes(tagMatch[1])
      tagPositions.push({
        type: 'tool_response',
        position: tagMatch.index,
        attributes
      })
    }

    // 查找所有 tool_call_end 标签
    while ((tagMatch = toolCallEndRegex.exec(content)) !== null) {
      const attributes = parseAttributes(tagMatch[1])
      tagPositions.push({
        type: 'tool_call_end',
        position: tagMatch.index,
        attributes
      })
    }

    // 查找所有 tool_call_error 标签
    while ((tagMatch = toolCallErrorRegex.exec(content)) !== null) {
      const attributes = parseAttributes(tagMatch[1])
      tagPositions.push({
        type: 'tool_call_error',
        position: tagMatch.index,
        attributes
      })
    }

    // 按位置排序标签
    tagPositions.sort((a, b) => a.position - b.position)

    // 用于记录上一个处理的标签位置
    let lastProcessedTagPosition = lastIndex

    // 处理按顺序排列的标签
    for (let i = 0; i < tagPositions.length; i++) {
      const tag = tagPositions[i]

      // 只有在处理 tool_call 标签时才处理前面的文本
      if (tag.type === 'tool_call') {
        // 添加 tool_call 标签前的文本
        if (tag.position > lastProcessedTagPosition) {
          const text = content.substring(lastProcessedTagPosition, tag.position)
          if (text.trim()) {
            parts.push({
              type: 'text',
              content: text
            })
          }
        }

        // 计算标签结束位置
        const tagEndIndex = content.indexOf('>', tag.position) + 1

        // 获取 tool_call 标签之后的内容，直到下一个标签或文本结束
        const nextTagPosition =
          i < tagPositions.length - 1 ? tagPositions[i + 1].position : content.length

        const toolCallContent = content.substring(tagEndIndex, nextTagPosition)

        // 创建新的工具调用部分
        parts.push({
          type: 'tool_call',
          content: toolCallContent.trim(),
          loading: true,
          tool_call: {
            status: 'calling',
            name: tag.attributes?.name,
            error: tag.attributes?.error
          }
        })

        // 更新已处理标签位置
        lastProcessedTagPosition = nextTagPosition
      } else if (tag.type === 'tool_response') {
        // 寻找最近的一个工具调用部分
        const lastToolCallIndex = findLastIndex(parts, (part) => part.type === 'tool_call')

        if (lastToolCallIndex !== -1) {
          // 计算标签结束位置
          const tagEndIndex = content.indexOf('>', tag.position) + 1

          // 获取 tool_response 标签之后的内容，直到下一个标签
          const nextTagPosition =
            i < tagPositions.length - 1 ? tagPositions[i + 1].position : content.length

          const responseContent = content.substring(tagEndIndex, nextTagPosition)

          // 更新最近的工具调用部分
          parts[lastToolCallIndex].content += '\n' + responseContent.trim()
          parts[lastToolCallIndex].tool_call!.status = 'response'

          // 如果有新的属性，保留现有属性并添加新属性
          if (tag.attributes) {
            if (tag.attributes.name) {
              parts[lastToolCallIndex].tool_call!.name = tag.attributes.name
            }
            if (tag.attributes.error) {
              parts[lastToolCallIndex].tool_call!.error = tag.attributes.error
            }
          }

          // 更新已处理标签位置，但不将此位置作为文本分割点
          lastProcessedTagPosition = nextTagPosition
        }
      } else if (tag.type === 'tool_call_end') {
        // 寻找最近的一个工具调用部分
        const lastToolCallIndex = findLastIndex(parts, (part) => part.type === 'tool_call')

        if (lastToolCallIndex !== -1) {
          // 更新最近的工具调用部分为已完成状态
          parts[lastToolCallIndex].loading = false
          parts[lastToolCallIndex].tool_call!.status = 'end'

          // 如果有新的属性，保留现有属性并添加新属性
          if (tag.attributes) {
            if (tag.attributes.name) {
              parts[lastToolCallIndex].tool_call!.name = tag.attributes.name
            }
            if (tag.attributes.error) {
              parts[lastToolCallIndex].tool_call!.error = tag.attributes.error
            }
          }
        }

        // 计算标签结束位置
        const tagEndIndex = content.indexOf('>', tag.position) + 1

        // 更新已处理标签位置
        lastProcessedTagPosition = tagEndIndex
      } else if (tag.type === 'tool_call_error') {
        // 寻找最近的一个工具调用部分
        const lastToolCallIndex = findLastIndex(parts, (part) => part.type === 'tool_call')

        if (lastToolCallIndex !== -1) {
          // 更新最近的工具调用部分为错误状态
          parts[lastToolCallIndex].loading = false
          parts[lastToolCallIndex].tool_call!.status = 'error'

          // 如果有新的属性，保留现有属性并添加新属性
          if (tag.attributes) {
            if (tag.attributes.name) {
              parts[lastToolCallIndex].tool_call!.name = tag.attributes.name
            }
            if (tag.attributes.error) {
              parts[lastToolCallIndex].tool_call!.error = tag.attributes.error
            }
          }
        }

        // 计算标签结束位置
        const tagEndIndex = content.indexOf('>', tag.position) + 1

        // 更新已处理标签位置
        lastProcessedTagPosition = tagEndIndex
      }
    }

    // 处理剩余的文本
    if (lastProcessedTagPosition < content.length) {
      const text = content.substring(lastProcessedTagPosition)
      if (text.trim()) {
        parts.push({
          type: 'text',
          content: text
        })
      }
    }

    // 如果没有任何特殊标签，返回原始内容
    if (parts.length === 0) {
      return [
        {
          type: 'text',
          content: content
        }
      ]
    }

    // console.log(parts)
    return parts
  })
  return {
    processedContent
  }
}
