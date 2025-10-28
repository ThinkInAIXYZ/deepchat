import { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { CONVERSATION } from '../../../shared/presenter'
import { getNormalizedUserMessageText } from './messageContent'

export type ConversationExportFormat = 'markdown' | 'html' | 'txt'

export function generateExportFilename(
  format: ConversationExportFormat,
  timestamp: Date = new Date()
): string {
  const extension = format === 'markdown' ? 'md' : format
  const formattedTimestamp = timestamp
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19)

  return `export_deepchat_${formattedTimestamp}.${extension}`
}

export function buildConversationExportContent(
  conversation: CONVERSATION,
  messages: Message[],
  format: ConversationExportFormat
): string {
  switch (format) {
    case 'markdown':
      return exportToMarkdown(conversation, messages)
    case 'html':
      return exportToHtml(conversation, messages)
    case 'txt':
      return exportToText(conversation, messages)
    default:
      throw new Error(`不支持的导出格式: ${format}`)
  }
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
          lines.push(`- ${file.name} (${file.mimeType})`)
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
            if (block.extra?.total) {
              lines.push(`找到 ${block.extra.total} 个搜索结果`)
            }
            lines.push('')
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

  lines.push('<!DOCTYPE html>')
  lines.push('<html lang="zh-CN">')
  lines.push('<head>')
  lines.push('  <meta charset="UTF-8">')
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">')
  lines.push(`  <title>${escapeHtml(conversation.title)}</title>`)
  lines.push('  <style>')
  lines.push('    @media (prefers-color-scheme: dark) {')
  lines.push('      body { background: #0f0f23; color: #e4e4e7; }')
  lines.push('      .header { border-bottom-color: #27272a; }')
  lines.push('      .message { border-left-color: #3f3f46; }')
  lines.push('      .user-message { border-left-color: #3b82f6; background: #1e293b; }')
  lines.push('      .assistant-message { border-left-color: #10b981; background: #064e3b; }')
  lines.push('      .tool-call { background: #1f2937; border-color: #374151; }')
  lines.push('      .search-block { background: #1e3a8a; border-color: #1d4ed8; }')
  lines.push('      .error-block { background: #7f1d1d; border-color: #dc2626; }')
  lines.push('      .reasoning-block { background: #581c87; border-color: #7c3aed; }')
  lines.push('      .code { background: #1f2937; border-color: #374151; color: #f3f4f6; }')
  lines.push('      .attachments { background: #78350f; border-color: #d97706; }')
  lines.push('    }')
  lines.push(
    '    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.7; max-width: 900px; margin: 0 auto; padding: 32px 24px; background: #ffffff; color: #1f2937; }'
  )
  lines.push(
    '    .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 24px; margin-bottom: 32px; }'
  )
  lines.push(
    '    .header h1 { margin: 0 0 16px 0; font-size: 2rem; font-weight: 700; color: #111827; }'
  )
  lines.push('    .header p { margin: 4px 0; font-size: 0.875rem; color: #6b7280; }')
  lines.push(
    '    .message { margin-bottom: 32px; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1); }'
  )
  lines.push('    .user-message { background: #f8fafc; border-left: 4px solid #3b82f6; }')
  lines.push('    .assistant-message { background: #f0fdf4; border-left: 4px solid #10b981; }')
  lines.push(
    '    .message-header { font-weight: 600; margin-bottom: 12px; color: #374151; font-size: 1rem; }'
  )
  lines.push('    .message-time { font-size: 0.75rem; color: #9ca3af; font-weight: 400; }')
  lines.push(
    '    .tool-call { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0; }'
  )
  lines.push(
    '    .search-block { background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 16px; margin: 12px 0; }'
  )
  lines.push(
    '    .error-block { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 12px 0; color: #991b1b; }'
  )
  lines.push(
    '    .reasoning-block { background: #f5f3ff; border: 1px solid #ede9fe; border-radius: 8px; padding: 16px; margin: 12px 0; }'
  )
  lines.push(
    '    .code { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0; font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.875rem; }'
  )
  lines.push(
    '    .attachments { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 12px 0; }'
  )
  lines.push('    .attachments ul { margin: 8px 0 0 0; padding-left: 20px; }')
  lines.push('    .attachments li { margin: 4px 0; }')
  lines.push('    .section-title { font-weight: 600; margin-bottom: 8px; color: #1f2937; }')
  lines.push(
    '    .divider { height: 1px; background: linear-gradient(90deg, rgba(59,130,246,0.2), rgba(59,130,246,0)); margin: 32px 0; }'
  )
  lines.push('  </style>')
  lines.push('</head>')
  lines.push('<body>')
  lines.push('  <div class="header">')
  lines.push(`    <h1>${escapeHtml(conversation.title)}</h1>`)
  lines.push(`    <p><strong>Export Time:</strong> ${new Date().toLocaleString()}</p>`)
  lines.push(`    <p><strong>Conversation ID:</strong> ${conversation.id}</p>`)
  lines.push(`    <p><strong>Message Count:</strong> ${messages.length}</p>`)
  if (conversation.settings.modelId) {
    lines.push(`    <p><strong>Model:</strong> ${conversation.settings.modelId}</p>`)
  }
  if (conversation.settings.providerId) {
    lines.push(`    <p><strong>Provider:</strong> ${conversation.settings.providerId}</p>`)
  }
  lines.push('  </div>')

  for (const message of messages) {
    const messageTime = new Date(message.timestamp).toLocaleString()

    if (message.role === 'user') {
      const userContent = message.content as UserMessageContent
      const messageText = getNormalizedUserMessageText(userContent)

      lines.push('  <div class="message user-message">')
      lines.push('    <div class="message-header">👤 用户</div>')
      lines.push(`    <div class="message-time">${messageTime}</div>`)
      lines.push('    <div>')
      lines.push(`      ${escapeHtml(messageText).replace(/\n/g, '<br>')}`)
      lines.push('    </div>')

      if (userContent.files && userContent.files.length > 0) {
        lines.push('    <div class="attachments">')
        lines.push('      <div class="section-title">附件</div>')
        lines.push('      <ul>')
        for (const file of userContent.files) {
          const name = escapeHtml(file.name ?? '')
          const mime = file.mimeType ? escapeHtml(file.mimeType) : 'unknown'
          lines.push(`        <li><strong>${name}</strong> <span>(${mime})</span></li>`)
        }
        lines.push('      </ul>')
        lines.push('    </div>')
      }

      if (userContent.links && userContent.links.length > 0) {
        lines.push('    <div class="attachments">')
        lines.push('      <div class="section-title">链接</div>')
        lines.push('      <ul>')
        for (const link of userContent.links) {
          lines.push(`        <li><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>`)
        }
        lines.push('      </ul>')
        lines.push('    </div>')
      }

      lines.push('  </div>')
    } else if (message.role === 'assistant') {
      const assistantBlocks = message.content as AssistantMessageBlock[]

      lines.push('  <div class="message assistant-message">')
      lines.push('    <div class="message-header">🤖 助手</div>')
      lines.push(`    <div class="message-time">${messageTime}</div>`)

      for (const block of assistantBlocks) {
        switch (block.type) {
          case 'content':
            if (block.content) {
              lines.push('    <div>')
              lines.push(`      ${escapeHtml(block.content).replace(/\n/g, '<br>')}`)
              lines.push('    </div>')
            }
            break
          case 'reasoning_content':
            if (block.content) {
              lines.push('    <div class="reasoning-block">')
              lines.push('      <strong>🤔 思考过程</strong>')
              lines.push(`      <div class="code">${escapeHtml(block.content)}</div>`)
              lines.push('    </div>')
            }
            break
          case 'tool_call':
            if (block.tool_call) {
              lines.push('    <div class="tool-call">')
              lines.push(
                `      <strong>🔧 工具调用: ${escapeHtml(block.tool_call.name ?? '')}</strong>`
              )
              if (block.tool_call.params) {
                lines.push('      <div class="section-title">参数</div>')
                lines.push('      <div class="code">')
                try {
                  const params = JSON.parse(block.tool_call.params)
                  lines.push(escapeHtml(JSON.stringify(params, null, 2)))
                } catch {
                  lines.push(escapeHtml(block.tool_call.params))
                }
                lines.push('      </div>')
              }
              if (block.tool_call.response) {
                lines.push('      <div class="section-title">响应</div>')
                lines.push('      <div class="code">')
                lines.push(escapeHtml(block.tool_call.response))
                lines.push('      </div>')
              }
              lines.push('    </div>')
            }
            break
          case 'search':
            lines.push('    <div class="search-block">')
            lines.push('      <strong>🔍 网络搜索</strong>')
            if (block.extra?.total) {
              lines.push(`      <div>找到 ${block.extra.total} 个搜索结果</div>`)
            }
            lines.push('    </div>')
            break
          case 'image':
            lines.push('    <div class="section-title">🖼️ 图片</div>')
            lines.push('    <div>*[图片内容]*</div>')
            break
          case 'error':
            if (block.content) {
              lines.push('    <div class="error-block">')
              lines.push(`      ❌ ${escapeHtml(block.content)}`)
              lines.push('    </div>')
            }
            break
          case 'artifact-thinking':
            if (block.content) {
              lines.push('    <div class="reasoning-block">')
              lines.push('      <strong>💭 创作思考:</strong>')
              lines.push(`      <div class="code">${escapeHtml(block.content)}</div>`)
              lines.push('    </div>')
            }
            break
        }
      }

      lines.push('  </div>')
    }

    lines.push('  <div class="divider"></div>')
  }

  lines.push('</body>')
  lines.push('</html>')

  return lines.join('\n')
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
            if (block.extra?.total) {
              lines.push(`找到 ${block.extra.total} 个搜索结果`)
            }
            lines.push('')
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
