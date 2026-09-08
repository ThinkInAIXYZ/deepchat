# Accessibility exploration

## Method and limits

The exploration agent, 糸锯圭介, simulates nonvisual discovery using the actual Electron renderer's accessibility semantics and keyboard input. This is not a claim of lived blindness or human screen-reader certification. An accessible tree is necessary evidence, but does not prove VoiceOver or NVDA speech quality.

All runtime exploration uses a fresh `DEEPCHAT_E2E_USER_DATA_DIR`, the repository Electron executable, and temporary scripts outside the repository. User credentials are neither needed nor recorded. Local mock providers may supply deterministic chat responses. Direct route navigation or fixture seeding is recorded as setup; it does not count as successful keyboard discovery.

Evidence date: 2026-09-08. Baseline: current `codex/accessibility` build before product accessibility changes. The initial stale build was discarded and findings were reproduced against the fresh build.

## Confirmed barriers

| ID | Surface | Reproduction and actual evidence | Impact | State |
| --- | --- | --- | --- | --- |
| A01 | Chat composer | Keyboard-focus the DeepChat agent button and press Enter. The editable `div` has `tabindex=0`, but no textbox role or accessible name; the ARIA snapshot exposes its placeholder only as a paragraph. | Form-control navigation cannot identify where to enter a message. | Accepted: named multiline textbox |
| A02 | Main navigation | Traverse the main-window accessibility tree from the initial agent-selection page and from a new DeepChat thread. No main/navigation landmark or skip link is present. | Every return to the task requires traversal of unrelated sidebar controls. | Accepted: named navigation/main and skip controls |
| A03 | Common settings | Open Settings using its named button and Enter; navigate to Common Settings. The logging toggle appears as an unnamed switch. Proxy mode appears as an unnamed combobox containing only its selected value. | Controls cannot be identified independently of visual position. | Open |
| A04 | Environments | Inspect the Environments page. Show Missing is an unnamed switch; each directory's overflow menu is an unnamed button. | Missing-directory filter and directory actions are ambiguous. | Open |
| A05 | ACP and MCP | Inspect ACP Agents and MCP Center with integrations disabled. Each master enable toggle appears as an unnamed switch. | The entry to integration configuration has no discoverable action name. | Open |
| A06 | Field labels | Display language, default system prompt, memory agent/category, and About update-channel selectors expose only current values as unnamed comboboxes. | Users cannot identify what each selector changes. | Open |
| A07 | Knowledge bases | Inspect Knowledge Base Settings. Four provider cards expose unnamed buttons containing unnamed disabled switches. Provider card text is separate from the interactive control. | No named action identifies how to configure or enable a knowledge provider. | Open |
| A08 | Data sync | Inspect Data & Privacy. Enable Data Sync is an unnamed switch, and Sync Folder is an unnamed disabled textbox. | Data sync state and destination are not associated with field names. | Open |
| A10 | Chat response feedback | Send a message to a local streaming provider and inspect live regions during streaming and after completion. The baseline exposes no response status. | A nonvisual user receives no automatic indication that generation started or finished. | Accepted: persistent polite atomic status changes from Running to Generation is complete |
| A09 | Shortcut settings | Inspect Shortcut Key Settings. Every row exposes identical Edit and Clear shortcut buttons without the target shortcut in their names. | Button navigation cannot distinguish which shortcut will change. | Open |

## Additional runtime barriers

| ID | Surface | Actual evidence | Impact | State |
| --- | --- | --- | --- | --- |
| A11 | Long conversation history | A fixture with 222 stored messages initially exposes only the latest 100, beginning at item 123. No button offers earlier messages. The scroll container has no role/tabindex; Skip to content then Control+Home leaves scrollTop at 43174. | Earlier history has no explicit discoverable keyboard loading action. | Accepted: Enter/Space loads earlier pages and focuses the conversation at the new first message |
| A12 | Slash suggestions | Typing `/` creates a tooltip containing command/skill buttons. ArrowDown leaves focus in the editor, whose aria-expanded/controls/activedescendant are absent; highlighted selection has no accessible state. | Keyboard users cannot hear which suggestion will be accepted. | Open |
| A13 | File mentions | Typing `@` with no files exposes a detached No result tooltip without editor association or live feedback. | No result state is not announced or associated with the input. | Open |
| A14 | Global search | Enter opens search; typing `fixture` finds a named provider result. ArrowDown keeps focus on the input without aria-activedescendant. No dialog/listbox/option/aria-selected semantics exist. | Search result selection changes are visual only. | Open |
| A15 | Scheduled task form | Activate New job. Focus falls to body, and the resulting Name, Cron expression and Task prompt textboxes and Agent/Timezone/Runtime comboboxes are unnamed. | The newly inserted editor and its fields cannot be identified through control navigation. | Open |
| A16 | Prompt attachments | Add Custom Prompt opens a correctly named dialog, but Upload from device is only a paragraph, absent from interactive controls. | File attachment is not a discoverable keyboard action. | Open |
| A17 | Long Markdown response | A local response containing 200 numbered headings and paragraphs retains only 129 headings in the completed DOM/accessibility tree, beginning at Section 71. Section 0 is absent while Section 199 exists. | Reading the completed answer sequentially can omit earlier content. | Open |
| A18 | Workspace sections | Keyboard Enter expands/collapses the Files section; its chevron changes while the button exposes no aria-expanded or controlled-region association. | The section state is visual only. | Open |
| A19 | First-run setup guide | Start with a completely empty profile. The welcome route exposes an unnamed dialog containing the Select a Provider heading. First Tab begins at the app sidebar rather than the guide. | The automatic guide and its current step are not identified as the active task. | Open |
| A20 | Closed side panel | After a chat, before opening Workspace, the accessibility tree and Tab order include its Workspace/Yo Browser/Close/Files controls. The visually closed panel uses opacity and pointer-event styles without inert/hidden semantics. | Keyboard users can enter a closed panel and encounter inactive empty content. | Open |
| A21 | Message editing | Activate the user message Edit message button with Enter. The inline editor appears as an unnamed textbox. | The editor cannot be distinguished from other textboxes by purpose. | Open |

## Coverage matrix

`Tree inspected` means the route rendered and its ARIA snapshot was examined. It is not a completed feature journey. `Pending` means no runtime claim is made. The settings inventory includes hidden routes and aliases from `src/shared/settingsNavigation.ts`.

| Surface | Coverage | Remaining work |
| --- | --- | --- |
| Initial agent selection | Keyboard activation and tree inspected | Focus/state acceptance after fixes |
| Guided onboarding and first-run setup | Empty-profile welcome route and actual Tab order inspected; A19 | Provider setup, guided-step navigation, completion |
| Main sidebar | Keyboard Tab traversal and named buttons inspected | Session selection/actions, search results, workspace groups |
| New chat and composer | Keyboard agent activation, model-menu selection, input and Enter send | Attachments, mentions, settings, permissions |
| Chat responses | Local keyboard fixture; progress/completion accepted; edit, delete confirmation and More menu opened with Enter; A21 | Branching/export, error and permission journeys |
| Search/command palette | Opened with Enter; queried local fixture; ArrowDown inspected; A14 | Result activation and focus return after fixes |
| Workspace panel and file viewer | Pending | Tree navigation, file open, tabs, preview, diff |
| Plugins catalog | Tree inspected; Install from Git opens named dialog with named fields | Detail/configuration navigation and ZIP invocation |
| Plugins skills | Tree inspected | Import/install/detail/enable/remove dialogs |
| Plugins MCP | Tree inspected | Enable/configuration/dialog flow |
| Plugins built-in OCR | Tree inspected | Engine selection/configuration |
| Settings overview | Tree inspected | Filter and navigation controls |
| Settings common | Tree inspected; A03 | Form keyboard operation |
| Settings display | Tree inspected; A06 | Language/theme/font controls |
| Settings environments | Tree inspected; A04 | Actions and keyboard reordering |
| Settings provider | Tree inspected | Provider/model CRUD dialogs, connection checking |
| Settings DeepChat agents | Tree inspected | Agent CRUD and tool/model settings |
| Settings ACP | Enabled with Space; installed/custom entry controls inspected; A05 | Custom agent and registry dialogs |
| Settings dashboard alias | Verified redirect to overview usage | Same as overview |
| Settings MCP (hidden) | Enabled with Space; server cards inspected; master and per-server switches unnamed | Server add/edit/tool controls |
| Settings OCR (hidden) | Tree inspected | Same as plugins OCR |
| Settings toolchains | Tree inspected | Runtime action feedback |
| Settings remote (hidden) | Tree inspected | Channel setup and secrets controls |
| Settings hooks | New Hook inserted with Enter; named command/name/event controls inspected | Save/edit lifecycle and action feedback |
| Settings scheduled tasks | New job inserted with Enter; A15 | Named form, focus, edit/enable/run actions |
| Settings plugins (hidden) | Tree inspected | Plugin detail configuration |
| Settings prompts | System/custom dialogs opened with Enter; named dialog/form inspected; A06/A16 | CRUD, parameter and attachment actions |
| Settings memory | Tree inspected; A06 | Enable, memory/directive CRUD, diagnostics |
| Settings knowledge base | RAGFlow expanded by keyboard through an unnamed wrapper button; config enable/edit/delete controls unnamed; A07 | All provider configuration dialogs |
| Settings data/privacy | Tree inspected; Set password and Reset Data dialogs opened with Enter; initial focus and Escape return verified; A08 | Sync, encryption persistence, import/export |
| Settings shortcuts | Tree inspected; A09 | Shortcut capture/cancel/reset |
| Settings about | Disclaimer opened with Enter; named dialog and Close focus verified; A06 | Update status |
| Settings debug | Route excluded from production build; renders no content | Development-only, no production feature claim |
| Browser window/overlay | Local data URL loaded; browser content AX and named navigation/address controls inspected; one host icon button unnamed | Cross-WebContents keyboard focus, preview modes |
| Floating window | Pending | Entry controls and keyboard behavior |
| Plugin settings window | Pending | Host-provided controls and content boundary |
| Native file/save dialogs | Pending | OS-owned dialogs; test invocation and focus return |

## Nonvisual experience notes

The application already exposes many sidebar icon actions as properly named buttons, and Tab followed by Enter successfully selects the DeepChat agent and opens Settings. The first significant break is the composer: the instructions can be read, but the editable surface does not identify itself as a textbox. Settings are inconsistent: several toggles have good labels, while neighboring toggles expose only their role. Navigating by control type therefore loses the context available visually.

## Accepted keyboard contracts

A fresh isolated Electron run with a localhost SSE provider verified these final behaviors:

- DeepChat agent and model selection accept keyboard Enter; typing into the composer and pressing Enter creates a user message and receives a deterministic local response.
- The composer is a named textbox with `aria-multiline=true`.
- After starting a new chat, actual Tab traversal reaches the prior conversation title. Enter and Space each reopen the stored user/assistant messages. The selected title reports `aria-current=page`; pin/delete remain separate Tab stops after the title.
- The main-window Skip to content control focuses the named main landmark when activated with Enter.
- The Settings Skip to content control focuses its sole main landmark. Activating Common Settings with Enter transfers focus to that main; settings navigation has the accessible name Settings.

A 222-message fixture verifies Load earlier messages works with Enter and Space: the first loaded item advances from 123 to 023 and then to the original first message. Each action focuses the conversation region at the newly available history; the load control disappears when the history is exhausted. Resizing the viewport to 1180 × 760 after loading preserves item 023 at the top and does not resume following the bottom.

A deterministic local streaming run also verifies a persistent polite, atomic status region changes from Running to Generation is complete without announcing each response token. The user and assistant content remain available in a named focusable conversation region.
