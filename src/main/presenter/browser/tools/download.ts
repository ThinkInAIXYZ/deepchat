import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const DownloadListArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)')
})

const DownloadFileArgsSchema = z.object({
  url: z.string().url().describe('File URL to download'),
  savePath: z.string().optional().describe('Optional file path to save as'),
  tabId: z
    .string()
    .optional()
    .describe('Tab identifier to use for download context (defaults to active tab)')
})

export function createDownloadTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_get_download_list',
      description: 'Get download items for the current browser session.',
      schema: DownloadListArgsSchema,
      handler: async () => {
        // Note: Download list functionality needs to be implemented in YoBrowserPresenter
        // For now, return empty list
        const downloads: Array<{
          filename: string
          state: string
          receivedBytes: number
          totalBytes: number
          url: string
        }> = []
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
    },
    {
      name: 'browser_download_file',
      description:
        'Download a file using the browser session, preserving cookies of the active tab.',
      schema: DownloadFileArgsSchema,
      handler: async (args, context) => {
        const parsed = DownloadFileArgsSchema.parse(args)
        if (!context.downloadFile) {
          return {
            content: [{ type: 'text', text: 'Download functionality not available' }],
            isError: true
          }
        }

        try {
          const download = await context.downloadFile(parsed.url, parsed.savePath)
          return {
            content: [
              {
                type: 'text',
                text: `Download started: ${parsed.url}\nStatus: ${download.status}\nID: ${download.id}${
                  download.filePath ? `\nSave path: ${download.filePath}` : ''
                }`
              }
            ]
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          return {
            content: [{ type: 'text', text: `Download failed: ${errorMsg}` }],
            isError: true
          }
        }
      }
    }
  ]
}
