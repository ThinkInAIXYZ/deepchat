import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const DownloadListArgsSchema = z.object({
  conversationId: z.string().optional().describe('Conversation/session identifier')
})

export function createDownloadTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_get_download_list',
      description: 'Get download items for the current browser session.',
      schema: DownloadListArgsSchema,
      handler: async (args, context) => {
        const parsed = DownloadListArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const downloads = context.sessionManager.listDownloads(conversationId)
        const formatted =
          downloads.length === 0
            ? 'No downloads yet.'
            : downloads
                .map(
                  (item) =>
                    `- ${item.filename} [${item.state}] ${item.receivedBytes}/${item.totalBytes} bytes (${item.url})`
                )
                .join('\n')

        return {
          content: [
            {
              type: 'text',
              text: formatted
            }
          ]
        }
      }
    }
  ]
}
