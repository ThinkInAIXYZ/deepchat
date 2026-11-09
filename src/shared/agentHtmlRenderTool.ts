export const HTML_RENDER_TOOL_NAME = 'html_render'
export const HTML_RENDER_MIN_HEIGHT = 80
export const HTML_RENDER_DEFAULT_HEIGHT = 360
export const HTML_RENDER_MAX_HTML_BYTES = 512 * 1024
export const HTML_RENDER_TITLE_MAX_LENGTH = 200
export const HTML_RENDER_HOST_STYLE_SLOT = '<style data-dc-host-vars></style>'
export const HTML_RENDER_SECTION_TOOL_NAME = 'html_render_section'
export const HTML_RENDER_MAX_PANEL_BYTES = 2 * 1024 * 1024
export const HTML_RENDER_SECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const HTML_RENDER_SECTIONS_METHOD = 'dc/html-render/sections'
export const HTML_RENDER_SCRIPT_ERROR_METHOD = 'dc/html-render/script-error'

// The page is already stored in the tool block and rendered, so model context keeps only the ids;
// replaying the HTML would resend up to 2 MB per panel on every later request.
export const compactHtmlRenderToolArguments = (name: string, args: string): string => {
  if (name !== HTML_RENDER_TOOL_NAME && name !== HTML_RENDER_SECTION_TOOL_NAME) return args
  try {
    const value = JSON.parse(args) as { html?: unknown } | null
    if (typeof value?.html !== 'string') return args
    return JSON.stringify({
      ...value,
      html: `[omitted from context: ${value.html.length} characters; send the full HTML again to change it]`
    })
  } catch {
    return args
  }
}
