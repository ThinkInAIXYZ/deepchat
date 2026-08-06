# 014 — Animate session-list row insert with TransitionGroup (opportunity)

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM (opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file (WindowSideBar.vue) + scoped CSS

## Problem

New chat sessions pop into the sidebar rail with no spatial cue, and deleted ones vanish while
neighbors snap together — the app's primary navigation list (tens of inserts/day) has no motion.
This is a *missed opportunity*: a FLIP move + 140ms opacity/transform entrance would explain where
rows come from without violating the crisp-productivity budget.

Hard constraints (from the component's existing behavior):
- The list is **not** virtualized the way the message list is, but it has viewport **auto-fill
  pagination** (`sessionStore.loading`, infinite scroll) and a **pin-flight clone system**
  (`captureSessionItemRect`, `.sidebar-pin-flight`) — both are measurement-sensitive and must not
  see transient mid-transition sizes.
- Group collapse uses `v-show` wrappers — do not touch them.

Current code — the chat-section list is a plain `v-for` inside a `v-show` container
(`src/renderer/src/components/WindowSideBar.vue:461-462` area; the pinned list at 266-284 and
group lists at ~315 are similar):

```html
<div v-show="!isChatSectionCollapsed" class="space-y-0.5">
  <WindowSideBarSessionItem
    v-for="session in chatSessions"
    :key="`chat-${session.id}`"
    ...
  />
</div>
```

## Target

Wrap **only the chat-section list** (the most common insert path — new chat lands there) in a
`TransitionGroup`, with enter/move (no absolute-position leave, which would fight the
measurement code):

```html
<TransitionGroup
  v-show="!isChatSectionCollapsed"
  name="chat-session-row"
  tag="div"
  class="space-y-0.5"
  :class="{ 'chat-session-rows-static': chatSessionRowsStatic }"
>
  <WindowSideBarSessionItem
    v-for="session in chatSessions"
    :key="`chat-${session.id}`"
    ...
  />
</TransitionGroup>
```

Scoped CSS (add to the component's style block):

```css
.chat-session-row-enter-active {
  transition: opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.chat-session-row-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.chat-session-row-move {
  transition: transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.chat-session-rows-static .chat-session-row-enter-active,
.chat-session-rows-static .chat-session-row-move {
  transition: none;
}

.chat-session-rows-static .chat-session-row-enter-from {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .chat-session-row-enter-active,
  .chat-session-row-move {
    transition: none;
  }

  .chat-session-row-enter-from {
    opacity: 1;
    transform: translateY(0);
  }
}
```

No leave transition: removal snaps, which is the *safe* choice here (leave with absolute
positioning would distort `captureSessionItemRect` / pin-flight measurements). The insert and
reorder cues carry the improvement.

## Repo conventions to follow

- Token usage: `var(--dc-motion-fast)` + `var(--dc-ease-out-soft)` for entrances,
  `var(--dc-motion-default)` + `var(--dc-ease-out-express)` for movement —
  same file line 142 is the exemplar.
- `@media (prefers-reduced-motion: reduce)` block pattern:
  `src/renderer/src/components/WindowSideBar.vue:2105`.

## Steps

1. Convert the chat-section list container to
   `<TransitionGroup name="chat-session-row" tag="div">` (keep `v-show`,
   `class="space-y-0.5"`), and add `chat-session-rows-static` while rows load or a pin flight
   is active.
2. Add the chat-section-specific CSS above to the component's `<style>` block.
3. Run the full WindowSideBar test suite; if any auto-fill / pin-flight / reorder test fails,
   revert to enter-only (`chat-session-row-move` removed) and re-run — do not improvise other
   changes.

## Boundaries

- Do NOT wrap the pinned list or group lists (pagination + pin-flight interactions live there).
- Do NOT add a leave transition (measurement risk).
- Do NOT touch `v-show` collapse behavior or the pin-flight clone logic.
- Keep pagination rows static while `sessionStore.loading` or `sessionStore.loadingMore` is true:
  suppress enter/move transitions and override the enter-from state to the final visible state so
  Vue's temporary class cannot flash.
- Keep chat-section rows static for the full pin-flight lifecycle so source and target rectangle
  measurements never observe an active FLIP move.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/WindowSideBar.test.ts` (50 tests
  including "viewport auto-fill" and "reorder" suites) must pass.
- **Feel check**: create a new chat:
  - The new row slides down into place (140ms) while neighbors glide via FLIP (220ms); no
    double-render flicker.
  - Delete a session: neighbors close the gap instantly (no distortion), then are stable.
  - Scroll a long list to trigger auto-fill: loaded rows do NOT animate.
  - Toggle `prefers-reduced-motion: reduce`: everything snaps with no entrance flash.
- **Done when**: inserts/moves animate with tokens, pagination loads stay static, and all 50
  WindowSideBar tests pass.
