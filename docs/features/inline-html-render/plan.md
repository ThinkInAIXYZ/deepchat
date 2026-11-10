# Inline HTML Render Plan

Spec: `spec.md`. Status markers: `[ ]` pending, `[x]` done.

1. [x] Registry: nullable `descriptor` (null = html_render page) plus `title`; MCP actions reject
       null through `assertLiveInstance`.
2. [x] Main: `McpAppHost.prepareHtmlRenderView` (block lookup, bootstrap injection, fixed CSP with
       no remote hosts) and the `mcp.apps.prepareHtmlRender` route; release and link opening reuse
       existing routes.
3. [x] Tool: `html_render` definition, validation, descriptor through `rawData` → `dispatch.ts`
       → `toolCallExtra.htmlRender`; Code Mode direct tool; reserved agent tool name.
4. [x] Renderer: `HtmlRenderView.vue` (fit height + oscillation lock, fullscreen), inline item via
       `hasInlineView`, theme variables in the bootstrap style slot, i18n string.
5. [x] Bundled ECharts at `/lib/echarts.js` on the sandbox origin; remote scripts and stylesheets
       rejected by the tools.
6. [x] Sections: `html_render_section` (panelId check, 2 MB panel cap), section collection in
       `ChatPage`, live insertion through `dc/html-render/sections`, size progress in the tool row.
7. [ ] Manual check in the app: shell + sections, resend a section, reload, theme switch,
       fullscreen, ECharts with the network off, link confirmation, blocked `fetch`.
8. [x] Tests only for security boundaries and contracts: prepare reads only the saved block and
       uses the fixed CSP; MCP actions denied to html_render pages; `vh`, remote resource and
       fragment checks; panelId and panel size checks; panel measurement per session.
9. [x] Format, i18n, lint, typecheck, focused main/renderer suites.
