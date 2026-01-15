# Message Render Refactor TODO

Goal: replace `vue-virtual-scroller` with a box + IntersectionObserver (IO) rendering model, then
persist message heights to DB and sync minimap/message list from a shared box index.

Status: planning-only document for Code AI. No implementation yet.

## Scope & Principles
- Keep current message flow and DB refresh mechanism (scheduler flush) in phase 1.
- Keep current streaming scheduler behavior and event pipeline intact.
- Replace virtual list with fixed box anchors + IO-driven child mount/unmount.
- Streamed messages show a temporary placeholder bar in minimap; only finalized boxes are indexed.
- Heights are persisted in message table after stream completion (final height only).
- Variants: persist per-variant height at completion; switching variants updates box height in-memory.

## Phase 1: Rendering Layer Replacement (No DB Changes)
Goal: replace `vue-virtual-scroller` while keeping data flow unchanged.

### Tasks
- Replace `vue-virtual-scroller` usage in message list with a box container list.
  - Each box has a stable `id` (message id) and an anchor element for scroll targets.
  - Only render child content when `inView` or within pre-render buffer.
  - When not in view, keep box element with cached height to prevent collapse.
- Replace virtual scroller prefetch with range-based prefetch from rendered boxes.
- Implement IntersectionObserver logic:
  - Track `inView` for each box.
  - Pre-render buffer: render current + 2 boxes ahead/behind.
  - Handle fast scroll: allow brief blank gaps.
- Streaming boxes:
  - Do not add to minimap/index until streaming is finalized.
  - Render streaming box content as usual in message list.
  - Expose a placeholder minimap bar for streaming item (skeleton style).
- Anchor behavior:
  - Keep existing anchor ids (message id).
  - Maintain scroll alignment compatibility with current scheduler behavior.

### Edge Cases
- Message height changes after first render (code block expand, image load).
  - Update cached height in memory; do not persist in phase 1.
- Variant switching:
  - Update box height for displayed variant and keep anchor stable.
- Streaming cancellation/error:
  - Box should finalize and enter index only after the stream enters terminal state.
- Long conversations:
  - Ensure IO observers are detached for removed boxes to avoid leaks.
- Message selection/highlight features:
  - `data-message-id` now exists on the box wrapper; ensure highlight logic still finds
    `data-message-content` within the box and does not break context selection.
- Minimap streaming placeholder:
  - Placeholder bars reuse the real message id to preserve anchor clicks; ensure no duplicate ids
    are emitted into the minimap list.
- Image capture:
  - `copy-image` should verify the message content is rendered (not just the box placeholder),
    otherwise force scroll/render before capture.

### Validation Checklist
- Scrolling remains smooth with 1000+ messages.
- Anchor jumps land on correct message.
- Minimaps still align with list and update on new messages (excluding streaming placeholder).

## Phase 2: Height Persistence + Minimap/List Sync via Box Index
Goal: persist stable heights and use a shared box index as the single source of truth.

### DB Changes
- Add two fields to message table:
  - `dom_height` (number)
  - `dom_top` (optional, only if needed for debugging/compat)
- Persist height at terminal state only (stream end/cancel/error).
- Variant support:
  - Store height per variant message row (if variants are separate messages).
  - On variant switch, in-memory height switches to variant height; DB unchanged until variant completes.

### Store Model
- Introduce a `boxes` array in chat store:
  - `{ id, messageId, height, isStreaming, inView }`
  - `id === messageId` for stability
- Build `boxes` from message list and persisted heights.
- Use `boxes` as source for both minimap bars and message list rendering.
- Streaming messages produce a placeholder box in minimap with skeleton state.

### Update Timing
- On stream end/cancel/error:
  - Measure DOM height and persist to DB (message row).
  - Update box height in store.
- On historical load:
  - Load message list + heights from DB, build `boxes`, then render.

### Edge Cases
- Height missing for older messages: estimate height then update on first render.
- DB write failure: keep in-memory height but log a warning.
- Variant switching: if variant height missing, use last known height until measured.

### Validation Checklist
- Historical load uses persisted heights without layout thrash.
- Minimap and message list stay in sync after loading/streaming/variant switch.
- DB writes occur only on terminal states.

## Files to Read/Touch (Initial Pass)
- Message list: `src/renderer/src/components/message/MessageList.vue`
- Minimap: `src/renderer/src/components/message/MessageMinimap.vue`
- Message store: `src/renderer/src/stores/chat.ts`
- Runtime cache: `src/renderer/src/lib/messageRuntimeCache.ts`
- Streaming scheduler: `src/main/presenter/agentPresenter/streaming/streamUpdateScheduler.ts`
- Message DB schema/migrations: `src/main/presenter/sessionPresenter` (locate message table schema)

## Non-Goals
- No changes to LLM stream scheduler logic.
- No changes to main-process event bus.
- No format/lint tasks in this doc.
