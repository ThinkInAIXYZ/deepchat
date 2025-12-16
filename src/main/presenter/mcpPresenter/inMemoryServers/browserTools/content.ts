import { z } from 'zod'
import TurndownService from 'turndown'
import type { BrowserToolDefinition } from './types'

const BaseArgsSchema = z.object({
  conversationId: z.string().optional().describe('Conversation/session identifier')
})

const SelectorArgsSchema = BaseArgsSchema.extend({
  selector: z.string().optional().describe('Optional CSS selector to scope extraction')
})

const LinksArgsSchema = BaseArgsSchema.extend({
  limit: z.number().int().min(1).max(200).optional().default(50).describe('Maximum links to return')
})

const ClickableArgsSchema = BaseArgsSchema.extend({
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe('Maximum clickable elements to return')
})

const turndown = new TurndownService({
  headingStyle: 'atx'
})

export function createContentTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_get_text',
      description: 'Extract visible text from the page or a specific element.',
      schema: SelectorArgsSchema,
      handler: async (args, context) => {
        const parsed = SelectorArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        const text = await page.getInnerText(parsed.selector)
        return {
          content: [
            {
              type: 'text',
              text: text || '(no text found)'
            }
          ]
        }
      },
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: 'browser_get_markdown',
      description: 'Extract the page content as Markdown.',
      schema: SelectorArgsSchema,
      handler: async (args, context) => {
        const parsed = SelectorArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        await page.waitForNetworkIdle()
        const html = await page.getHtml(parsed.selector)
        const markdown = html ? turndown.turndown(html) : ''
        return {
          content: [
            {
              type: 'text',
              text: markdown || '(no content found)'
            }
          ]
        }
      },
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: 'browser_read_links',
      description: 'List hyperlinks on the current page.',
      schema: LinksArgsSchema,
      handler: async (args, context) => {
        const parsed = LinksArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        const links = await page.getLinks(parsed.limit)
        const formatted =
          links.length === 0
            ? 'No links found.'
            : links
                .map((link, index) => `${index + 1}. ${link.text || '(no text)'} -> ${link.href}`)
                .join('\n')

        return {
          content: [
            {
              type: 'text',
              text: formatted
            }
          ]
        }
      },
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: 'browser_get_clickable_elements',
      description: 'List clickable elements with simple selectors.',
      schema: ClickableArgsSchema,
      handler: async (args, context) => {
        const parsed = ClickableArgsSchema.parse(args)
        const conversationId = context.getConversationId(parsed)
        const page = await context.sessionManager.getOrCreatePage(conversationId)

        const elements = await page.getClickableElements(parsed.limit)
        const formatted =
          elements.length === 0
            ? 'No clickable elements found.'
            : elements
                .map(
                  (element, index) =>
                    `${index + 1}. [${element.tag}] ${element.text || element.ariaLabel || '(no text)'} -> ${element.selector}`
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
      },
      annotations: {
        readOnlyHint: true
      }
    }
  ]
}
