# Inline HTML Render

Status: implemented; manual check in the app pending (`plan.md` step 7).

## Context

DeepChat can render Mermaid, KaTeX, and AntV Infographic code blocks inside a reply. It cannot show
an agent-authored chart, diagram, dashboard, or mockup. HTML code-block preview is disabled and
legacy `<antArtifact>` HTML is shown as source only.

This change adds two agent tools. `html_render` takes one self-contained HTML document (a whole
page, or the shell of a panel); `html_render_section` adds or replaces one section of that panel.
The host stores the calls, and the thread shows the page in a sandboxed frame that fits its height
and follows the app theme. The tools, not a text convention, are the contract.

DeepChat already ships the hard part. The MCP Apps host (`docs/features/mcp-apps/spec.md`) runs
untrusted HTML on an isolated `mcp-app://<token>` origin through a fixed double-iframe proxy, with
CSP response headers, a typed AppBridge, inline/fullscreen/pip display, and teardown on virtualized
unmount. This feature adds a second content source to that host.

## Goals

- A built-in agent tool `html_render` that shows a finished HTML page inline in the conversation.
- Large pages are built in short calls (shell, then sections), so one call stays under any model's
  output limit, each section shows as soon as its call finishes, and a failed or cut-off call is
  retried on its own.
- Pages work offline and on intranets: no remote hosts.
- The page fits its content height, follows light/dark theme, and uses DeepChat tokens.
- The page renders again after reload, from persisted conversation data, with no live dependency.
- Agent HTML runs under the same isolation as MCP Apps and never enters the renderer origin.

## Non-Goals

- No `html_preview` screenshot tool in v1. It needs an offscreen browser and a vision model; many
  DeepChat models are text-only. Revisit after v1 usage.
- No exposure to ACP agents. DeepChat runs no MCP server for its own tools
  (`acpSessionManager.ts` forwards only user-selected external servers). A bridge is separate work.
- No inlining of local image paths. Pages use `data:` URIs or inline SVG.
- No rendering of HTML code blocks or legacy `<antArtifact>` content.
- No change to MCP App sizing, styles, or labels. Gaps found there are listed under Follow-ups.
- No network access from the page (`connect-src 'none'`), no device permissions, no forms.

## User Experience

The tool call rows (`html_render` and each `html_render_section`) stay in the activity group like
other tools. The panel renders as its own timeline item after the `html_render` row, the same
placement MCP Apps use (`messageActivityGroups.ts`); sections fill that panel and get no item of
their own.

The frame has no border, card, or title bar. It sits on the thread background at reply width. A
toolbar appears on hover or focus in the top-right corner.

Before (agent can only describe or emit a code block):

```text
+-------------------------------------------------------------+
| > Ran 2 tools                                               |
|                                                             |
| Revenue grew 18% in Q3, led by the West region...           |
| ```html                                                     |
| <!doctype html><html><head><style>...                       |
| ```                                                         |
+-------------------------------------------------------------+
```

After:

```text
+-------------------------------------------------------------+
| > Ran 2 tools                                               |
|                                                             |
|  Q3 revenue by region                           [⤢]         |
|  West   ██████████████████  42%                             |
|  North  ████████████        29%                             |
|  South  █████████           21%                             |
|  East   ███                  8%                             |
|                                                             |
| Revenue grew 18% in Q3, led by the West region...           |
+-------------------------------------------------------------+

[⤢] fullscreen (visible on hover/focus, once the page has its size)
```

Fullscreen is a surface of its own in `HtmlRenderView`, teleported to `body` and registered with
`mcpAppDisplayCoordinator`, so only one non-inline frame exists per window. A header shows the page
`title` and a button to return inline; Escape and a click on the scrim also return. Pip, the
side-panel outlet and copy-source are not offered for this source in v1.

States:

| State | Shown |
| --- | --- |
| Tool running | Tool row with the title or section id and the size generated so far |
| Preparing frame | Empty box at the reserved height, no spinner |
| Rendered | Page |
| Tool error | Normal tool error row; no frame |
| Prepare failed | One muted line "Unable to display this page" plus Retry |

## Tool Contract

Defined in `src/main/tool/agentTools/agentHtmlRenderTool.ts`, name constants in
`src/shared/agentHtmlRenderTool.ts`, both added to `RESERVED_AGENT_TOOL_NAMES`.

```ts
const htmlRenderSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  html: z.string().min(1), // at most 512 KB
  height: z.number().int().min(80).max(1600).optional()
})

const htmlRenderSectionSchema = z.strictObject({
  panelId: z.string().min(1).max(64),
  sectionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  html: z.string().min(1) // fragment, at most 512 KB
})
```

- `execution: TOOL_EXECUTION.read.sequential`. It changes nothing outside the conversation, so it
  stays out of the write review gate and the permission broker.
- Exposure: both tools are `user-configurable`, Agent mode only. That reuses both existing
  switches with no new setting: the per-agent tool toggle in agent settings (`disabledAgentTools`)
  and the per-session override (`updateSessionDisabledAgentTools`), so a user can turn them on or
  off for one conversation. They are opt-in, like `cronjob`: both names are in
  `DEFAULT_DISABLED_AGENT_TOOLS`, and a one-time step (`htmlRenderToolsSeeded`) adds them to the
  disabled list of existing agents without touching other tools. Conversations created before
  the upgrade keep the tool list they started with. The tools are toggled one by one: with
  only `html_render` disabled, `html_render_section` stays listed but every call fails for lack of
  a panel. They are grouped with the `agent-core` tools, so the settings and session tool lists
  need no new group label.
- Code Mode: both tools are Code Mode direct tools (`CODE_MODE_DIRECT_TOOL_NAMES`), exposed
  beside `run_code` / `exec` instead of inside them. Nested Code Mode calls return only
  `content` / `structuredContent` to the script and drop `rawData`, which carries the
  `htmlRender` descriptor, and a section's html is read from its own tool block's params, so a
  nested call would run but never display. `question` and the live delegation tool are direct for
  the same reason.
- `height` is the reserved height before the page reports its size. Default 360.

Description text of `html_render` (layout and theme lines are shared with the section tool):

> Show a finished HTML page (chart, diagram, table, mockup) inline in this conversation.
> Pass one complete document with inline CSS and JS. For data charts load ECharts 5 with
> `<script src="/lib/echarts.js"></script>`; use inline SVG for diagrams, icons and decoration.
> Remote scripts, stylesheets, fonts and images are blocked, and the page cannot make network
> requests.
> Keep each call short. For a report or dashboard with more than one or two cards, send a shell
> first (the head with styles and libraries, the header, and an empty element with the
> data-dc-sections attribute), then add each card with html_render_section using the returned
> panelId. Short calls appear sooner and stay within output limits.
> Do not restate the page in your reply.
> Layout: the frame is the reply width on the conversation background. Leave html and body
> without background, outer card, border, or side padding. Give charts a fixed pixel height. Do not
> use vh units or height:100% on html or body.
> Theme: use CSS variables, not fixed colors: --background, --foreground, --muted,
> --muted-foreground, --card, --card-foreground, --border, --primary, --primary-foreground,
> --accent, --destructive, --chart-1 to --chart-6, --radius, --font-sans, --font-mono.

`html_render_section`:

> Add or replace one section of a panel created by html_render. The fragment is appended to the
> panel's data-dc-sections element in call order (or to body if the shell has none). Sending the
> same sectionId again replaces that section, so retry a failed or truncated section with its id.
> Scripts in the fragment run after it is inserted and can use libraries the shell loaded.
> Put one card or chart in each call.

The guidance names no byte budget: output limits differ per model, and one card per call stays
under all of them.

Validation in the handlers, each returning a tool error the model can act on:

- empty or oversized `html` (512 KB per call);
- a `vh`/`svh`/`lvh`/`dvh` unit (the frame fits the page, so a viewport-relative page grows with
  its frame until the cap). Long base64 runs are skipped before matching;
- a `<script>` or `<link>` that loads from `http(s):` or `//`, naming `/lib/echarts.js` instead;
- sections only: doctype, `html`, `head` or `body` tags; a `panelId` with no successful
  `html_render` shell in the same conversation; a panel whose shell plus latest sections would
  pass 2 MB.

On success `html_render` returns `Rendered "<title>" inline. panelId: <id>` and an `htmlRender`
descriptor; the section tool returns `Section "<id>" is in panel <panelId>.` Neither echoes the HTML
back to the model.

### Sections

- `panelId` is 8 random base64url characters generated by the handler and stored in the
  descriptor. Provider tool call ids are not used: some providers repeat them within a session.
- A section belongs to the panel in the same conversation, from any later assistant message, so a
  run that stopped (network error, output limit, user stop) continues with "continue" in a new
  message. The model sees which sections succeeded in the earlier tool results.
- Order is first appearance; a repeated `sectionId` replaces the content in place.
- The section tool checks the panel through `AgentHtmlRenderPanelPort.measurePanel`
  (`deepchatAssistantBlocks.measureHtmlRenderPanel`). Blocks reach the DB within 600 ms, and a
  section call can only start in the model round after the shell result, so the shell is stored.
  Section results are stored only after the whole tool batch, so the tool also counts the sections
  it accepted earlier in the process for the 2 MB cap, with the newest size per section winning.

## Persistence

The HTML already lives in the tool block's `tool_params` (stored in full in
`deepchat_assistant_blocks`). No new file, table, or cleanup path is needed.

Add one non-executable descriptor next to `imagePreviews` and `mcpResult`:

```ts
interface HtmlRenderDescriptor {
  schemaVersion: 1
  title: string
  height?: number
  panelId?: string
}
```

Sections need no descriptor: a successful `html_render_section` block is the record, and its
params carry `panelId`, `sectionId` and `html`.

It travels `AgentToolCallResult.rawData` → `MCPToolResponse.htmlRender` → `dispatch.ts`
`updateToolCallBlock` → `tool_call.htmlRender` → `extra_json.toolCallExtra.htmlRender`
(`messageContent.ts`). The renderer gate is the presence of this descriptor on a successful block.

## Rendering Pipeline

```text
renderer                          main                                   sandbox origin
--------                          ----                                   --------------
HtmlRenderView nears viewport
  mcp.apps.prepareHtmlRender ───▶ load block by (conversation, message, block)
  {conversationId, messageId,     require tool name html_render, success,
   blockId}                       descriptor present
                                  html = tool_params.html
                                  html = buildHtmlRenderDocument(html)
                                  registry.create({ descriptor: null, ... })
                  ◀───────────── { instanceId, sandboxUrl, html, csp }
iframe src = sandboxUrl ─────────────────────────────────────────────▶ fixed proxy
AppBridge: sandbox-resource-ready(html) ─────────────────────────────▶ inner iframe doc.write
                                  ◀──── ui/initialize (from bootstrap) ─
AppBridge returns hostContext (theme, displayMode, locale, platform)
mcp.apps.readHtmlRenderSections ─▶ main reads sections from the DB
dc/html-render/sections (all sections) ──────────────────────────────▶ insert after DOMContentLoaded
                                  ◀──── ui/notifications/size-changed ──
frame height = content height
section blocks change ─▶ readHtmlRenderSections ─▶ dc/html-render/sections ─▶ insert, replace or remove
                                  ◀──── dc/html-render/script-error ───  first uncaught page error
```

### Main

- New route `mcp.apps.prepareHtmlRender` (`{conversationId, messageId, blockId}`), conversation
  windows only (same `RouteContext` rule as the other `mcp.apps.*` routes). It returns the
  `McpHostPreparedView` shape that `mcp.apps.prepareHostView` (infographic) returns. Release
  reuses `mcp.apps.releaseView`. The renderer never sends HTML; main reads it from the DB.
- New route `mcp.apps.readHtmlRenderSections` (same input). Main resolves the shell's `panelId`
  from the same block and returns the latest version of each section of that panel in the
  conversation, in first-appearance order (`deepchatAssistantBlocks.listHtmlRenderSections`).
- `McpAppHost.prepareHtmlRenderView` reads the block through `readHtmlRenderSource` (message must
  belong to the conversation; block must be a successful `html_render` call with a descriptor),
  injects the bootstrap (`src/main/htmlRender/document.ts`), and calls the existing
  `McpAppSandboxRegistry.create`. `validateLive` re-reads the block, so deleting the message
  revokes the instance.
- Host-owned views already exist on `dev` (#2504): the registry instance `descriptor` is
  `McpAppDescriptor | null`, with a `title` and a per-instance `libraries` map. An html_render page
  is a second host-owned view; unlike infographic, its document comes from the DB rather than a
  fixed template, so it keeps its own route. Every MCP action (tool calls, resources, prompts, messages, model context)
  goes through `assertLiveInstance`, which rejects `null`, and so does `openLink`: outbound links
  are disabled for host views in this change. Nothing on disk changes.
- Fixed CSP for this source: the existing `buildMcpAppContentSecurityPolicy` with no
  `resourceDomains`. That allows `'self'`, inline code and `data:`/`blob:`; `connect-src`,
  `frame-src`, `object-src` and `form-action` stay `'none'`. No remote host is allowed, so pages
  behave the same offline and on intranets, and `img-src https:` is not an exfiltration channel.
- Bundled libraries: the sandbox protocol serves `mcp-app://<token>/lib/<name>` only for names in
  the instance's `libraries` map. html_render instances get `HTML_RENDER_LIBRARIES`: `echarts.js` →
  `resources/cdn/echarts.min.js`, ECharts 5.6.0, about 1 MB, with its Apache-2.0 license, the
  bundled d3 license and NOTICE in `echarts.min.js.LICENSE.txt`. The inner frame is same-origin with
  the proxy, so `/lib/echarts.js` resolves there and `'self'` allows it. `resources/cdn` is already
  unpacked by `electron-builder.yml`. ECharts covers line, bar, pie, radar, gauge, heatmap,
  calendar, graph, sankey and treemap; inline SVG covers diagrams and decoration. Chart.js and D3
  are not bundled: they add size without a chart type ECharts lacks. The bundled Recharts needs
  React plus runtime JSX compilation and has fewer chart types.

  No device permissions.

### Bootstrap

A fixed script and style block injected at the start of `<head>`. It is a minimal MCP Apps view so the existing AppBridge and proxy
work unchanged:

- sends `ui/initialize`, then `ui/notifications/initialized`;
- carries an empty `<style data-dc-host-vars>` slot that the renderer fills with theme variables
  before the document is written (see Renderer);
- reports `document.documentElement` height through `ui/notifications/size-changed`, directly from
  a `ResizeObserver` callback and on `load`. Do not defer through `requestAnimationFrame`, and do
  not hide the frame with `visibility: hidden` while preparing (use `opacity: 0`): Chromium
  throttles rendering in hidden cross-origin frames, so the first size report never arrives;
- cancels link clicks, except in-page `#` anchors;
- answers `ui/resource-teardown` and `ping` so host teardown does not wait for the 500 ms cap;
- on `dc/html-render/sections` (`{sections: [{id, html}]}`, the whole list each time), waits for
  `DOMContentLoaded` so libraries in the shell `<head>` are defined, then for each new or changed
  section fills a `<div data-dc-section style="display:contents">` slot inside
  `[data-dc-sections]` (else `body`) and re-creates its `<script>` elements in order, because
  scripts parsed through `innerHTML` never run; slots whose id is no longer in the list are
  removed, so a deleted or regenerated message drops its sections;
- reports the first uncaught script error once with `dc/html-render/script-error`; the view keeps
  the page and shows a one-line notice under it, since the rest of the page may still be useful;
- base style: transparent `html`/`body`, `margin: 0`, an 8px `html` padding for focus rings and
  shadows, `color: var(--foreground)`, `font-family: var(--font-sans)`.

The bootstrap goes right after `<head>`, else after `<html>` (wrapped in `<head>`), else after the
doctype of a fragment.

The bootstrap is the only code the host adds to the page. It holds no secrets.

### Renderer

Add `HtmlRenderView.vue` beside `McpAppView.vue`. Do not make `McpAppView` polymorphic: it carries
server tools, resource reads, model context, tool-channel suspension, permission and security
details, none of which apply here.

The frame itself is `HostViewFrame`, the host-view frame infographic blocks use (#2504). It takes a
`prepare` function, so infographic calls `mcp.apps.prepareHostView` and html_render calls
`mcp.apps.prepareHtmlRender`, and owns what both need: the `AppBridge` with no host
capabilities and no server handlers, the unmount → teardown (500 ms cap) → `releaseView` sequence, sizing, the
initialization timeout, and `reload()`. Sandbox instances expire 30 minutes after they are
prepared, so `reload()` prepares a fresh instance, restarts the initialization timeout, and releases
the old instance; the old frame does not reconnect while the new one is being prepared. html_render adds
two props: `decorateHtml` writes the theme variables into the bootstrap's style slot, and
`displayMode` switches to fullscreen. `HtmlRenderView` keeps only the html_render parts: visibility
gating, sections, fullscreen chrome and the load error.

- `mcpAppDisplayCoordinator` and a `Teleport` to `body` for fullscreen, so only one non-inline
  frame exists per window. Moving an iframe reloads it, so switching modes calls `reload()`.

Each frame is its own renderer process (about 30 MB), so a page prepares its sandbox only when it
comes within 160 px of the viewport, as infographic blocks do. Pages initialize before their own
scripts run; a page that has not initialized 10 s after preparing (wiped by `document.open()`, or
stuck in a loop) is released and shows the load error with a retry.

Sizing, in `HostViewFrame` for every host view:

- initial height = the placeholder (`descriptor.height` for html_render);
- on `size-changed`, height = `min(content, 1600)` (`HOST_VIEW_MAX_HEIGHT`);
- above 1600 px the frame scrolls internally;
- oscillation lock: the `vh` check only catches one cause of a page
  that grows with its frame; `height: 100%`, percentage layouts, and scripts that size from
  `innerHeight` loop the same way. Within any 2 s window, if the reported height rises on 5
  consecutive reports or changes direction 4 times, keep the current height, stop applying
  `size-changed`, and let the frame scroll internally. A frame width change clears the lock and
  measures again.

Theme variables are read from the renderer root with `getComputedStyle` for the tokens in the
tool description, so the page matches the live app theme, including custom themes. Before sending
`sandbox-resource-ready`, `HtmlRenderView` writes them into the bootstrap's style slot as
`html:root{...}`:

- synchronously, because chart libraries read CSS variables once when the page script runs; values
  sent later through `hostContext` arrive after the chart is drawn;
- `html:root` so host values win over `:root` fallbacks the page declares;
- colors normalized to `#rrggbb` / `rgba()` through a canvas `fillStyle`: the app tokens are CSS
  Color 4 (`hsl(210 100% 43%)`), which D3 and other libraries cannot parse and draw as black;
- values containing `<>{};` are dropped.

`--font-sans` / `--font-mono` come from `--dc-font-family` / `--dc-code-font-family`. `--chart-1` is
`--primary`; `--chart-2..6` are a fixed categorical palette per light/dark inside `HtmlRenderView`
(the app's own `--chart-*` tokens are single-hue blues and unused). No global CSS changes. Canvas
and SVG charts bake colors at draw time, so a light/dark switch reloads the frame.

Sections: `HtmlRenderView` reads its panel's sections from main after `initialized` and sends them
to the page; a reload or theme switch does this again for the new page, so reopening the chat
restores the panel from the DB. `ChatPage` provides only a change signal per panel, the list of
successful `html_render_section` blocks in the displayed messages (`htmlRenderSections.ts`).
When it changes, the view reads again after 700 ms, because the stream shows a block as successful
up to 600 ms before writing it to the DB.

The tool row of both tools shows the title or section id read from the partial params and, while
the call is running, the size generated so far.

`messageActivityGroups.ts` treats a successful block with `htmlRender` like an MCP App block
(`hasInlineView`): the tool row stays in the activity group and the page renders below it through
the existing `mcp-app` render item.

## Security

- Untrusted HTML runs only on `mcp-app://<token>`; never `v-html` or app-origin `srcdoc`
  (AGENTS.md).
- The renderer cannot choose any page HTML. Main resolves the shell and the sections from
  persisted blocks of the calling window's conversation; the renderer passes only the block
  reference.
- No network requests (`connect-src 'none'`), no forms, no frames, no device permissions, no remote
  scripts, styles, fonts or images.
- `/lib` serves only names in the instance's `libraries` map.
- With the bootstrap's link handler suppressed, scripted clicks on `_top`, `_blank`, `_parent` and
  `_self` links, `top.location` and `location` assignment, `window.open`, `fetch` and remote images
  all fail; the main-process window-open handler is never reached. A page stuck in a loop blocks only its own frame process.
  `test/e2e/specs/47-html-render-isolation.smoke.spec.ts` checks these against a real build.
- An html_render instance cannot reach any MCP server action or open links.
- Existing registry limits apply: 64 instances per process, 32 per WebContents, 30-minute token
  TTL.

## Compatibility

- MCP App persistence, routes, and behavior are unchanged. The nullable descriptor, title and
  `/lib/<name>` serving came with host views in #2504; this change adds two routes and the
  html_render libraries map.
- Conversations without the tool are unaffected. Disabling the tool hides it from the model; past
  renders still display.
- Exporters show the tool block as today (title from params). HTML export is a follow-up.

## Acceptance Criteria

- An agent call to `html_render` with a valid document shows the page inline after the tool
  completes, at content height, with no inner scrollbar below 1600 px.
- Switching light/dark redraws the page in the new theme.
- Reloading the conversation renders the same page from the DB.
- Deleting the message revokes a live instance.
- A document with `100vh` returns a tool error naming the rule.
- A page whose height keeps growing with its frame stops at a fixed height and scrolls inside
  instead of growing to the cap.
- `fetch`, `XMLHttpRequest`, `WebSocket`, form submit, and `window.top` access fail inside the page.
- `<script src="/lib/echarts.js">` loads with the network off; any remote script is rejected by the
  tool and blocked by CSP.
- A shell plus sections shows the shell first and each section when its call succeeds; resending a
  `sectionId` replaces that section; after reopening the chat the panel shows the same sections.
- A section for a `panelId` from another conversation returns a tool error.
- Clicking a link in the page opens nothing.
- The renderer route rejects a block that is not a successful `html_render` call.
- A page far below the viewport does not prepare a sandbox until scrolled near.
- A page that never initializes shows the load error after 10 s, and the chat stays responsive.
- Scripted link clicks with the bootstrap handler suppressed open nothing and send no request.

## Open Questions (for maintainers)

1. Bundled library set. Decided for now: ECharts only (about 1 MB in the installer). Adding a
   library is one map entry plus the file.

## Follow-ups (not in this change)

- MCP Apps: send `styles.variables`, and fit inline height to `size-changed` instead of a fixed
  16:9 box (`McpAppView.vue` `frameViewportClass`, `handleSizeChange`).
- `html_preview` for vision models.
- Expose `html_render` to ACP agents through a DeepChat MCP server.
- Code Mode drops the UI projection (`rawData`) of every nested call, including MCP App results
  from MCP tools called inside `run_code`. `html_render` avoids it by being direct; MCP Apps in
  Code Mode need their own fix.
- Save as `.html` and include renders in conversation export.
- Outbound links through the host consent flow, which today requires a server-bound instance.

## Rejected Alternatives

- A size budget in the tool description. Output limits differ per model; sections bound each call
  without a number.
- Live preview of partial HTML while a call streams. Sections already show progress at card
  level, and running partial markup needs a second sandbox path.
- CDN allowlist. Breaks offline and on intranets.
- Render ` ```html ` code blocks. Depends on model formatting, mixes partial streaming HTML with
  execution, and cannot carry a title or height.
- Store HTML as a session file. `tool_params` already persists it; a file adds a cleanup path that
  session deletion does not have today.
- Script-free rendering (`sandbox=""` or
  `allow-same-origin` without scripts, host-handled `data-*` actions). Safer, but rules out
  interactive charts, sliders, and canvas output, which are the main value here. The isolated
  `mcp-app://` origin already contains scripts.
- Generalize `McpAppView`. More conditional code than a sibling component that reuses the bridge,
  coordinator, and registry.
