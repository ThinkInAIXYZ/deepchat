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
| A10 | Chat response feedback | Send a message to a local streaming provider and inspect live regions during streaming and after completion. The only live region is the empty notification container; response content and completion expose no log/status/live region. | A nonvisual user receives no automatic indication that generation started or finished. | Open |
| A09 | Shortcut settings | Inspect Shortcut Key Settings. Every row exposes identical Edit and Clear shortcut buttons without the target shortcut in their names. | Button navigation cannot distinguish which shortcut will change. | Open |

## Coverage matrix

`Tree inspected` means the route rendered and its ARIA snapshot was examined. It is not a completed feature journey. `Pending` means no runtime claim is made. The settings inventory includes hidden routes and aliases from `src/shared/settingsNavigation.ts`.

| Surface | Coverage | Remaining work |
| --- | --- | --- |
| Initial agent selection | Keyboard activation and tree inspected | Focus/state acceptance after fixes |
| Guided onboarding and first-run setup | Pending | Provider setup, guided-step navigation, completion |
| Main sidebar | Keyboard Tab traversal and named buttons inspected | Session selection/actions, search results, workspace groups |
| New chat and composer | Keyboard agent activation, model-menu selection, input and Enter send | Attachments, mentions, settings, permissions |
| Chat responses | Local fixture message sent with keyboard Enter; streaming and completion trees inspected; A10 | Completion/error announcements, actions, branching, export |
| Search/command palette | Pending | Query, result navigation, Escape and focus return |
| Workspace panel and file viewer | Pending | Tree navigation, file open, tabs, preview, diff |
| Plugins catalog | Tree inspected | Keyboard detail/install/configuration navigation |
| Plugins skills | Tree inspected | Import/install/detail/enable/remove dialogs |
| Plugins MCP | Tree inspected | Enable/configuration/dialog flow |
| Plugins built-in OCR | Tree inspected | Engine selection/configuration |
| Settings overview | Tree inspected | Filter and navigation controls |
| Settings common | Tree inspected; A03 | Form keyboard operation |
| Settings display | Tree inspected; A06 | Language/theme/font controls |
| Settings environments | Tree inspected; A04 | Actions and keyboard reordering |
| Settings provider | Tree inspected | Provider/model CRUD dialogs, connection checking |
| Settings DeepChat agents | Tree inspected | Agent CRUD and tool/model settings |
| Settings ACP | Tree inspected; A05 | Enabled configuration and custom agent dialog |
| Settings dashboard alias | Verified redirect to overview usage | Same as overview |
| Settings MCP (hidden) | Tree inspected; A05 | Same as plugins MCP |
| Settings OCR (hidden) | Tree inspected | Same as plugins OCR |
| Settings toolchains | Tree inspected | Runtime action feedback |
| Settings remote (hidden) | Tree inspected | Channel setup and secrets controls |
| Settings hooks | Tree inspected | Add/edit form, trigger controls |
| Settings scheduled tasks | Tree inspected | Add/edit/enable/run actions |
| Settings plugins (hidden) | Tree inspected | Plugin detail configuration |
| Settings prompts | Tree inspected; A06 | System/custom prompt CRUD |
| Settings memory | Tree inspected; A06 | Enable, memory/directive CRUD, diagnostics |
| Settings knowledge base | Tree inspected; A07 | All provider configuration dialogs |
| Settings data/privacy | Tree inspected; A08 | Sync, encryption, import/export, destructive confirmation dialogs |
| Settings shortcuts | Tree inspected; A09 | Shortcut capture/cancel/reset |
| Settings about | Tree inspected; A06 | Disclaimer, update status |
| Settings debug | Route excluded from production build; renders no content | Development-only, no production feature claim |
| Browser window/overlay | Pending | Address/search, navigation, tab controls |
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

The streaming fixture also establishes A10: generation content is readable in the tree, but generation progress/completion is not announced. Passing the keyboard contracts above does not resolve that separate barrier.
