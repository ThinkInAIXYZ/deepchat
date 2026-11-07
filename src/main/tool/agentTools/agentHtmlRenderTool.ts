import { randomBytes } from 'crypto'
import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import type { HtmlRenderDescriptor } from '@shared/types/core/mcp'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import {
  HTML_RENDER_MAX_HTML_BYTES,
  HTML_RENDER_MAX_PANEL_BYTES,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_SECTION_ID_PATTERN,
  HTML_RENDER_SECTION_TOOL_NAME,
  HTML_RENDER_TITLE_MAX_LENGTH,
  HTML_RENDER_TOOL_NAME
} from '@shared/agentHtmlRenderTool'
import { HOST_VIEW_MAX_HEIGHT } from '@shared/hostViews'
import {
  isDocumentMarkup,
  loadsExternalResource,
  usesViewportHeightUnit
} from '@/htmlRender/document'
import type { AgentHtmlRenderPanelPort } from '../runtimePorts'

const htmlField = (description: string) =>
  z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= HTML_RENDER_MAX_HTML_BYTES, {
      message: 'html must be at most 512 KB'
    })
    .describe(description)

const htmlRenderSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(HTML_RENDER_TITLE_MAX_LENGTH)
    .describe('Short title for the page, shown in the tool row.'),
  html: htmlField('One complete HTML document: a whole page, or the shell of a panel.'),
  height: z
    .number()
    .int()
    .min(HTML_RENDER_MIN_HEIGHT)
    .max(HOST_VIEW_MAX_HEIGHT)
    .optional()
    .describe('Expected page height in pixels, used until the page reports its size.')
})

const htmlRenderSectionSchema = z.strictObject({
  panelId: z.string().min(1).max(64).describe('panelId returned by html_render.'),
  sectionId: z
    .string()
    .regex(HTML_RENDER_SECTION_ID_PATTERN)
    .describe('Stable id for this section. Reusing an id replaces that section.'),
  html: htmlField('HTML fragment for one section, without doctype, html, head or body tags.')
})

const LAYOUT_AND_THEME = [
  'Layout: the frame is the reply width on the conversation background. Leave html and body without',
  'background, outer card, border, or side padding. Give charts a fixed pixel height. Do not use vh',
  'units or height:100% on html or body.',
  'Theme: use CSS variables, not fixed colors: --background, --foreground, --muted,',
  '--muted-foreground, --card, --card-foreground, --border, --primary, --primary-foreground,',
  '--accent, --destructive, --chart-1 to --chart-6, --radius, --font-sans, --font-mono.'
].join(' ')

const HTML_RENDER_DESCRIPTION = [
  'Show a finished HTML page (chart, diagram, table, mockup) inline in this conversation.',
  'Pass one complete document with inline CSS and JS. For data charts load ECharts 5 with',
  '<script src="/lib/echarts.js"></script>; use inline SVG for diagrams, icons and decoration.',
  'Remote scripts, stylesheets, fonts and images are blocked, and the page cannot make network',
  'requests.',
  'Keep each call short. For a report or dashboard with more than one or two cards, send a shell',
  'first (the head with styles and libraries, the header, and an empty element with the',
  'data-dc-sections attribute), then add each card with html_render_section using the returned',
  'panelId. Short calls appear sooner and stay within output limits.',
  'Do not restate the page in your reply.',
  LAYOUT_AND_THEME
].join(' ')

const HTML_RENDER_SECTION_DESCRIPTION = [
  'Add or replace one section of a panel created by html_render. The fragment is appended to the',
  "panel's data-dc-sections element in call order (or to body if the shell has none). Sending the",
  'same sectionId again replaces that section, so retry a failed or truncated section with its id.',
  'Scripts in the fragment run after it is inserted and can use libraries the shell loaded.',
  'Put one card or chart in each call.',
  LAYOUT_AND_THEME
].join(' ')

const AGENT_CORE_SERVER = {
  name: 'agent-core',
  icons: '📊',
  description: 'Agent core tools'
}

const toParameters = (schema: z.ZodType) =>
  toDeepChatJsonSchema(schema) as {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }

const assertRenderableHtml = (html: string) => {
  if (usesViewportHeightUnit(html)) {
    throw new Error(
      'The page uses vh/svh/lvh/dvh units. The frame fits the page height, so viewport-relative heights grow without bound. Use fixed pixel heights instead.'
    )
  }
  if (loadsExternalResource(html)) {
    throw new Error(
      'The page loads a remote script or stylesheet, which is blocked. Use <script src="/lib/echarts.js"></script> for charts and inline everything else.'
    )
  }
}

const successResult = (toolName: string, content: string, extra?: object) => ({
  content,
  rawData: {
    content,
    isError: false,
    toolResult: createAgentToolSuccessResult(toolName, content, { summary: content }),
    ...extra
  }
})

export class AgentHtmlRenderTool {
  getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        execution: TOOL_EXECUTION.read.sequential,
        type: 'function',
        function: {
          name: HTML_RENDER_TOOL_NAME,
          description: HTML_RENDER_DESCRIPTION,
          parameters: toParameters(htmlRenderSchema)
        },
        server: AGENT_CORE_SERVER
      },
      {
        execution: TOOL_EXECUTION.read.sequential,
        type: 'function',
        function: {
          name: HTML_RENDER_SECTION_TOOL_NAME,
          description: HTML_RENDER_SECTION_DESCRIPTION,
          parameters: toParameters(htmlRenderSectionSchema)
        },
        server: AGENT_CORE_SERVER
      }
    ]
  }

  call(args: Record<string, unknown>) {
    const parsed = htmlRenderSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments for ${HTML_RENDER_TOOL_NAME}: ${parsed.error.message}`)
    }
    assertRenderableHtml(parsed.data.html)
    const panelId = randomBytes(6).toString('base64url')
    const htmlRender: HtmlRenderDescriptor = {
      schemaVersion: 1,
      title: parsed.data.title,
      panelId,
      ...(parsed.data.height ? { height: parsed.data.height } : {})
    }
    return successResult(
      HTML_RENDER_TOOL_NAME,
      `Rendered "${parsed.data.title}" inline. panelId: ${panelId}`,
      { htmlRender }
    )
  }

  callSection(
    args: Record<string, unknown>,
    conversationId: string | undefined,
    panels: AgentHtmlRenderPanelPort | undefined
  ) {
    const parsed = htmlRenderSectionSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments for ${HTML_RENDER_SECTION_TOOL_NAME}: ${parsed.error.message}`
      )
    }
    const { panelId, sectionId, html } = parsed.data
    if (isDocumentMarkup(html)) {
      throw new Error(
        'Section html is a fragment. Remove doctype, html, head and body tags; put styles and libraries in the panel shell.'
      )
    }
    assertRenderableHtml(html)
    if (!conversationId || !panels) {
      throw new Error(`${HTML_RENDER_SECTION_TOOL_NAME} requires a conversation.`)
    }
    const storedBytes = panels.measurePanel(conversationId, panelId, sectionId)
    if (storedBytes === null) {
      throw new Error(
        `No panel ${panelId} in this conversation. Create one with html_render and use its panelId.`
      )
    }
    if (storedBytes + Buffer.byteLength(html, 'utf8') > HTML_RENDER_MAX_PANEL_BYTES) {
      throw new Error('The panel would exceed 2 MB. Start a new panel with html_render.')
    }
    return successResult(
      HTML_RENDER_SECTION_TOOL_NAME,
      `Section "${sectionId}" is in panel ${panelId}.`
    )
  }
}
