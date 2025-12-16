import { z } from 'zod'
import type { BrowserToolDefinition } from './types'

const BaseArgsSchema = z.object({
  conversationId: z.string().optional().describe('Conversation/session identifier')
})

const SelectorSchema = BaseArgsSchema.extend({
  selector: z.string().min(1).describe('CSS selector of the target element')
})

const ClickArgsSchema = SelectorSchema
const HoverArgsSchema = SelectorSchema

const FormInputArgsSchema = SelectorSchema.extend({
  value: z.string().describe('Value to fill into the element'),
  append: z
    .boolean()
    .optional()
    .default(false)
    .describe('Append to existing value instead of replacing')
})

const SelectArgsSchema = SelectorSchema.extend({
  value: z.union([z.string(), z.array(z.string())]).describe('Value or values to select')
})

const ScrollArgsSchema = BaseArgsSchema.extend({
  x: z.number().optional().default(0).describe('Horizontal scroll distance'),
  y: z.number().optional().default(500).describe('Vertical scroll distance'),
  behavior: z.enum(['auto', 'smooth']).optional().default('auto').describe('Scroll behavior')
})

const PressKeyArgsSchema = BaseArgsSchema.extend({
  key: z.string().min(1).describe('Key to press'),
  count: z.number().int().min(1).optional().default(1).describe('Number of times to press the key')
})

export function createActionTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_click',
      description: 'Click an element on the page using a CSS selector.',
      schema: ClickArgsSchema,
      handler: async (args, context) => {
        const parsed = ClickArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.waitForSelector(parsed.selector, { timeout: 5000 })
        await page.click(parsed.selector)
        return {
          content: [
            {
              type: 'text',
              text: `Clicked element ${parsed.selector}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_hover',
      description: 'Hover over an element on the page.',
      schema: HoverArgsSchema,
      handler: async (args, context) => {
        const parsed = HoverArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.waitForSelector(parsed.selector, { timeout: 5000 })
        await page.hover(parsed.selector)
        return {
          content: [
            {
              type: 'text',
              text: `Hovered over ${parsed.selector}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_form_input_fill',
      description: 'Fill text into an input or textarea element.',
      schema: FormInputArgsSchema,
      handler: async (args, context) => {
        const parsed = FormInputArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.waitForSelector(parsed.selector, { timeout: 5000 })
        await page.fill(parsed.selector, parsed.value, parsed.append)
        return {
          content: [
            {
              type: 'text',
              text: `Filled ${parsed.selector} with value`
            }
          ]
        }
      }
    },
    {
      name: 'browser_select',
      description: 'Select value(s) within a select element.',
      schema: SelectArgsSchema,
      handler: async (args, context) => {
        const parsed = SelectArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.waitForSelector(parsed.selector, { timeout: 5000 })
        await page.select(parsed.selector, parsed.value)
        return {
          content: [
            {
              type: 'text',
              text: `Updated selection for ${parsed.selector}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page by specified offsets.',
      schema: ScrollArgsSchema,
      handler: async (args, context) => {
        const parsed = ScrollArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.scroll({
          x: parsed.x,
          y: parsed.y,
          behavior: parsed.behavior
        })
        return {
          content: [
            {
              type: 'text',
              text: `Scrolled by x=${parsed.x}, y=${parsed.y}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_press_key',
      description: 'Send keyboard input to the active page.',
      schema: PressKeyArgsSchema,
      handler: async (args, context) => {
        const parsed = PressKeyArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)
        await page.pressKey(parsed.key, parsed.count)
        return {
          content: [
            {
              type: 'text',
              text: `Pressed key "${parsed.key}" ${parsed.count} time(s)`
            }
          ]
        }
      }
    }
  ]
}
