import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const BaseArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)')
})

const NewTabArgsSchema = z.object({
  url: z.string().url().optional().describe('Optional URL to open in the new tab')
})

const SwitchTabArgsSchema = z.object({
  tabId: z.string().describe('Tab identifier to activate')
})

const CloseTabArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier to close (defaults to active tab)')
})

export function createTabTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_new_tab',
      description: 'Open a new browser tab (window) for the session.',
      schema: NewTabArgsSchema,
      handler: async (args, context) => {
        const parsed = NewTabArgsSchema.parse(args)
        if (!context.createTab) {
          return {
            content: [{ type: 'text', text: 'Tab creation not available' }],
            isError: true
          }
        }
        const tab = await context.createTab(parsed.url)
        if (!tab) {
          return {
            content: [{ type: 'text', text: 'Failed to create new tab' }],
            isError: true
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Opened new tab ${tab.id}${parsed.url ? ` -> ${parsed.url}` : ''}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_tab_list',
      description: 'List all tabs (windows) for the current session.',
      schema: BaseArgsSchema,
      handler: async (_args, context) => {
        if (!context.listTabs) {
          return {
            content: [{ type: 'text', text: 'Tab list not available' }],
            isError: true
          }
        }
        const tabs = await context.listTabs()
        const formatted =
          tabs.length === 0
            ? 'No tabs open.'
            : tabs
                .map(
                  (tab) =>
                    `${tab.isActive ? '*' : ' '} Tab ${tab.id}: ${tab.title || 'Untitled'} (${tab.url || 'about:blank'})`
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
        if (!context.activateTab) {
          return {
            content: [{ type: 'text', text: 'Tab activation not available' }],
            isError: true
          }
        }
        const tab = await context.getTab(parsed.tabId)
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

        await context.activateTab(parsed.tabId)
        return {
          content: [
            {
              type: 'text',
              text: `Switched to tab ${parsed.tabId}: ${tab.title || 'Untitled'}`
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
        if (!context.closeTab) {
          return {
            content: [{ type: 'text', text: 'Tab closing not available' }],
            isError: true
          }
        }
        const tabId = parsed.tabId
          ? parsed.tabId
          : (await context.getActiveTab())?.tabId || (await context.resolveTabId(undefined))
        if (!tabId) {
          return {
            content: [{ type: 'text', text: 'No active tab to close' }],
            isError: true
          }
        }
        await context.closeTab(tabId)
        return {
          content: [
            {
              type: 'text',
              text: `Closed tab ${tabId}`
            }
          ]
        }
      }
    }
  ]
}
