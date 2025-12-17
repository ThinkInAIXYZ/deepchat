import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const ScreenshotArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)'),
  selector: z.string().optional().describe('Capture only the element matching this selector'),
  fullPage: z.boolean().optional().default(false).describe('Capture the full page'),
  highlightSelectors: z
    .array(z.string())
    .optional()
    .describe('Selectors to highlight before capture')
})

export function createScreenshotTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_screenshot',
      description: 'Capture a screenshot of the current page or a specific element.',
      schema: ScreenshotArgsSchema,
      handler: async (args, context) => {
        const parsed = ScreenshotArgsSchema.parse(args)
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab ${tabId} not found` }],
            isError: true
          }
        }

        const base64 = await tab.takeScreenshot({
          selector: parsed.selector,
          fullPage: parsed.fullPage,
          highlightSelectors: parsed.highlightSelectors
        })

        return {
          content: [
            {
              type: 'text',
              text: `data:image/png;base64,${base64}`
            }
          ]
        }
      }
    }
  ]
}
