import { AssistantMessageBlock } from '@shared/chat'
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
      | 'application/vnd.ant.react'
    language?: string
  }
  tool_call?: {
    status: 'calling' | 'response' | 'end' | 'error'
    name?: string
    error?: string
  }
}

// 定义可接受的artifact类型
type ArtifactType =
  | 'application/vnd.ant.code'
  | 'text/markdown'
  | 'text/html'
  | 'image/svg+xml'
  | 'application/vnd.ant.mermaid'
  | 'application/vnd.ant.react'
export const useBlockContent = (props: { block: AssistantMessageBlock }) => {
  const processedContent = computed<ProcessedPart[]>(() =>
    props.block.content
      ? generatePart(props.block.content, props.block.status)
      : [{ type: 'text', content: '' }]
  )

  return {
    processedContent
  }
}

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

function generatePart(content: string, status: AssistantMessageBlock['status']): ProcessedPart[] {
  const parts: ProcessedPart[] = []

  // 定义所有可能的标签匹配模式
  const tagPatterns = [
    // antThinking 标签 (闭合)
    {
      name: 'thinking',
      regex: /<antThinking>(.*?)<\/antThinking>/s,
      process: (match: RegExpExecArray) => ({
        type: 'thinking' as const,
        content: match[1].trim(),
        loading: false
      })
    },
    // antThinking 标签 (未闭合)
    {
      name: 'thinking-unclosed',
      regex: /<antThinking>([^<]*)/s,
      process: (match: RegExpExecArray) => ({
        type: 'thinking' as const,
        content: match[1].trim(),
        loading: false
      })
    },
    // antArtifact 标签 (闭合)
    {
      name: 'artifact',
      regex: /<antArtifact\s+([^>]*)>([\s\S]*?)<\/antArtifact>/s,
      process: (match: RegExpExecArray) => {
        const attributesStr = match[1]
        const content = match[2].trim()
        const attributes = parseAttributes(attributesStr)

        return {
          type: 'artifact' as const,
          content,
          loading: false,
          artifact: {
            identifier: attributes.identifier || '',
            title: attributes.title || '',
            type: (attributes.type || 'text/markdown') as ArtifactType,
            language: attributes.language
          }
        }
      }
    },
    // antArtifact 标签 (未闭合)
    {
      name: 'artifact-unclosed',
      // 匹配开始的标签和属性，后面跟着所有剩余内容
      regex:
        /<antArtifact\s+(?=.*\btype="([^"]+)")(?=.*\bidentifier="([^"]+)")(?=.*\btitle="([^"]+)")(?:\s+language="([^"]+)")?\s*(?:[^>]*?)>([\s\S]*)/s,
      process: (match: RegExpExecArray) => {
        // 提取完整的标签内容用于属性匹配
        const openingTag = match[0].substring(0, match[0].indexOf('>') + 1)
        const typeMatch = openingTag.match(/type="([^"]+)"/)
        const identifierMatch = openingTag.match(/identifier="([^"]+)"/)
        const titleMatch = openingTag.match(/title="([^"]+)"/)
        const languageMatch = openingTag.match(/language="([^"]+)"/)

        // 提取内容部分 - 直接使用捕获组获取内容，更可靠
        const content = match[5] ? match[5].trim() : ''

        // 添加调试日志
        // console.log('Processing unclosed artifact:', {
        //   type: typeMatch ? typeMatch[1] : 'text/markdown',
        //   identifier: identifierMatch ? identifierMatch[1] : '',
        //   title: titleMatch ? titleMatch[1] : '',
        //   contentLength: content.length
        // })

        return {
          type: 'artifact' as const,
          content,
          loading: true,
          artifact: {
            identifier: identifierMatch ? identifierMatch[1] : '',
            title: titleMatch ? titleMatch[1] : '',
            type: typeMatch ? (typeMatch[1] as ArtifactType) : 'text/markdown',
            language: languageMatch ? languageMatch[1] : undefined
          }
        }
      }
    },
    // tool_call 标签
    {
      name: 'tool_call',
      regex: /<tool_call(?:\s+([^>]*))?>/,
      process: (match: RegExpExecArray) => {
        const attributes = parseAttributes(match[1])
        return {
          type: 'tool_call' as const,
          content: '',
          loading: true,
          tool_call: {
            status: 'calling' as const,
            name: attributes?.name,
            error: attributes?.error
          }
        }
      }
    },
    // tool_response 标签
    {
      name: 'tool_response',
      regex: /<tool_response(?:\s+([^>]*))?>/,
      process: null // 特殊处理
    },
    // tool_call_end 标签
    {
      name: 'tool_call_end',
      regex: /<tool_call_end(?:\s+([^>]*))?>/,
      process: null // 特殊处理
    },
    // tool_call_error 标签
    {
      name: 'tool_call_error',
      regex: /<tool_call_error(?:\s+([^>]*))?>/,
      process: null // 特殊处理
    },
    {
      name: 'maximum_tool_calls_reached',
      regex: /<maximum_tool_calls_reached(?:\s+([^>]*))?>/,
      process: null // 特殊处理
    }
  ]
  const toolRelatedPatterns = [
    'tool_response',
    'tool_call_end',
    'tool_call_error',
    'tool_call',
    'maximum_tool_calls_reached'
  ]

  // 从头到尾扫描内容
  let currentPosition = 0
  let currentToolCallIndex = -1

  while (currentPosition < content.length) {
    // 尝试匹配所有可能的标签
    let earliestMatch: {
      index: number
      pattern: (typeof tagPatterns)[0]
      match: RegExpExecArray
    } | null = null

    for (const pattern of tagPatterns) {
      // 如果消息正在生成中且是toolcall相关标签，则跳过检测
      if (
        status === 'loading' &&
        [
          'tool_call',
          'tool_response',
          'tool_call_end',
          'tool_call_error',
          'maximum_tool_calls_reached'
        ].includes(pattern.name)
      ) {
        continue
      }

      // 避免lastIndex问题，每次创建新的正则表达式
      const regex = new RegExp(pattern.regex)
      const match = regex.exec(content.substring(currentPosition))

      if (match) {
        const index = match.index + currentPosition

        if (!earliestMatch || index < earliestMatch.index) {
          earliestMatch = { index, pattern, match }
        }
      }
    }

    // 如果找到标签
    if (earliestMatch) {
      // 如果标签前有文本，添加为文本部分
      if (earliestMatch.index > currentPosition) {
        const text = content.substring(currentPosition, earliestMatch.index).trim()
        if (text) {
          parts.push({
            type: 'text',
            content: text
          })
        }
      }

      // 处理找到的标签
      const { pattern, match } = earliestMatch

      // 根据标签类型进行处理
      if (pattern.name === 'tool_call') {
        // 计算标签结束位置
        const tagEndIndex = content.indexOf('>', earliestMatch.index) + 1

        // 寻找下一个工具相关标签
        let nextToolTagIndex = content.length

        for (const tagName of toolRelatedPatterns) {
          const nextTagRegex = new RegExp(`<${tagName}(?:\\s+([^>]*))?>`)
          const nextMatch = nextTagRegex.exec(content.substring(tagEndIndex))

          if (nextMatch) {
            const index = nextMatch.index + tagEndIndex
            if (index < nextToolTagIndex) {
              nextToolTagIndex = index
            }
          }
        }

        const toolCallContent = content.substring(tagEndIndex, nextToolTagIndex).trim()

        const attributes = parseAttributes(match[1])
        parts.push({
          type: 'tool_call',
          content: toolCallContent,
          loading: true,
          tool_call: {
            status: 'calling',
            name: attributes?.name,
            error: attributes?.error
          }
        })

        currentToolCallIndex = parts.length - 1
        currentPosition = nextToolTagIndex
      } else if (pattern.name === 'tool_response') {
        if (currentToolCallIndex !== -1 && parts[currentToolCallIndex].type === 'tool_call') {
          // 计算标签结束位置
          const tagEndIndex = content.indexOf('>', earliestMatch.index) + 1

          // 寻找下一个工具相关标签
          let nextToolTagIndex = content.length

          for (const tagName of toolRelatedPatterns) {
            const nextTagRegex = new RegExp(`<${tagName}(?:\\s+([^>]*))?>`)
            const nextMatch = nextTagRegex.exec(content.substring(tagEndIndex))

            if (nextMatch) {
              const index = nextMatch.index + tagEndIndex
              if (index < nextToolTagIndex) {
                nextToolTagIndex = index
              }
            }
          }

          const responseContent = content.substring(tagEndIndex, nextToolTagIndex).trim()

          // 更新工具调用部分
          parts[currentToolCallIndex].content += '\n' + responseContent
          parts[currentToolCallIndex].tool_call!.status = 'response'

          // 如果有属性
          const attributes = parseAttributes(match[1])
          if (attributes) {
            if (attributes.name) {
              parts[currentToolCallIndex].tool_call!.name = attributes.name
            }
            if (attributes.error) {
              parts[currentToolCallIndex].tool_call!.error = attributes.error
            }
          }

          currentPosition = nextToolTagIndex
        } else {
          // 如果找不到对应的工具调用，跳过此标签
          currentPosition = content.indexOf('>', earliestMatch.index) + 1
        }
      } else if (pattern.name === 'tool_call_end') {
        if (
          currentToolCallIndex !== -1 &&
          parts[currentToolCallIndex].type === 'tool_call' &&
          parts[currentToolCallIndex].tool_call!.status !== 'end'
        ) {
          // 更新为完成状态
          parts[currentToolCallIndex].loading = false
          parts[currentToolCallIndex].tool_call!.status = 'end'

          // 如果有属性
          const attributes = parseAttributes(match[1])
          if (attributes) {
            if (attributes.name) {
              parts[currentToolCallIndex].tool_call!.name = attributes.name
            }
            if (attributes.error) {
              parts[currentToolCallIndex].tool_call!.error = attributes.error
            }
          }
        } else {
          // 补偿机制：找不到对应的tool_call，创建一个新的
          const attributes = parseAttributes(match[1])
          parts.push({
            type: 'tool_call',
            content: '',
            loading: false,
            tool_call: {
              status: 'end',
              name: attributes?.name,
              error: attributes?.error
            }
          })
          currentToolCallIndex = parts.length - 1
        }

        // 移动到标签结束位置
        currentPosition = content.indexOf('>', earliestMatch.index) + 1
      } else if (pattern.name === 'tool_call_error') {
        if (
          currentToolCallIndex !== -1 &&
          parts[currentToolCallIndex].type === 'tool_call' &&
          parts[currentToolCallIndex].tool_call!.status !== 'end'
        ) {
          // 更新为错误状态
          parts[currentToolCallIndex].loading = false
          parts[currentToolCallIndex].tool_call!.status = 'error'

          // 如果有属性
          const attributes = parseAttributes(match[1])
          if (attributes) {
            if (attributes.name) {
              parts[currentToolCallIndex].tool_call!.name = attributes.name
            }
            if (attributes.error) {
              parts[currentToolCallIndex].tool_call!.error = attributes.error
            }
          }
        } else {
          // 补偿机制：找不到对应的tool_call，创建一个新的
          const attributes = parseAttributes(match[1])
          parts.push({
            type: 'tool_call',
            content: '',
            loading: false,
            tool_call: {
              status: 'error',
              name: attributes?.name,
              error: attributes?.error
            }
          })
          currentToolCallIndex = parts.length - 1
        }

        // 移动到标签结束位置
        currentPosition = content.indexOf('>', earliestMatch.index) + 1
      } else if (pattern.name === 'maximum_tool_calls_reached') {
        // 使用标签的处理函数
        parts.push({
          type: 'text',
          content: 'Maximum tool calls reached'
        })
        currentPosition = content.indexOf('>', earliestMatch.index) + 1
      } else if (pattern.process) {
        // 使用标签的处理函数
        parts.push(pattern.process(match))

        // 移动到标签结束位置
        if (pattern.name.includes('unclosed')) {
          // 未闭合标签，移动到匹配内容之后
          if (pattern.name === 'artifact-unclosed') {
            // 对于未闭合的artifact标签，将剩余的所有内容都归属于它
            // console.log(
            //   'Setting currentPosition to end of content for unclosed artifact at index:',
            //   earliestMatch.index
            // )
            // console.log('Content length:', content.length)
            currentPosition = content.length
          } else {
            currentPosition = earliestMatch.index + match[0].length
          }
        } else {
          // 闭合标签，移动到结束标签之后
          const fullTagLength =
            pattern.name === 'thinking'
              ? match[0].length
              : content
                  .substring(earliestMatch.index)
                  .indexOf(
                    '</ant' + pattern.name.charAt(0).toUpperCase() + pattern.name.slice(1) + '>'
                  ) +
                ('</ant' + pattern.name.charAt(0).toUpperCase() + pattern.name.slice(1) + '>')
                  .length

          currentPosition = earliestMatch.index + fullTagLength
        }
      } else {
        // 未知标签类型，跳过
        currentPosition = earliestMatch.index + 1
      }
    } else {
      // 如果没有找到任何标签，添加剩余内容为文本
      const remainingText = content.substring(currentPosition).trim()
      if (remainingText) {
        parts.push({
          type: 'text',
          content: remainingText
        })
      }
      break
    }
  }

  // 如果没有任何部分，返回原始内容
  if (parts.length === 0) {
    return [
      {
        type: 'text',
        content: content
      }
    ]
  }

  return parts
}
