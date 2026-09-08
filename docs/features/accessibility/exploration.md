# Accessibility exploration

## Method and limits

The exploration agent, 糸锯圭介, simulates nonvisual discovery using the actual Electron renderer's accessibility semantics and keyboard input. This is not a claim of lived blindness or human screen-reader certification. An accessible tree is necessary evidence, but does not prove VoiceOver or NVDA speech quality.

All runtime exploration uses a fresh `DEEPCHAT_E2E_USER_DATA_DIR`, the repository Electron executable, and temporary scripts outside the repository. User credentials are neither needed nor recorded. Local mock providers may supply deterministic chat responses. Direct route navigation or fixture seeding is recorded as setup; it does not count as successful keyboard discovery.

Evidence dates: 2026-09-08–2026-09-09. Baseline: current `codex/accessibility` build before product accessibility changes. The initial stale build was discarded and findings were reproduced against the fresh build.

## Confirmed barriers

| ID | Surface | Reproduction and actual evidence | Impact | State |
| --- | --- | --- | --- | --- |
| A01 | Chat composer | Keyboard-focus the DeepChat agent button and press Enter. The editable `div` has `tabindex=0`, but no textbox role or accessible name; the ARIA snapshot exposes its placeholder only as a paragraph. | Form-control navigation cannot identify where to enter a message. | Accepted: named multiline textbox |
| A02 | Main navigation | Traverse the main-window accessibility tree from the initial agent-selection page and from a new DeepChat thread. No main/navigation landmark or skip link is present. | Every return to the task requires traversal of unrelated sidebar controls. | Accepted: named navigation/main and skip controls |
| A03 | Common settings | Open Settings using its named button and Enter; navigate to Common Settings. The logging toggle appears as an unnamed switch. Proxy mode appears as an unnamed combobox containing only its selected value. | Controls cannot be identified independently of visual position. | Accepted: named logging switch and proxy selector |
| A04 | Environments | Inspect the Environments page. Show Missing is an unnamed switch; each directory's overflow menu is an unnamed button. | Missing-directory filter and directory actions are ambiguous. | Accepted: Show Missing switch and directory-specific More action names |
| A05 | ACP, MCP and Skills | Inspect ACP Agents and MCP Center with integrations disabled. Each master enable toggle appears as an unnamed switch. Skills Suggest Skill Drafts is also unnamed. | The entry to integration configuration has no discoverable action name. | Accepted: named ACP/MCP/Skills toggles |
| A06 | Field labels | Display language, default system prompt, memory agent/category, About update channel, every remote channel default agent, and Feishu brand expose only current values as unnamed comboboxes. | Users cannot identify what each selector changes. | Accepted: selectors expose their field purpose |
| A07 | Knowledge bases | Inspect Knowledge Base Settings. Four provider cards expose unnamed buttons containing unnamed disabled switches. Provider card text is separate from the interactive control. | No named action identifies how to configure or enable a knowledge provider. | Accepted: named independent disclosure buttons and switches |
| A08 | Data sync | Inspect Data & Privacy. Enable Data Sync is an unnamed switch, and Sync Folder is an unnamed disabled textbox. | Data sync state and destination are not associated with field names. | Accepted: named sync switch and folder-selection button |
| A10 | Chat response feedback | Send a message to a local streaming provider and inspect live regions during streaming and after completion. The baseline exposes no response status. | A nonvisual user receives no automatic indication that generation started or finished. | Accepted: persistent polite atomic status changes from Running to Generation is complete |
| A09 | Shortcut settings | Inspect Shortcut Key Settings. Every row exposes identical Edit and Clear shortcut buttons without the target shortcut in their names. | Button navigation cannot distinguish which shortcut will change. | Accepted: Edit/Clear names include target shortcut |

## Additional runtime barriers

| ID | Surface | Actual evidence | Impact | State |
| --- | --- | --- | --- | --- |
| A11 | Long conversation history | A fixture with 222 stored messages initially exposes only the latest 100, beginning at item 123. No button offers earlier messages. The scroll container has no role/tabindex; Skip to content then Control+Home leaves scrollTop at 43174. | Earlier history has no explicit discoverable keyboard loading action. | Accepted: Enter/Space loads earlier pages and focuses the conversation at the new first message |
| A12 | Slash suggestions | Typing `/` creates a tooltip containing command/skill buttons. ArrowDown leaves focus in the editor, whose aria-expanded/controls/activedescendant are absent; highlighted selection has no accessible state. | Keyboard users cannot hear which suggestion will be accepted. | Accepted: linked listbox/options and active descendant; Escape clears association and hidden candidates do not consume Enter |
| A13 | File mentions | Typing `@` with no files exposes a detached No result tooltip without editor association or live feedback. | No result state is not announced or associated with the input. | Accepted: associated localized empty-result status |
| A14 | Global and conversation search | Enter opens search; typing `fixture` finds a named provider result. ArrowDown keeps focus on the input without aria-activedescendant. No dialog/listbox/option/aria-selected semantics exist. Separately, Meta+F conversation search has named controls and a 1/1 result indicator, but Escape drops focus to body. | Global selection changes are visual only; closing conversation search loses the task focus. | Accepted: named dialog/combobox/options, active selection, contained Tab order, and opener focus restoration |
| A15 | Scheduled task form | Activate New job. Focus falls to body, and the resulting Name, Cron expression and Task prompt textboxes and Agent/Timezone/Runtime comboboxes are unnamed. | The newly inserted editor and its fields cannot be identified through control navigation. | Accepted: new job focuses Name and fields are named |
| A16 | Prompt attachments | Add Custom Prompt opens a correctly named dialog, but Upload from device is only a paragraph, absent from interactive controls. | File attachment is not a discoverable keyboard action. | Accepted: named Upload from device button invokes native file chooser with Enter |
| A17 | Long Markdown response | A local response containing 200 numbered headings and paragraphs retains only 129 headings in the completed DOM/accessibility tree, beginning at Section 71. Section 0 is absent while Section 199 exists. | Reading the completed answer sequentially can omit earlier content. | Accepted: isolated app AT activation exposes all 200 headings and all 222 loaded messages |
| A18 | Workspace sections | Keyboard Enter expands/collapses Files and a temporary folder; chevrons change while their buttons expose no aria-expanded or controlled-region association. | The section state is visual only. | Accepted: expanded/controls semantics, nested file lists, and keyboard context menus |
| A19 | First-run setup guide | Start with a completely empty profile. The welcome route exposes an unnamed dialog containing the Select a Provider heading. It declares aria-modal=true, but First Tab begins at the app sidebar rather than the guide and background controls remain in the Tab order. | The automatic guide and its current step are not identified as the active task. | Open |
| A20 | Closed side panel | After a chat, before opening Workspace, the accessibility tree and Tab order include its Workspace/Yo Browser/Close/Files controls. The visually closed panel uses opacity and pointer-event styles without inert/hidden semantics. | Keyboard users can enter a closed panel and encounter inactive empty content. | Accepted: closed panel excluded; opening focuses named panel and closing restores opener |
| A21 | Message editing | Activate the user message Edit message button with Enter. The inline editor appears as an unnamed textbox. | The editor cannot be distinguished from other textboxes by purpose. | Accepted: textbox named Edit message |
| A22 | Blocking agent question | A local `deepchat_question` tool call produces Waiting for input, but focus moves to body. Its question radiogroup and Option A/Option B radios have no names. Selecting a radio immediately submits and removes the choices. | The user cannot identify choices and may submit while navigating them. | Accepted: named question/choices, deliberate Confirm, and composer focus restoration |
| A23 | Tool permission request | A local `exec` request in Default permissions produces Waiting for permission with named Deny/Allow controls, but focus falls to body. | The blocking decision is announced without a usable focus destination. | Accepted: named permission region receives focus; Tab to Deny and Enter restores composer |
| A24 | Generated image action | Append a local PNG image block and reopen the session. The image appears as `img picture`, with no button role or tabindex; only a click handler opens the full-image dialog and its save action. | The original-image/save journey has no keyboard entry point. | Accepted: Preview image button, dialog focus return, and keyboard context menu |
| A25 | First message focus | Type into the new-thread composer and send with Enter. After the session opens and streams a normal text response, the active element is body rather than the replacement composer. | A user cannot continue typing a draft without finding the input again. | Accepted: replacement composer retains focus after first send |
| A26 | File viewer focus | Open Workspace and activate a temporary readme.md file with Enter. Preview renders readable headings, but focus falls to body when the file button unmounts. Activating Back also returns to body instead of the file. | Opening and leaving a preview loses the user's working position. | Accepted: file preview region receives focus and Back restores the file button |
| A27 | Embedded browser focus | Load a local page containing a Test action button, open Yo Browser, focus Address bar and press Tab. Focus proceeds to Expand and then the host sidebar; the native browser WebContents never receives focus. | Website controls have no keyboard entry from the host toolbar. | Open |
| A28 | Agent save focus | Add an agent, fill its named Name field and activate Save with Enter. The new agent appears in the list, but the disabled Save control loses focus to body and no save status is exposed. | Saving loses the editor position without an announced completion. | Accepted: Saved status and focus returns to Name |
| A29 | Floating task overview | Enable the floating widget from Display using Space. Its AX exposes Task Overview images and the visually hidden expanded panel, including Collapse floating sessions, but no keyboard control expands the collapsed widget. | The floating task list has no nonvisual keyboard entry, and hidden content remains exposed. | Open |
| A30 | Plugin lifecycle navigation | Install a local ZIP through its named review dialog, enable/disable it, then confirm its named Uninstall alertdialog. Installation opens details and uninstall returns to catalog, but both route transitions drop focus to body. | The resulting plugin page has no stable keyboard reading position. | Accepted: plugin install/uninstall routes focus the named Plugins region |
| A31 | Git diff semantics | Open a changed file from the Git section of a temporary repository. The named viewer is focused and all diff text is present, but the table has no column headers; old/new line numbers are unlabeled and change type is represented only by punctuation. | Column meaning and added/removed state require visual layout or punctuation pronunciation. | Open |
| A32 | Skill detail focus | Open the private fixture Skill card with Enter and close its named dialog with Escape. The dialog disappears, but focus falls to body instead of returning to the card. | Closing a Skill loses the catalog position. | Accepted: Escape returns to the original Skill card |
| A33 | Memory creation and row actions | Enable memory, add a local Content entry and submit Add memory with Enter. The record is created and its details open, but focus falls to body. Its row is a button containing nested buttons, two unnamed. | The saved entry and its actions are difficult to navigate independently. | Accepted: named focused creation/details panels, independent named row actions, and Escape returns to the row |
| A34 | Usage calendar | Settings Overview renders 371 calendar-cell divs with no role, name, text or tabindex. The calendar AX contains only month and weekday labels. | Daily dates and usage values are available only through mouse hover. | Open |
| A35 | Provider connection focus | Add a custom localhost provider through its named form and activate Connect and load models with Enter. One model loads successfully, but focus falls to body; the configured provider rail exposes an unnamed button beside detached provider text. Configured model toggles and model-dialog type/capability controls are unnamed; configured-provider order only has a drag handle. | Connection completion, provider selection and model settings lack stable named controls. | Accepted: connected-result focus, named provider/model controls and dialogs, keyboard provider reordering |
| A36 | Setting value and selection state | Display text-size buttons have no selected/pressed state or group name; interface/monospace font buttons share the same current-value name. Common file-size controls expose generic Decrease/Increase buttons around a static number. | Current selections, field purpose and updated numeric values lack control semantics. | Open |

## Coverage matrix

`Tree inspected` means the route rendered and its ARIA snapshot was examined. It is not a completed feature journey. `Pending` means no runtime claim is made. The settings inventory includes hidden routes and aliases from `src/shared/settingsNavigation.ts`.

| Surface | Coverage | Remaining work |
| --- | --- | --- |
| Initial agent selection | Keyboard activation and tree inspected | Focus/state acceptance after fixes |
| Guided onboarding and first-run setup | Empty-profile welcome and Tab order inspected; OpenAI Enter opens Providers window with unfocused shared guide; A19 | Guide semantics/focus and step navigation/completion |
| Main sidebar | Keyboard Tab traversal and named buttons inspected | Session selection/actions, search results, workspace groups |
| New chat and composer | Keyboard agent/model selection and Enter send; slash/empty mention accepted; named file options accept ArrowDown/Enter and insert readme.md; Attach opens native chooser | Advanced settings and attachment removal |
| Chat responses | Progress/complete/error/stop accepted; edit/delete/More inspected; blocking questions and permissions exercised with local tool fixtures; A21/A22 | Branch to New Chat preserves messages and focuses composer; export/save invocation |
| Search/command palette | Global dialog/combobox/option keyboard semantics and focus return accepted; Meta+F conversation search returns 1/1 and Escape restores composer | Result activation and navigation |
| Workspace panel and file viewer | Opened actual panel and expanded temporary folder with Enter; nested file visible; A18/A20; Shift+F10 does not open context menu | Preview/Code/Maximize/Back and Git diff exercised; Code has named Editor content textbox; preview focus accepted; A31 diff semantics |
| Plugins catalog | Local ZIP chooser/review/install/enable/disable/uninstall exercised with keyboard; named dialogs/checkboxes; A30 | Lifecycle route focus; official configuration boundaries |
| Plugins skills | Private installed Skill detail and remove/add Agent menu exercised; named controls; A05/A32 | Draft toggle label and dialog focus return; standalone editing/import |
| Plugins MCP | Tree inspected | Enable/configuration/dialog flow |
| Plugins built-in OCR | Tree inspected | Engine selection/configuration |
| Settings overview | Tree inspected | Filter and navigation controls |
| Settings common | Tree inspected; A03 | Form keyboard operation |
| Settings display | Tree inspected; A06 | Language/theme/font controls |
| Settings environments | Named filter/menu verified; Move to Bottom reorders two directories and persists sort order | Archive/restore removal dialog |
| Settings provider | Custom provider created through named UI fields and localhost model discovery; A35 | Connection focus and configured provider/model actions |
| Settings DeepChat agents | Add/Name/Save creates a local agent; named tool toggles and settings inspected; A06/A28 | Save focus/status, deletion, advanced settings |
| Settings ACP | Enabled with Space; Add Custom Agent named dialog opened with Enter; Enabled switch unnamed; A05 | Registry dialog and persistence |
| Settings dashboard alias | Verified redirect to overview usage | Same as overview |
| Settings MCP (hidden) | Enabled with Space; server cards inspected; Add Server named dialog and JSON field verified; master/per-server switches unnamed | Manual server configuration and tool controls |
| Settings OCR (hidden) | Tree inspected | Same as plugins OCR |
| Settings toolchains | Tree inspected | Runtime action feedback |
| Settings remote (hidden) | All five tabs and named bindings dialogs exercised with keyboard; credential fields inspected; A06 | Default-agent/brand labels and meaningful enable-toggle names; live account flows outside fixture |
| Settings hooks | New Hook inserted with Enter; named command/name/event controls inspected | Save/edit lifecycle and action feedback |
| Settings scheduled tasks | New job inserted with Enter; A15 | Named form, focus, edit/enable/run actions |
| Settings plugins (hidden) | Tree inspected | Plugin detail configuration |
| Settings prompts | System/custom dialogs opened with Enter; named dialog/form inspected; A06/A16 | CRUD, parameter and attachment actions |
| Settings memory | Enabled in isolated profile, created local memory, inspected Directives/Diagnostics; A06/A33 | Memory row actions/focus and directive save |
| Settings knowledge base | RAGFlow expanded via unnamed wrapper; named Add Configuration dialog and labels verified; config enable/edit/delete unnamed; A07 | Dify/FastGPT/built-in/Nowledge form journeys |
| Settings data/privacy | Tree inspected; Set password and Reset Data dialogs opened with Enter; initial focus and Escape return verified; A08 | Sync, encryption persistence, import/export |
| Settings shortcuts | Tree inspected; A09 | Shortcut capture/cancel/reset |
| Settings about | Disclaimer opened with Enter; named dialog and Close focus verified; A06 | Update status |
| Settings debug | Route excluded from production build; renders no content | Development-only, no production feature claim |
| Browser window/overlay | Local data URL and browser AX inspected; named host controls; Tab from Address bar skips embedded content; A27 | Keyboard entry/return bridge and preview modes |
| Floating window | Enabled from Display using Space; focusable native window and AX inspected; A29 | Expand/collapse keyboard entry and hidden-content semantics |
| Plugin settings window | Pending | Host-provided controls and content boundary |
| Native file/save dialogs | Chat Attach and prompt Upload from device invoke native file chooser with Enter | Save invocation/focus return; OS screen-reader speech remains unverified |

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

A deterministic local streaming run also verifies a persistent polite, atomic status region changes from Running to Generation is complete without announcing each response token. An HTTP 400 fixture produces Generation failed; activating Stop with Enter produces User canceled generation. The user and assistant content remain available in a named focusable conversation region.

Only within the isolated Electron process, enabling its accessibility-support flag exposes all 200 headings of a completed long Markdown response and all 222 already loaded messages. This tests the app response to assistive-technology activation; it does not activate macOS VoiceOver or certify speech output.

A local blocking-question fixture verifies its named region receives focus, its question labels the radio group, and multiword options retain names and descriptions. ArrowDown moves to Option B without submission; Space selects it, and Tab to Confirm followed by Enter sends the answer. The assistant resumes and the composer regains focus. A separate Default permissions fixture verifies the named permission region receives focus and Tab followed by Enter on Deny returns focus to the composer.

Slash completion keeps focus in the composer while `aria-controls` identifies the listbox and `aria-activedescendant` follows ArrowDown to the selected option. Escape removes both associations; pressing Enter afterwards sends the typed slash instead of accepting a hidden candidate. An empty file mention exposes the localized No matching results status without a stale active descendant.

Global search opens a named dialog with a focused named combobox, listbox and options. ArrowDown updates active selection, Tab cycles between the combobox and Close, and both Escape and Close restore the opening control. Conversation search opened with Meta+F returns focus to the original composer on Escape. Sending the first message from a new thread preserves focus in the replacement composer after the chat route opens.

Workspace opens as a named focused complementary region and is excluded from accessibility traversal when closed. Files and folder controls expose expanded state and associated content. Shift+F10 opens the folder context menu and Escape restores its trigger. Activating readme.md focuses its named preview region; Back restores the file button, and closing Workspace restores its opener. The named separator supports Home/End resizing; ArrowRight reduces the width from 558 to 526.

Generated images have a Preview image button: Enter opens the image dialog, Escape restores the trigger, and Shift+F10 opens Copy as Image/Save Image As actions. Inline message editing exposes a textbox named Edit message. The custom-prompt Upload from device button invokes a native file chooser with Enter.

A temporary workspace containing two files verifies file mention options are named, associated with the composer, and selectable with ArrowDown and Enter. Branch to New Chat creates the fork with the original messages and places focus in the new composer.

All 22 settings routes were reinspected after field-label changes: available production pages expose named controls, including logging/proxy, environments, ACP/MCP, display, memory selectors, remote defaults, sync and shortcuts. Knowledge-provider disclosure buttons and switches are separate named controls. New job places focus in Name and exposes named schedule fields. Saving a new DeepChat agent announces Saved and returns focus to Name.

Memory creation focuses its named Add memory region, then focuses Memory details after saving. Memory rows have a separate primary button and named Edit/Archive/Delete actions. Escape from details or editing returns to the record button. Environment Move to Bottom works through its named menu and persists the changed order.

Installing or uninstalling the private ZIP fixture focuses the named Plugins region on the resulting route. Closing its Skill detail dialog with Escape restores the original card. Creating a provider through the local UI connection flow focuses its named connected-result region; entering View models focuses the Providers main landmark.

Configured providers have separate named selection and More buttons in the Tab order. Move Down changes their order and the order survives reload. Model Configure/Add dialogs expose named model type, visual ability, speech recognition, function calls and reasoning controls.
