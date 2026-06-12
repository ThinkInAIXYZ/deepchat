# Plan

## Diagnosis

### Code Block Toolbar

`src/renderer/src/assets/style.css` imports `markstream-vue/index.tailwind.css`, but Tailwind still
needs to scan the package's generated class candidates. The current source points at:

```css
@source '../../../../node_modules/markstream-vue/dist/tailwind.ts';
```

The installed `markstream-vue@1.0.0-rc.0` package ships `dist/tailwind.js` and
`dist/tailwind.d.ts`, not `dist/tailwind.ts`. Because the source target does not exist, Tailwind
does not see the class candidates used by the package's code block shell, including
`code-block-header`, `px-[var(--ms-inset-panel-x)]`, `py-[var(--ms-inset-panel-y)]`, and
`p-[var(--ms-action-btn-padding)]`.

The package CSS import still provides variables and base styles, so the failure appears as a partial
style regression instead of a fully unstyled component.

### Session Switch Scroll

`src/renderer/src/pages/ChatPage.vue` restores a session by loading messages, waiting for
`nextTick()`, syncing scroll metrics, and then calling `scrollToBottom(true)`.
`scrollToBottom(true)` currently performs a single `requestAnimationFrame` measurement and sets
`scrollTop` from the scroll height available in that frame.

Message rows use `content-visibility: auto` with `contain-intrinsic-size: auto 180px`, and rendered
message content can continue changing size after the first frame. Markdown blocks, code blocks,
images, status rows, and input-area layout can all increase the final scroll height after the forced
scroll has already run. Since no message revision necessarily changes after this late layout settle,
the existing auto-follow watchers do not perform another corrective scroll.

## Proposed Solution

### 1. Restore `markstream-vue` Tailwind Scanning

- Change the renderer Tailwind source from `dist/tailwind.ts` to `dist/tailwind.js`.
- Keep the existing `@import 'markstream-vue/index.tailwind.css'` import for package CSS and design
  variables.
- Add a focused guard so future package path changes fail loudly. The guard should verify that
  representative code block class candidates from `markstream-vue` are included in Tailwind's source
  scanning or generated CSS.
- Manually verify a rendered code block in light and dark themes after the implementation.

### 2. Settle Bottom Scroll During Session Restore

- Add a dedicated session-restore bottom-scroll helper instead of changing normal streaming
  auto-follow behavior.
- The helper should force bottom scroll immediately after session restore and then continue for a
  short bounded settle window.
- Recommended implementation:
  - Use a session-local request id so pending settle work cancels when the user switches sessions
    again.
  - Run a small number of animation-frame retries and stop once `scrollHeight` has remained stable
    for consecutive frames.
  - Attach a temporary `ResizeObserver` to the scroll area or message root for roughly the first
    few hundred milliseconds, forcing bottom again when late layout changes arrive.
  - Disconnect the observer and cancel queued frames once the settle window ends, a spotlight jump is
    requested, the session changes, or the user intentionally scrolls away.
- Keep the current near-bottom logic for streaming updates so the previous bottom-shake fix remains
  intact.

### 3. Force Bottom Scroll After User Submit

- User submit is an explicit intent to continue at the newest message, so submit and command-submit
  paths should schedule a forced bottom scroll after input state has cleared.
- This scroll should complement, not replace, the normal message-list watcher. The forced pass makes
  the watcher robust when `isNearBottom` was stale after session restore or late layout changes.

## Affected Interfaces

- `src/renderer/src/assets/style.css`
- `src/renderer/src/pages/ChatPage.vue`
- Potential focused tests under `test/renderer/**`

No main-process, IPC, persisted data, or i18n surfaces are expected to change.

## Compatibility

- The Tailwind path fix should be compatible with the current pnpm-linked package layout because it
  targets the file that exists in the installed package.
- Session scroll settling is renderer-only and should not change saved session data.
- The bounded observer/retry design keeps the existing `content-visibility` optimization in place
  and limits extra work to the initial restore window.

## Test Strategy

- Add or update a renderer-side guard that fails if `markstream-vue` code block utility candidates
  are no longer visible to Tailwind scanning.
- Add a focused `ChatPage` test that simulates session restore followed by a late `scrollHeight`
  increase without a message revision change, then asserts the scroll position reaches the new
  bottom.
- Keep or extend existing streaming auto-follow tests to verify the session-restore helper does not
  force bottom after the user scrolls away.
- Add a focused submit test that first records a non-bottom scroll metric, sends a message, and then
  asserts the submit path still forces bottom scroll.
- After implementation, run the required project checks: `pnpm run format`, `pnpm run i18n`, and
  `pnpm run lint`, plus targeted renderer tests.
