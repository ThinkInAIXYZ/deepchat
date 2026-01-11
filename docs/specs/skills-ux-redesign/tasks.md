# Skills UX Redesign - Development Tasks

> Version: 1.1
> Date: 2025-01-11
> Related: [analysis.md](./analysis.md) | [spec.md](./spec.md)

---

## Task Overview

| Phase | Description | Tasks | Priority | Status |
|-------|-------------|-------|----------|--------|
| 1 | Flatten Menus | 4 | P0 | ✅ Done |
| 2 | Skills Indicator | 7 | P0 | ✅ Done |
| 3 | Slash Trigger | 6 | P0 | ✅ Done |
| 4 | Sync Optimization | 5 | P1 | ✅ Done |

**Total: 22 tasks**

---

## Phase 1: Flatten Menus (Decision 2) ✅

> Goal: Remove secondary category selection, show flat filtered list directly.
> Status: **Completed**

### 1.1 Remove Category Navigation Logic ✅

**File:** `src/renderer/src/components/editor/mention/MentionList.vue`

- [x] Remove `currentCategory` ref and `isCategoryView` computed
- [x] Remove `backHandler()` function
- [x] Remove `saveCurrentIndexForCategory()` and `getLastIndexForCategory()` helpers
- [x] Remove `lastIndexMap` ref
- [x] Simplify `onKeyDown` to remove Backspace category navigation

**Acceptance Criteria:**
- ✅ No category state management in component
- ✅ Backspace key no longer triggers category back navigation

---

### 1.2 Simplify displayItems Logic ✅

**File:** `src/renderer/src/components/editor/mention/MentionList.vue`

- [x] Update `displayItems` computed to return flat filtered list

**Acceptance Criteria:**
- ✅ List shows all matching items without category grouping
- ✅ Maximum 10 items displayed
- ✅ Fuzzy search works on item labels

---

### 1.3 Update Template for Flat Display ✅

**File:** `src/renderer/src/components/editor/mention/MentionList.vue`

- [x] Remove category view header (`v-if="isCategoryView"`)
- [x] Remove chevron-right icon for category items
- [x] Add type indicator icons based on `item.category`:
  - `skills` → ✨ (amber)
  - `prompts` → 💬 (blue)
  - `tools` → 🔧 (green)
  - Others → use `item.icon`
- [x] Add description display (truncated, right-aligned)

**Acceptance Criteria:**
- ✅ Each item shows type icon + label + description
- ✅ Visual distinction between different item types
- ✅ No category rows in the list

---

### 1.4 Update CategorizedData Type ✅

**File:** `src/renderer/src/components/editor/mention/suggestion.ts`

- [x] Keep `'category'` in type union for backward compatibility but not displayed
- [x] Clear category entries from initial `categorizedData` array
- [x] Items now populated by `useMentionData` composable

**Acceptance Criteria:**
- ✅ All mention items are direct items with category metadata
- ✅ Category entries no longer rendered

---

## Phase 2: Skills Indicator (Decision 3) ✅

> Goal: Add visible Skills indicator in chat input toolbar.
> Status: **Completed**

### 2.1 Create useSkillsData Composable ✅

**File:** `src/renderer/src/components/chat-input/composables/useSkillsData.ts` (NEW)

- [x] Create composable with:
  - `skills: Ref<SkillMetadata[]>` - all available skills
  - `activeSkills: Ref<string[]>` - currently active skill names
  - `loadActiveSkills()` - fetch active for conversation
  - `toggleSkill(skillName)` - activate/deactivate skill
  - `activeCount: ComputedRef<number>` - count of active skills
  - `activeSkillItems` / `availableSkills` - computed filtered lists
- [x] Add event listener for `skill:activated` / `skill:deactivated`
- [x] Add watcher for conversationId changes

**Acceptance Criteria:**
- ✅ Skills data reactive and auto-updates
- ✅ Toggle correctly calls `skillPresenter.setActiveSkills`
- ✅ Responds to external skill state changes

---

### 2.2 Create SkillsPanel Component ✅

**File:** `src/renderer/src/components/chat-input/SkillsPanel.vue` (NEW)

- [x] Create component with props:
  - `skills: SkillMetadata[]`
  - `activeSkills: string[]`
- [x] Create emits:
  - `toggle(skillName: string)`
  - `manage()`
- [x] Implement template:
  - Header with title and "Manage" button
  - Active skills section with deactivate buttons
  - Available skills section with activate buttons
  - Empty state when no skills

**Acceptance Criteria:**
- ✅ Shows active skills at top
- ✅ Shows available (inactive) skills below
- ✅ Click toggle emits event
- ✅ Manage button emits event

---

### 2.3 Create SkillsIndicator Component ✅

**File:** `src/renderer/src/components/chat-input/SkillsIndicator.vue` (NEW)

- [x] Create component with props:
  - `conversationId: string | null`
- [x] Integrate `useSkillsData` composable
- [x] Implement Popover with:
  - Trigger: Button showing ✨ icon + active count
  - Content: SkillsPanel component
- [x] Add Tooltip for button hover
- [x] Style: highlight when skills active (primary color border)

**Acceptance Criteria:**
- ✅ Shows sparkles icon
- ✅ Shows count badge when skills active
- ✅ Opens panel on click
- ✅ Tooltip shows summary

---

### 2.4 Add SkillsIndicator to ChatInput ✅

**File:** `src/renderer/src/components/chat-input/ChatInput.vue`

- [x] Import SkillsIndicator component
- [x] Add to toolbar after `<McpToolsList />`:
  ```vue
  <McpToolsList />
  <SkillsIndicator :conversation-id="conversationId" />
  ```
- [x] Ensure conversationId is available (already exists as computed)

**Acceptance Criteria:**
- ✅ SkillsIndicator visible in chat input toolbar
- ✅ Positioned between MCP tools and right-side actions
- ✅ Works in both chat and newThread variants

---

### 2.5 Create skillsActiveStore ⏭️ (Skipped)

**Note:** Decided to use `useSkillsData` composable instead of a separate Pinia store. The composable leverages the existing `skillsStore` for metadata and manages per-conversation state directly via `skillPresenter`.

---

### 2.6 Add Settings Navigation ✅

**File:** `src/renderer/src/components/chat-input/SkillsIndicator.vue`

- [x] Implement `openSettings()` method using `windowPresenter.openOrFocusSettingsTab()`
- [x] Wire to SkillsPanel's `@manage` event

**Acceptance Criteria:**
- ✅ Clicking "Manage" opens settings window

---

### 2.7 Add i18n Keys ✅

**Files:** `src/renderer/src/i18n/{en-US,zh-CN}/chat.json`

- [x] Add `chat.skills.indicator.active` / `chat.skills.indicator.none`
- [x] Add `chat.skills.panel.title` / `manage` / `active` / `available` / `empty`
- [x] Added to en-US and zh-CN

**Acceptance Criteria:**
- ✅ All UI text uses i18n keys
- ✅ Keys exist in en-US and zh-CN locales

---

## Phase 3: Slash Trigger (Decision 1) ✅

> Goal: Separate `/` trigger for skills, prompts, tools from `@` trigger.
> Status: **Completed**

### 3.1 Create SlashMention Extension ✅

**File:** `src/renderer/src/components/editor/mention/slashMention.ts` (NEW)

- [x] Extend TipTap Mention with `name: 'slashMention'`
- [x] Copy attribute definitions from mention.ts
- [x] Add `trigger` attribute to distinguish from @ mentions

**Acceptance Criteria:**
- ✅ Extension can coexist with existing Mention
- ✅ Unique node name prevents conflicts

---

### 3.2 Create slashSuggestion Module ✅

**File:** `src/renderer/src/components/editor/mention/slashSuggestion.ts` (NEW)

- [x] Create with `char: '/'`
- [x] Create `slashMentionData` ref for skills + prompts + tools
- [x] Implement `items({ query })`:
  - Filter skills, prompts, tools by query
  - Sort: skills first, then prompts, then tools
  - Limit to 10 items
- [x] Reuse render logic from suggestion.ts

**Acceptance Criteria:**
- ✅ `/` triggers popup
- ✅ Shows skills, prompts, tools only
- ✅ Query filters results

---

### 3.3 Create useSlashMentionData Composable ✅

**File:** `src/renderer/src/components/chat-input/composables/useSlashMentionData.ts` (NEW)

- [x] Watch skills from skillsStore
- [x] Watch prompts from useAgentMcpData
- [x] Watch tools from useAgentMcpData
- [x] Aggregate into `slashMentionData` with proper category tags
- [x] Sort: skills → prompts → tools

**Acceptance Criteria:**
- ✅ Data updates reactively from all sources
- ✅ Each item has correct category for icon display

---

### 3.4 Update suggestion.ts ✅

**File:** `src/renderer/src/components/editor/mention/suggestion.ts`

- [x] Remove `tools` and `prompts` from categorizedData
- [x] Keep only: context, files, resources (+ workspace files)
- [x] Update useMentionData to remove tools/prompts watchers

**Acceptance Criteria:**
- ✅ `@` trigger only shows context, files, resources
- ✅ No tools or prompts in `@` menu

---

### 3.5 Integrate SlashMention in ChatInput ✅

**File:** `src/renderer/src/components/chat-input/ChatInput.vue`

- [x] Import SlashMention and slashSuggestion
- [x] Add to editor extensions with appropriate styling
- [x] Initialize useSlashMentionData composable
- [x] Wire skill activation handler via `setSkillActivationHandler`

**Acceptance Criteria:**
- ✅ Both `@` and `/` triggers work in editor
- ✅ Different visual styles for @ vs / mentions

---

### 3.6 Handle Skill Selection ✅

**File:** `src/renderer/src/components/editor/mention/slashSuggestion.ts`

- [x] On skill selection:
  - Insert mention node
  - Activate skill for current conversation via handler
- [x] On prompt selection:
  - Handle same as current @ prompts (with params dialog if needed)
- [x] On tool selection:
  - Insert mention node (current behavior)

**Acceptance Criteria:**
- ✅ Selecting skill activates it
- ✅ Prompt param dialog works
- ✅ Tool insertion works

---

## Phase 4: Sync Optimization (Decision 4) ✅

> Goal: Improve skills sync discoverability and status visibility.
> Status: **Completed**

### 4.1 Create Tool Detection Logic ✅

**Note:** Tool detection logic already exists in `src/main/presenter/skillSyncPresenter/toolScanner.ts`

- [x] `EXTERNAL_TOOLS` registry defines all supported tools
- [x] `isToolAvailable()` checks if tool's directory exists
- [x] `scanExternalTools()` scans all registered tools
- [x] Already integrated in skillSyncPresenter interface

**Acceptance Criteria:**
- ✅ Detects installed AI tools on all platforms
- ✅ Returns tool id, name, config path

---

### 4.2 Create SyncStatusCard Component ✅

**File:** `src/renderer/settings/components/skills/SyncStatusCard.vue` (NEW)

- [x] Create component with props:
  - `tool: ScanResult`
  - `syncing: boolean`
- [x] Create emits:
  - `sync(toolId)`
- [x] Implement template:
  - Status indicator (colored dot)
  - Tool name and skill count
  - Import button for available tools

**Acceptance Criteria:**
- ✅ Shows connection status visually
- ✅ Shows skill count
- ✅ Appropriate action button based on state

---

### 4.3 Create SyncStatusSection Component ✅

**File:** `src/renderer/settings/components/skills/SyncStatusSection.vue` (NEW)

- [x] Create component with:
  - Detected tools list from presenter
  - Sync states tracking
  - Refresh functionality
- [x] Implement sync handler:
  - Emits import event for parent to open sync dialog
- [x] Add empty state for no detected tools
- [x] Add show more/less toggle for long lists

**Acceptance Criteria:**
- ✅ Lists all detected external tools
- ✅ Each tool shows SyncStatusCard
- ✅ Refresh updates detection

---

### 4.4 Update SkillsSettings Layout ✅

**File:** `src/renderer/settings/components/skills/SkillsSettings.vue`

- [x] Import SyncStatusSection
- [x] Add before skills list with separator
- [x] Adjust spacing/layout

**Acceptance Criteria:**
- ✅ Sync section visible at top of Skills settings
- ✅ Clean visual hierarchy with skills list below

---

### 4.5 Add First-Launch Detection Dialog ✅

**File:** `src/renderer/settings/components/skills/SyncPromptDialog.vue` (NEW)

- [x] Create dialog component:
  - Shows list of detected tools with skill counts
  - Checkbox to select tools for import
  - "Don't show again" checkbox
- [x] Wire to first launch check via `configPresenter.getSetting('skills.syncPromptShown')`
- [x] Pre-select all available tools by default

**Acceptance Criteria:**
- Dialog appears on first launch if tools detected
- User can import or dismiss
- Preference persisted

---

## Testing Checklist

### Phase 1 Tests ✅
- [x] Typing `@` shows flat list of context/files/resources
- [x] Arrow keys navigate flat list
- [x] Enter selects item
- [x] Backspace deletes characters (no category navigation)
- [x] Query filters items correctly

### Phase 2 Tests ✅
- [x] Skills indicator visible in toolbar
- [x] Count updates when skills activated/deactivated
- [x] Panel opens on click
- [x] Can toggle skills from panel
- [x] Manage button opens settings

### Phase 3 Tests ✅
- [x] Typing `/` shows skills/prompts/tools
- [x] `@` no longer shows tools/prompts
- [x] Skill selection activates the skill
- [x] Prompt params dialog works
- [x] Both @ and / mentions render correctly

### Phase 4 Tests ✅
- [x] Sync section shows in settings
- [x] Detected tools display correctly
- [x] Sync button triggers import dialog
- [x] Status updates after refresh
- [x] First launch dialog appears appropriately

---

## Definition of Done

- [x] All tasks completed and tested
- [x] `pnpm run lint` passes
- [x] `pnpm run typecheck` passes
- [ ] `pnpm test` passes
- [x] i18n keys added to all locales (en-US, zh-CN)
- [ ] No regressions in existing functionality
- [ ] Code reviewed and approved
