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
      .enum([
        'Page.navigate',
        'Page.reload',
        'Page.captureScreenshot',
        'Runtime.evaluate',
        'DOM.getDocument',
        'DOM.querySelector',
        'DOM.querySelectorAll',
        'DOM.getOuterHTML',
        'Input.dispatchMouseEvent',
        'Input.dispatchKeyEvent'
      ])
      .describe('Common CDP method name'),
    params: z
      .union([
        z
          .object({
            url: z.string().url().describe('Example: "https://example.com"')
          })
          .describe('For Page.navigate. Example: {"url":"https://example.com"}'),
        z
          .object({
            ignoreCache: z.boolean().optional().describe('Example: true'),
            scriptToEvaluateOnLoad: z
              .string()
              .optional()
              .describe('Example: "console.log(document.title)"')
          })
          .describe('For Page.reload. Example: {"ignoreCache":true}'),
        z
          .object({
            format: z.enum(['png', 'jpeg']).optional().describe('Example: "png"'),
            quality: z.number().int().min(0).max(100).optional().describe('Example: 80'),
            clip: z
              .object({
                x: z.number().describe('Example: 0'),
                y: z.number().describe('Example: 0'),
                width: z.number().positive().describe('Example: 800'),
                height: z.number().positive().describe('Example: 600'),
                scale: z.number().positive().optional().describe('Example: 1')
              })
              .optional()
              .describe('Example: {"x":0,"y":0,"width":800,"height":600,"scale":1}')
          })
          .describe('For Page.captureScreenshot. Example: {"format":"png"}'),
        z
          .object({
            expression: z.string().min(1).describe('Example: "document.title"'),
            returnByValue: z.boolean().optional().describe('Example: true'),
            awaitPromise: z.boolean().optional().describe('Example: true')
          })
          .describe(
            'For Runtime.evaluate. Example: {"expression":"document.title","returnByValue":true}'
          ),
        z
          .object({
            depth: z.number().int().min(0).optional().describe('Example: 1'),
            pierce: z.boolean().optional().describe('Example: true')
          })
          .describe('For DOM.getDocument. Example: {"depth":1,"pierce":true}'),
        z
          .object({
            nodeId: z.number().int().positive().describe('Example: 1'),
            selector: z.string().min(1).describe('Example: "body"')
          })
          .describe('For DOM.querySelector. Example: {"nodeId":1,"selector":"body"}'),
        z
          .object({
            nodeId: z.number().int().positive().describe('Example: 1'),
            selector: z.string().min(1).describe('Example: "a"')
          })
          .describe('For DOM.querySelectorAll. Example: {"nodeId":1,"selector":"a"}'),
        z
          .object({
            nodeId: z.number().int().positive().describe('Example: 1')
          })
          .describe('For DOM.getOuterHTML. Example: {"nodeId":1}'),
        z
          .object({
            type: z
              .enum(['mousePressed', 'mouseReleased', 'mouseMoved'])
              .describe('Example: "mousePressed"'),
            x: z.number().describe('Example: 120'),
            y: z.number().describe('Example: 240'),
            button: z
              .enum(['none', 'left', 'middle', 'right'])
              .optional()
              .describe('Example: "left"'),
            clickCount: z.number().int().min(1).optional().describe('Example: 1')
          })
          .describe(
            'For Input.dispatchMouseEvent. Example: {"type":"mousePressed","x":120,"y":240,"button":"left","clickCount":1}'
          ),
        z
          .object({
            type: z.enum(['keyDown', 'keyUp', 'rawKeyDown', 'char']).describe('Example: "keyDown"'),
            key: z.string().optional().describe('Example: "a"'),
            code: z.string().optional().describe('Example: "KeyA"'),
            text: z.string().optional().describe('Example: "a"')
          })
          .describe(
            'For Input.dispatchKeyEvent. Example: {"type":"keyDown","key":"a","code":"KeyA","text":"a"}'
          )
      ])
      .describe('Parameters for the selected CDP method. Must be an object, not a JSON string')
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
