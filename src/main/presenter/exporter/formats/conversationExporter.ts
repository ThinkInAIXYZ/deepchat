import { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { CONVERSATION } from '@shared/presenter'
import { getNormalizedUserMessageText } from '../../agentPresenter/message/messageFormatter'
import { conversationExportTemplates } from '../templates/conversationExportTemplates'
import { NowledgeMemThread } from '@shared/types/nowledgeMem'
import { NowledgeMemExportSummary } from '@shared/types/nowledgeMem'
import {
  buildNowledgeMemExportContent,
  generateNowledgeMemExportFilename,
  validateNowledgeMemThread,
  convertDeepChatToNowledgeMemFormat
} from './nowledgeMemExporter'

export type ConversationExportFormat = 'markdown' | 'html' | 'txt' | 'nowledge-mem'

interface NowledgeMemExportResult {
  valid: boolean
  errors: string[]
  data?: NowledgeMemThread
  summary?: NowledgeMemExportSummary
}

export function generateExportFilename(
  format: ConversationExportFormat,
  conversation?: CONVERSATION,
  timestamp: Date = new Date()
): string {
  if (format === 'nowledge-mem' && conversation) {
    return generateNowledgeMemExportFilename(conversation, timestamp)
  }

  const extension = format === 'markdown' ? 'md' : format === 'nowledge-mem' ? 'json' : format
  const formattedTimestamp = timestamp
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19)

  return `export_deepchat_${formattedTimestamp}.${extension}`
}

export async function buildConversationExportContent(
  conversation: CONVERSATION,
  messages: Message[],
  format: ConversationExportFormat
): Promise<string> {
  switch (format) {
    case 'markdown':
      return exportToMarkdown(conversation, messages)
    case 'html':
      return exportToHtml(conversation, messages)
    case 'txt':
      return exportToText(conversation, messages)
    case 'nowledge-mem':
      return await buildNowledgeMemExportContent(conversation, messages)
    default:
      throw new Error(`Unsupported export format: ${format}`)
  }
}

/**
 * Validates and returns nowledge-mem export data
 */
export async function buildNowledgeMemExportData(
  conversation: CONVERSATION,
  messages: Message[]
): Promise<NowledgeMemExportResult> {
  try {
    const threadData = await convertDeepChatToNowledgeMemFormat(conversation, messages)
    const validation = validateNowledgeMemThread(threadData)

    if (!validation.valid) {
      return {
        valid: false,
        errors: validation.errors
      }
    }

    // Create summary for API submission
    const summary = {
      title: threadData.title,
      description: threadData.metadata?.conversation?.description || '',
      message_count: threadData.messages.length,
      total_tokens: calculateTotalTokens(threadData),
      duration_hours: calculateDurationHours(threadData)
    }

    return {
      valid: true,
      errors: [],
      data: threadData,
      summary
    }
  } catch (err) {
    return {
      valid: false,
      errors: [
        `Failed to build nowledge-mem export data: ${err instanceof Error ? err.message : String(err)}`
      ]
    }
  }
}

function calculateTotalTokens(threadData: NowledgeMemThread): number {
  return threadData.messages.reduce((sum, _, index) => {
    const messageMeta = threadData.metadata?.message_metadata?.find((meta) => meta.index === index)
    return sum + (messageMeta?.tokens?.total || 0)
  }, 0)
}

function calculateDurationHours(threadData: NowledgeMemThread): number {
  if (threadData.messages.length <= 1 || !threadData.metadata?.message_metadata) {
    return 0
  }

  const firstMessageMeta = threadData.metadata.message_metadata.find((meta) => meta.index === 0)
  const lastMessageMeta = threadData.metadata.message_metadata.find(
    (meta) => meta.index === threadData.messages.length - 1
  )

  if (!firstMessageMeta?.timestamp || !lastMessageMeta?.timestamp) {
    return 0
  }

  const durationMs = lastMessageMeta.timestamp - firstMessageMeta.timestamp
  return Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100
}

function exportToMarkdown(conversation: CONVERSATION, messages: Message[]): string {
  const lines: string[] = []

  lines.push(`# ${conversation.title}`)
  lines.push('')
  lines.push(`**Export Time:** ${new Date().toLocaleString()}`)
  lines.push(`**Conversation ID:** ${conversation.id}`)
  lines.push(`**Message Count:** ${messages.length}`)
  if (conversation.settings.modelId) {
    lines.push(`**Model:** ${conversation.settings.modelId}`)
  }
  if (conversation.settings.providerId) {
    lines.push(`**Provider:** ${conversation.settings.providerId}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const message of messages) {
    const messageTime = new Date(message.timestamp).toLocaleString()

    if (message.role === 'user') {
      lines.push(`## 👤 用户 (${messageTime})`)
      lines.push('')

      const userContent = message.content as UserMessageContent
      const messageText = getNormalizedUserMessageText(userContent)

      lines.push(messageText)
      lines.push('')

      if (userContent.files && userContent.files.length > 0) {
        lines.push('**附件:**')
        for (const file of userContent.files) {
          lines.push(`- ${file.name ?? ''} (${file.mimeType ?? 'unknown'})`)
        }
        lines.push('')
      }

      if (userContent.links && userContent.links.length > 0) {
        lines.push('**链接:**')
        for (const link of userContent.links) {
          lines.push(`- ${link}`)
        }
        lines.push('')
      }
    } else if (message.role === 'assistant') {
      lines.push(`## 🤖 助手 (${messageTime})`)
      lines.push('')

      const assistantBlocks = message.content as AssistantMessageBlock[]

      for (const block of assistantBlocks) {
        switch (block.type) {
          case 'content':
            if (block.content) {
              lines.push(block.content)
              lines.push('')
            }
            break
          case 'reasoning_content':
            if (block.content) {
              lines.push('### 🤔 思考过程')
              lines.push('')
              lines.push('```')
              lines.push(block.content)
              lines.push('```')
              lines.push('')
            }
            break
          case 'tool_call':
            if (block.tool_call) {
              lines.push(`### 🔧 工具调用: ${block.tool_call.name ?? ''}`)
              lines.push('')
              if (block.tool_call.params) {
                lines.push('**参数:**')
                lines.push('```json')
                try {
                  const params = JSON.parse(block.tool_call.params)
                  lines.push(JSON.stringify(params, null, 2))
                } catch {
                  lines.push(block.tool_call.params)
                }
                lines.push('```')
                lines.push('')
              }
              if (block.tool_call.response) {
                lines.push('**响应:**')
                lines.push('```')
                lines.push(block.tool_call.response)
                lines.push('```')
                lines.push('')
              }
            }
            break
          case 'search':
            lines.push('### 🔍 网络搜索')
            if (block.extra?.total !== undefined) {
              lines.push(`找到 ${block.extra.total} 个搜索结果`)
            }
            lines.push('')
            break
          case 'mcp_ui_resource':
            if (block.mcp_ui_resource) {
              lines.push('### 🧩 MCP UI 资源')
              lines.push('')
              lines.push(
                `资源: ${block.mcp_ui_resource.uri} (${block.mcp_ui_resource.mimeType ?? ''})`
              )
              lines.push('')
            }
            break
          case 'image':
            lines.push('### 🖼️ 图片')
            lines.push('*[图片内容]*')
            lines.push('')
            break
          case 'error':
            if (block.content) {
              lines.push('### ❌ 错误')
              lines.push('')
              lines.push(`\`${block.content}\``)
              lines.push('')
            }
            break
          case 'artifact-thinking':
            if (block.content) {
              lines.push('### 💭 创作思考')
              lines.push('')
              lines.push('```')
              lines.push(block.content)
              lines.push('```')
              lines.push('')
            }
            break
        }
      }
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

function exportToHtml(conversation: CONVERSATION, messages: Message[]): string {
  const lines: string[] = []
  const { html, styles, templates } = conversationExportTemplates

  const styleLines = styles.map((styleRule) => `    ${styleRule}`).join('\n')
  lines.push(
    ...renderTemplate(html.documentStart, {
      title: escapeHtml(conversation.title),
      styleLines
    })
  )

  const metaRows: string[] = []
  metaRows.push(
    ...renderTemplate(templates.metaRow, {
      label: '导出时间',
      value: escapeHtml(new Date().toLocaleString())
    })
  )
  metaRows.push(
    ...renderTemplate(templates.metaRow, {
      label: '会话 ID',
      value: escapeHtml(conversation.id)
    })
  )
  metaRows.push(
    ...renderTemplate(templates.metaRow, {
      label: '消息数量',
      value: escapeHtml(String(messages.length))
    })
  )
  if (conversation.settings.modelId) {
    metaRows.push(
      ...renderTemplate(templates.metaRow, {
        label: '模型',
        value: escapeHtml(conversation.settings.modelId)
      })
    )
  }
  if (conversation.settings.providerId) {
    metaRows.push(
      ...renderTemplate(templates.metaRow, {
        label: '服务商',
        value: escapeHtml(conversation.settings.providerId)
      })
    )
  }

  lines.push(
    ...renderTemplate(templates.header, {
      title: escapeHtml(conversation.title),
      metaRows: metaRows.join('\n')
    })
  )

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    const messageTime = escapeHtml(new Date(message.timestamp).toLocaleString())

    if (message.role === 'user') {
      const userContent = message.content as UserMessageContent
      const messageText = getNormalizedUserMessageText(userContent)

      const attachmentItems =
        userContent.files?.map((file) =>
          renderTemplate(templates.attachmentItem, {
            name: escapeHtml(file.name ?? ''),
            mime: escapeHtml(file.mimeType ?? 'unknown')
          })
        ) ?? []

      const linkItems =
        userContent.links?.map((link) => {
          const safeHref = sanitizeHref(link)
          return renderTemplate(templates.linkItem, {
            href: escapeHtml(safeHref),
            label: escapeHtml(link)
          })
        }) ?? []

      const attachmentsSection =
        attachmentItems.length > 0
          ? renderTemplate(templates.attachmentsSection, {
              items: attachmentItems.flat().join('\n')
            }).join('\n')
          : ''

      const linksSection =
        linkItems.length > 0
          ? renderTemplate(templates.linksSection, {
              items: linkItems.flat().join('\n')
            }).join('\n')
          : ''

      lines.push(
        ...renderTemplate(templates.userMessage, {
          timestamp: messageTime,
          content: formatInlineHtml(messageText),
          attachmentsSection,
          linksSection
        })
      )
    } else if (message.role === 'assistant') {
      const assistantBlocks = message.content as AssistantMessageBlock[]
      const blockLines: string[] = []

      for (const block of assistantBlocks) {
        switch (block.type) {
          case 'content':
            if (block.content) {
              blockLines.push(
                ...renderTemplate(templates.assistantContent, {
                  content: formatInlineHtml(block.content)
                })
              )
            }
            break
          case 'reasoning_content':
            if (block.content) {
              blockLines.push(
                ...renderTemplate(templates.assistantReasoning, {
                  content: escapeHtml(block.content)
                })
              )
            }
            break
          case 'artifact-thinking':
            if (block.content) {
              blockLines.push(
                ...renderTemplate(templates.assistantArtifact, {
                  content: escapeHtml(block.content)
                })
              )
            }
            break
          case 'tool_call':
            if (block.tool_call) {
              const toolName =
                block.tool_call.name && block.tool_call.name.length > 0
                  ? renderTemplate(templates.assistantToolName, {
                      value: escapeHtml(block.tool_call.name)
                    }).join('\n')
                  : ''

              let toolParams = ''
              if (block.tool_call.params) {
                let paramsContent = block.tool_call.params
                try {
                  const parsed = JSON.parse(block.tool_call.params)
                  paramsContent = JSON.stringify(parsed, null, 2)
                } catch {
                  // keep original params text if JSON.parse fails
                }
                toolParams = renderTemplate(templates.assistantToolParams, {
                  value: escapeHtml(paramsContent)
                }).join('\n')
              }

              const toolResponse =
                block.tool_call.response && block.tool_call.response.length > 0
                  ? renderTemplate(templates.assistantToolResponse, {
                      value: escapeHtml(block.tool_call.response)
                    }).join('\n')
                  : ''

              blockLines.push(
                ...renderTemplate(templates.assistantToolCall, {
                  name: toolName,
                  params: toolParams,
                  response: toolResponse
                })
              )
            }
            break
          case 'search':
            blockLines.push(
              ...renderTemplate(templates.assistantSearch, {
                caption:
                  block.extra?.total !== undefined
                    ? renderTemplate(templates.assistantSearchCaption, {
                        total: escapeHtml(String(block.extra.total))
                      }).join('\n')
                    : ''
              })
            )
            break
          case 'mcp_ui_resource':
            if (block.mcp_ui_resource) {
              blockLines.push(
                ...renderTemplate(templates.assistantContent, {
                  content: formatInlineHtml(
                    `MCP UI 资源: ${block.mcp_ui_resource.uri} (${block.mcp_ui_resource.mimeType ?? ''})`
                  )
                })
              )
            }
            break
          case 'image':
            blockLines.push(...renderTemplate(templates.assistantImage))
            break
          case 'error':
            if (block.content) {
              blockLines.push(
                ...renderTemplate(templates.assistantError, {
                  content: escapeHtml(block.content)
                })
              )
            }
            break
        }
      }

      lines.push(
        ...renderTemplate(templates.assistantMessage, {
          timestamp: messageTime,
          assistantBlocks: blockLines.join('\n')
        })
      )
    }

    if (index < messages.length - 1) {
      lines.push(...renderTemplate(templates.divider))
    }
  }

  lines.push(...renderTemplate(html.documentEnd))

  return lines.join('\n')
}

type TemplateInput = string | string[]

function renderTemplate(
  template: TemplateInput,
  replacements: Record<string, string> = {}
): string[] {
  const source = Array.isArray(template) ? template : [template]
  const output: string[] = []

  for (const line of source) {
    let rendered = line

    for (const [key, value] of Object.entries(replacements)) {
      const token = `{{${key}}}`
      if (rendered.includes(token)) {
        rendered = rendered.split(token).join(value)
      }
    }

    rendered = rendered.replace(/{{\w+}}/g, '')
    output.push(...rendered.split('\n'))
  }

  return output
}

function formatInlineHtml(content: string): string {
  return escapeHtml(content).replace(/\n/g, '<br>')
}

function sanitizeHref(link: string): string {
  const trimmed = link?.trim()
  if (!trimmed) {
    return '#'
  }

  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('#')
  ) {
    return trimmed
  }

  // Allow relative URLs (no scheme)
  if (!/^[a-z][\w+.-]*:/i.test(trimmed)) {
    return trimmed
  }

  return '#'
}

function exportToText(conversation: CONVERSATION, messages: Message[]): string {
  const lines: string[] = []

  lines.push(`${conversation.title}`)
  lines.push(''.padEnd(conversation.title.length, '='))
  lines.push('')
  lines.push(`导出时间: ${new Date().toLocaleString()}`)
  lines.push(`会话ID: ${conversation.id}`)
  lines.push(`消息数量: ${messages.length}`)
  if (conversation.settings.modelId) {
    lines.push(`模型: ${conversation.settings.modelId}`)
  }
  if (conversation.settings.providerId) {
    lines.push(`提供商: ${conversation.settings.providerId}`)
  }
  lines.push('')
  lines.push(''.padEnd(80, '-'))
  lines.push('')

  for (const message of messages) {
    const messageTime = new Date(message.timestamp).toLocaleString()

    if (message.role === 'user') {
      lines.push(`[用户] ${messageTime}`)
      lines.push('')

      const userContent = message.content as UserMessageContent
      const messageText = getNormalizedUserMessageText(userContent)

      lines.push(messageText)
      lines.push('')

      if (userContent.files && userContent.files.length > 0) {
        lines.push('附件:')
        for (const file of userContent.files) {
          lines.push(`- ${file.name} (${file.mimeType})`)
        }
        lines.push('')
      }

      if (userContent.links && userContent.links.length > 0) {
        lines.push('链接:')
        for (const link of userContent.links) {
          lines.push(`- ${link}`)
        }
        lines.push('')
      }
    } else if (message.role === 'assistant') {
      lines.push(`[助手] ${messageTime}`)
      lines.push('')

      const assistantBlocks = message.content as AssistantMessageBlock[]

      for (const block of assistantBlocks) {
        switch (block.type) {
          case 'content':
            if (block.content) {
              lines.push(block.content)
              lines.push('')
            }
            break
          case 'reasoning_content':
            if (block.content) {
              lines.push('[思考过程]')
              lines.push(block.content)
              lines.push('')
            }
            break
          case 'tool_call':
            if (block.tool_call) {
              lines.push(`[工具调用] ${block.tool_call.name ?? ''}`)
              if (block.tool_call.params) {
                lines.push('参数:')
                lines.push(block.tool_call.params)
              }
              if (block.tool_call.response) {
                lines.push('响应:')
                lines.push(block.tool_call.response)
              }
              lines.push('')
            }
            break
          case 'search':
            lines.push('[网络搜索]')
            if (block.extra?.total !== undefined) {
              lines.push(`找到 ${block.extra.total} 个搜索结果`)
            }
            lines.push('')
            break
          case 'mcp_ui_resource':
            if (block.mcp_ui_resource) {
              lines.push('[MCP UI 资源]')
              lines.push(`${block.mcp_ui_resource.uri} (${block.mcp_ui_resource.mimeType ?? ''})`)
              lines.push('')
            }
            break
          case 'image':
            lines.push('[图片内容]')
            lines.push('')
            break
          case 'error':
            if (block.content) {
              lines.push(`[错误] ${block.content}`)
              lines.push('')
            }
            break
          case 'artifact-thinking':
            if (block.content) {
              lines.push('[创作思考]')
              lines.push(block.content)
              lines.push('')
            }
            break
        }
      }
    }

    lines.push(''.padEnd(80, '-'))
    lines.push('')
  }

  return lines.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
