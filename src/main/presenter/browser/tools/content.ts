import { z } from 'zod'
import TurndownService from 'turndown'
import type { BrowserToolDefinition } from './types'

const BaseArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)')
})

const SelectorArgsSchema = BaseArgsSchema.extend({
  selector: z.string().optional().describe('Optional CSS selector to scope extraction')
})

const ContentArgsSchema = SelectorArgsSchema.extend({
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Character offset from which to start reading (0 = beginning)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(16000)
    .optional()
    .default(4000)
    .describe('Maximum number of characters to return from the offset')
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

const DEFAULT_TEXT_LIMIT = 4000
const MAX_TEXT_LIMIT = 16000

const paginateText = (
  fullText: string | undefined,
  offset?: number,
  limit?: number
): { slice: string; meta?: string } => {
  const text = fullText || ''
  const length = text.length
  const safeOffset = Math.max(0, offset ?? 0)
  const safeLimit = Math.min(MAX_TEXT_LIMIT, Math.max(1, limit ?? DEFAULT_TEXT_LIMIT))

  if (!text) {
    return { slice: '', meta: undefined }
  }

  if (safeOffset >= length) {
    return {
      slice: '',
      meta: `Offset ${safeOffset} is beyond content length ${length}. No content returned.`
    }
  }

  const end = Math.min(length, safeOffset + safeLimit)
  const slice = text.slice(safeOffset, end)
  const remaining = length - end

  if (remaining <= 0) {
    return { slice, meta: undefined }
  }

  const nextOffset = end
  const meta = `Content length: ${length} characters. Returned range: [${safeOffset}, ${end}) (${slice.length} characters). Remaining: ${remaining} characters. To continue reading, call this tool again with offset=${nextOffset}.`

  return { slice, meta }
}

export function createContentTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_get_text',
      description:
        'Extract visible text from the page or a specific element. Supports offset/limit pagination to avoid overly long outputs.',
      schema: ContentArgsSchema,
      handler: async (args, context) => {
        const parsed = ContentArgsSchema.parse(args)
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab ${tabId} not found` }],
            isError: true
          }
        }

        const text = await tab.getInnerText(parsed.selector)
        const { slice, meta } = paginateText(text, parsed.offset, parsed.limit)

        const content: { type: 'text'; text: string }[] = []

        if (!slice && !meta) {
          content.push({ type: 'text', text: '(no text found)' })
        } else {
          if (meta) {
            content.push({
              type: 'text',
              text: `[pagination] ${meta}`
            })
          }
          if (slice) {
            content.push({
              type: 'text',
              text: slice
            })
          }
        }

        return { content }
      },
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: 'browser_get_markdown',
      description:
        'Extract the page content as Markdown. Supports offset/limit pagination to avoid overly long outputs.',
      schema: ContentArgsSchema,
      handler: async (args, context) => {
        const parsed = ContentArgsSchema.parse(args)
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab ${tabId} not found` }],
            isError: true
          }
        }

        await tab.waitForNetworkIdle()
        const html = await tab.getHtml(parsed.selector)
        const markdown = html ? turndown.turndown(html) : ''
        const { slice, meta } = paginateText(markdown, parsed.offset, parsed.limit)

        const content: { type: 'text'; text: string }[] = []

        if (!slice && !meta) {
          content.push({ type: 'text', text: '(no content found)' })
        } else {
          if (meta) {
            content.push({
              type: 'text',
              text: `[pagination] ${meta}`
            })
          }
          if (slice) {
            content.push({
              type: 'text',
              text: slice
            })
          }
        }

        return { content }
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
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab ${tabId} not found` }],
            isError: true
          }
        }

        const links = await tab.getLinks(parsed.limit)
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
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab ${tabId} not found` }],
            isError: true
          }
        }

        const elements = await tab.getClickableElements(parsed.limit)
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
