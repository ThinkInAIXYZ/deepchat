import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { MCPToolDefinition } from '@shared/presenter'

const yoBrowserSchemas = {
  get_browser_status: z.object({}),
  load_url: z.object({
    url: z.string().url().describe('URL to load in the session browser')
  }),
  cdp_send: z.object({
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

export const YO_BROWSER_TOOL_NAMES = ['load_url', 'get_browser_status', 'cdp_send'] as const

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
      'get_browser_status',
      'Get the current session browser status',
      yoBrowserSchemas.get_browser_status
    ),
    toDefinition(
      'load_url',
      'Create the session browser on demand and load a URL into it',
      yoBrowserSchemas.load_url
    ),
    toDefinition(
      'cdp_send',
      'Send a Chrome DevTools Protocol (CDP) command to the current session browser page',
      yoBrowserSchemas.cdp_send
    )
  ]
}
