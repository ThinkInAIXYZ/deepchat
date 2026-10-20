# Desktop Visual Refresh

## Context and goals

DeepChat presents agents, sessions, tools and settings through several visual treatments. The
desktop shell must give conversation content priority and use the same restrained visual language
across chat, search, workspace panels, plugins and settings. Both light and dark modes use the
existing blue brand color. Dark surfaces are neutral charcoal rather than tinted green or pure black.

## Design

- Use a single 264px expanded sidebar and a compact 48px collapsed sidebar. Agent selection moves
  into a named dropdown; session groups, project actions and pagination retain their behavior.
  The dropdown opens below its trigger and scrolls within the available height, keeping the native
  title bar and window controls unobstructed in short windows.
  Expanding or collapsing the sidebar preserves its trigger element and menu anchor.
  Selecting the checked filter preserves the active conversation. The explicit all-agents item
  clears the filter. Agent onboarding targets the persistent selector even while its menu is closed.
  Menu items expose the current filter with radio-item roles and checked states.
  A single persistent sidebar toggle stays at the bottom in both states; switching preserves its
  position and keyboard focus. Theme selection has its own row above the toggle, with the current
  mode visible when expanded. Collapsed footer icons share one centered axis and button size.
  The header can scroll in short windows, and session content stays within its column so the
  bottom controls remain reachable.
- Keep new conversation and global search above the session list. Keep plugins, scheduled tasks,
  theme and settings reachable at the bottom. List filtering remains available independently of
  global search.
- Use neutral selected backgrounds, readable secondary text, thin borders and solid surfaces.
  Reserve brand blue for primary actions, focus and selected controls; preserve danger and warning
  semantics. Existing semantic success colors are not a replacement brand palette.
  Blue status text consumes the readable foreground token independently of primary button fills.
- Align messages and the composer to one readable content width. Use a modest welcome heading,
  quiet user bubbles and unboxed assistant responses. Keep model and permission controls visible
  within the composer instead of on a disconnected status strip.
- Center global search across the window, with a restrained backdrop, stable result area, readable
  snippets and existing keyboard navigation. Closing restores focus to the invoking control.
- Workspace panels use a compact tab strip, consistent toolbar and quiet empty state. Reuse the
  existing file, browser, terminal and preview capabilities and isolation boundaries.
- Settings use a grouped navigation sidebar with navigation search and a return action. The main
  area has a bounded readable width, a clear page title and section groups. Setting descriptions stay
  next to their controls. Appearance previews show light, dark and system with blue selection.
  Shell dividers and top corners follow the writing direction, and titled cards retain header spacing.
  Text-size choices share a wider, end-aligned segmented control. Directory environment headers,
  tabs and filters stay fixed while their list scrolls independently.
- ACP settings prioritize installed Agents in compact rows with identity, version, enable control
  and a settings entry. Environment overrides, authentication, repair, Inspector and uninstall
  belong to an Agent detail page; shared MCP selection has its own detail page. Returning to the
  list retains unsaved environment drafts and restores focus to the invoking entry. Existing save,
  retry and leave guards remain authoritative.
- Opening Hooks or data settings reads configuration without reporting a successful save. Actual
  writes retain their success feedback, and read failures retain their error feedback.
- Enabling the floating widget creates and shows it without hiding or focusing away from existing
  application windows. It retains its all-workspace and full-screen visibility.
- Markstream owns table layout, borders, horizontal scrolling and column controls. Markdown
  typography must preserve the library's cell insets, including first and last columns.
  Context occupancy retains a visible track and outline even at zero or very low usage.
- Scheduled tasks retain their list/detail workflow, scheduler status, execution history and error
  recovery. Use the same page hierarchy, quiet list treatment and blue primary actions.
- Plugin and skill pages use compact navigation, bounded content, consistent item icons, concise
  descriptions and clear install/status actions. Preserve installation scope and permissions.

```text
BEFORE
+------+----------------+----------------------------------------+
|Agent | Commands       | Conversation                           |
|rail  | Session groups |                                        |
|      |                | Composer                               |
|Tools |                | Separate model and permission strip    |
+------+----------------+----------------------------------------+

AFTER
+-----------------------+-----------------------+----------------+
| Agent selector        | Conversation title    | Workspace tabs |
| New / Search          |                       |                |
| Session groups        | Readable conversation | Existing tools |
|                       |                       |                |
| Plugins / Tasks       | Composer with model   |                |
| Theme / Settings      | and permission controls                |
+-----------------------+-----------------------+----------------+

SETTINGS
+-----------------------+----------------------------------------+
| Return / Search       | Page title                             |
| Navigation groups     |                                        |
| Current section       | Section title                          |
|                       | Setting + description         Control  |
|                       | Setting + description         Control  |
+-----------------------+----------------------------------------+
```

## Ownership and data flow

Theme values belong to `assets/style.css` and are documented in `docs/design-system.md`.
`ChatMainApp`, `WindowSideBar` and the settings app own their shells. Existing `dc-ui` and shadcn
primitives own shared control appearance. `ChatInputBox` exposes a composition slot for session
controls; chat and new-thread pages keep their existing refs, events and draft ownership.

Navigation filtering is local derived state over translated settings titles. Session search remains
owned by the sidebar. Agent switching retains its serialized close-session pipeline. The refresh
does not introduce new persisted settings, dependencies or IPC contracts. The floating-window
owner avoids macOS process-type transitions when configuring workspace visibility and shows the
widget without activating it.

## Invariants and compatibility

- Preserve existing routes, provider configuration, session data, draft content and user appearance
  preferences. Do not add account/subscription features, theme catalogs, remote schedulers or new
  workspace tools based on visual references.
- Preserve confirmation guards, permission visibility, read-only states, disabled/loading controls,
  error recovery, scope labels and native sender/origin validation.
- Preserve session virtualization, search debounce, pagination, drag/drop and keyboard shortcuts.
- Expanded and collapsed sidebar descendants must have correct focusability. Dropdowns and search
  remain keyboard accessible; icon actions retain accessible names.
- Long names, translated strings, font scaling and narrow windows must not obscure send, stop or
  permission controls. Honor reduced motion and native window drag regions.

## Acceptance

- Light, dark and system appearance have coherent surfaces and readable text across both windows.
- Users can switch agents, search/filter/select sessions, collapse navigation and open settings,
  plugins and scheduled tasks using the retained behavior.
- New and existing conversations share an integrated composer; attachment, model, permission,
  voice, send and stop actions remain reachable.
- Settings navigation can be filtered by translated section names and cleared without losing the
  current page. Returning from settings honors unsaved-change guards.
- Search opens centered, supports arrows/Enter/Escape and restores focus on close.
- Workspace, scheduled tasks, plugin and skill pages use the shared visual hierarchy without
  changing their data or execution contracts.
- Formatting, i18n validation, lint, typecheck and focused renderer suites pass. Runtime screenshots
  cover both themes and narrow layout where the local preview runtime is available.
