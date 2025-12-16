import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const NavigateArgsSchema = z.object({
  url: z.string().url().describe('URL to navigate to'),
  conversationId: z.string().optional().describe('Conversation/session identifier'),
  newTab: z.boolean().optional().default(false).describe('Open navigation in a new tab')
})

const NavigationOnlyArgsSchema = z.object({
  conversationId: z.string().optional().describe('Conversation/session identifier')
})

export function createNavigateTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to the specified URL.',
      schema: NavigateArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigateArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId, {
          newPage: parsed.newTab,
          url: parsed.url
        })

        return {
          content: [
            {
              type: 'text',
              text: `Navigated to ${parsed.url}\nTitle: ${page.title || 'unknown'}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_go_back',
      description: 'Go back to the previous page in the current tab.',
      schema: NavigationOnlyArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigationOnlyArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        await page.goBack()
        return {
          content: [
            {
              type: 'text',
              text: `Went back. Current URL: ${page.url || 'about:blank'}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_go_forward',
      description: 'Go forward to the next page in the current tab.',
      schema: NavigationOnlyArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigationOnlyArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        await page.goForward()
        return {
          content: [
            {
              type: 'text',
              text: `Went forward. Current URL: ${page.url || 'about:blank'}`
            }
          ]
        }
      }
    }
  ]
}
