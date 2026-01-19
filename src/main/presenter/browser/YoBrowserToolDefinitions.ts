import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { MCPToolDefinition } from '@shared/presenter'

const yoBrowserSchemas = {
  tab_list: z.object({}),
  tab_new: z.object({
    url: z.string().url().optional().describe('Optional URL to navigate to when creating the tab')
  }),
  tab_activate: z.object({
    tabId: z.string().min(1).describe('ID of the tab to activate')
  }),
  tab_close: z.object({
    tabId: z.string().min(1).describe('ID of the tab to close')
  }),
  cdp_send: z.object({
    tabId: z.string().optional().describe('Optional tab ID. If omitted, uses the active tab'),
    method: z
      .string()
      .min(1)
      .describe('CDP method name (e.g., "Page.navigate", "Runtime.evaluate")'),
    params: z
      .record(z.unknown())
      .optional()
      .describe('Optional parameters object for the CDP method')
  })
}

export function getYoBrowserToolDefinitions(): MCPToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'yo_browser_tab_list',
        description: 'List all browser tabs and identify the active tab',
        parameters: zodToJsonSchema(yoBrowserSchemas.tab_list) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'yobrowser',
        icons: '🌐',
        description: 'YoBrowser CDP automation'
      }
    },
    {
      type: 'function',
      function: {
        name: 'yo_browser_tab_new',
        description: 'Create a new browser tab with an optional URL',
        parameters: zodToJsonSchema(yoBrowserSchemas.tab_new) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'yobrowser',
        icons: '🌐',
        description: 'YoBrowser CDP automation'
      }
    },
    {
      type: 'function',
      function: {
        name: 'yo_browser_tab_activate',
        description: 'Make a specific tab the active tab',
        parameters: zodToJsonSchema(yoBrowserSchemas.tab_activate) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'yobrowser',
        icons: '🌐',
        description: 'YoBrowser CDP automation'
      }
    },
    {
      type: 'function',
      function: {
        name: 'yo_browser_tab_close',
        description: 'Close a specific browser tab',
        parameters: zodToJsonSchema(yoBrowserSchemas.tab_close) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'yobrowser',
        icons: '🌐',
        description: 'YoBrowser CDP automation'
      }
    },
    {
      type: 'function',
      function: {
        name: 'yo_browser_cdp_send',
        description:
          'Send a Chrome DevTools Protocol (CDP) command to a browser tab. Use this for navigation, content extraction, and DOM interaction',
        parameters: zodToJsonSchema(yoBrowserSchemas.cdp_send) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: 'yobrowser',
        icons: '🌐',
        description: 'YoBrowser CDP automation'
      }
    }
  ]
}
