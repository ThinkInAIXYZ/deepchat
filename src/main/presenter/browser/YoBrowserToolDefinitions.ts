import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { MCPToolDefinition } from '@shared/presenter'

const yoBrowserSchemas = {
  window_list: z.object({}),
  window_open: z.object({
    url: z.string().url().optional().describe('Optional URL to open in the new browser window')
  }),
  window_focus: z.object({
    windowId: z.number().int().positive().describe('Browser window ID')
  }),
  window_close: z.object({
    windowId: z.number().int().positive().describe('Browser window ID')
  }),
  cdp_send: z.object({
    windowId: z.number().int().positive().optional().describe('Optional browser window ID'),
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
      .record(z.string(), z.unknown())
      .optional()
      .describe('Parameters for the selected CDP method')
  })
}

function asParameters(schema: z.ZodTypeAny) {
  return zodToJsonSchema(schema) as {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

function toDefinition(name: string, description: string, schema: z.ZodTypeAny): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: asParameters(schema)
    },
    server: {
      name: 'yobrowser',
      icons: '🌐',
      description: 'YoBrowser CDP automation'
    }
  }
}

export function getYoBrowserToolDefinitions(): MCPToolDefinition[] {
  return [
    toDefinition(
      'yo_browser_window_list',
      'List all browser windows and identify the active window',
      yoBrowserSchemas.window_list
    ),
    toDefinition(
      'yo_browser_window_open',
      'Open a new browser window with an optional URL',
      yoBrowserSchemas.window_open
    ),
    toDefinition(
      'yo_browser_window_focus',
      'Focus an existing browser window',
      yoBrowserSchemas.window_focus
    ),
    toDefinition(
      'yo_browser_window_close',
      'Close an existing browser window',
      yoBrowserSchemas.window_close
    ),
    toDefinition(
      'yo_browser_cdp_send',
      'Send a Chrome DevTools Protocol (CDP) command to a browser window page',
      yoBrowserSchemas.cdp_send
    )
  ]
}
