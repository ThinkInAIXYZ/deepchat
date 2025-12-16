import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const BaseArgsSchema = z.object({
  conversationId: z.string().optional().describe('Conversation/session identifier')
})

const NewTabArgsSchema = BaseArgsSchema.extend({
  url: z.string().url().optional().describe('Optional URL to open in the new tab')
})

const SwitchTabArgsSchema = BaseArgsSchema.extend({
  tabId: z.number().int().describe('Window/tab identifier')
})

const CloseTabArgsSchema = BaseArgsSchema.extend({
  tabId: z
    .number()
    .int()
    .optional()
    .describe('Window/tab identifier to close (defaults to active tab)')
})

export function createTabTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_new_tab',
      description: 'Open a new browser tab (window) for the session.',
      schema: NewTabArgsSchema,
      handler: async (args, context) => {
        const parsed = NewTabArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId, {
          newPage: true,
          url: parsed.url
        })

        return {
          content: [
            {
              type: 'text',
              text: `Opened new tab #${page.id}${parsed.url ? ` -> ${parsed.url}` : ''}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_tab_list',
      description: 'List all tabs (windows) for the current session.',
      schema: BaseArgsSchema,
      handler: async (args, context) => {
        const parsed = BaseArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const tabs = context.sessionManager.listPages(conversationId)
        const formatted =
          tabs.length === 0
            ? 'No tabs open.'
            : tabs
                .map(
                  (tab) =>
                    `${tab.isActive ? '*' : ' '} Tab #${tab.id}: ${tab.title || 'Untitled'} (${tab.url || 'about:blank'})`
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
      name: 'browser_switch_tab',
      description: 'Activate a specific tab (window) by its id.',
      schema: SwitchTabArgsSchema,
      handler: async (args, context) => {
        const parsed = SwitchTabArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const tab = context.sessionManager.switchPage(conversationId, parsed.tabId)
        if (!tab) {
          return {
            content: [
              {
                type: 'text',
                text: `Tab ${parsed.tabId} not found`
              }
            ],
            isError: true
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Switched to tab #${tab.id}: ${tab.title || 'Untitled'}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_close_tab',
      description: 'Close a tab (window). Defaults to the active tab.',
      schema: CloseTabArgsSchema,
      handler: async (args, context) => {
        const parsed = CloseTabArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        await context.sessionManager.closePage(conversationId, parsed.tabId)
        return {
          content: [
            {
              type: 'text',
              text: `Closed tab ${parsed.tabId ?? '(active tab)'}`
            }
          ]
        }
      }
    }
  ]
}
