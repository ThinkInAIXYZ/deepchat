# Renderer Scope and State Ownership

## Application Boundaries

Chat main, Settings, floating, splash, and browser-overlay have independent entries, bootstrap,
Pinia, i18n, and lifecycle. `apps/chat-main` owns the chat composition root and lazy route host.
`renderer/api/*Client` remains the IPC adapter; feature-specific forwarding facades are not needed.

The chat display model belongs to
[Chat Display Model Boundary](../chat-display-model-boundary/spec.md). Shared appearance code in
`foundation/appearance` stays independent of chat feature/store state. Each app initializes it from
its own data sources and releases subscriptions during cleanup.

## Submission, Refresh, and Navigation

- A new-thread submission lock covers all asynchronous preparation, including attachments. A draft
  cannot create/send twice before the first submission settles; failure allows retry, and only
  success clears the draft.
- Targeted refresh uses per-Session request identity: the newest request for one id wins while
  unrelated ids may resolve concurrently. A full-list epoch invalidates older targeted work.
- A stale first-page response cannot overwrite a targeted update committed after that page request
  began. Merge cannot replace newer Session data with an older `updatedAt` value.
- Directed activation/deactivation events received before webContents identity resolves are retained
  and applied once the identity is available.
- Start-deeplink defaults, model lookup, route changes, and Session closure commit only for the
  current token. Each asynchronous boundary rechecks it; stale work cannot clear a newer payload.
- `updatedAt` guards renderer state against stale responses; it does not replace main-process
  persistence ordering.

## Chat Rendering, Search, and History

Only the current streaming assistant row receives generating state. Historical rows do not recompute
activity groups solely because the Session begins or ends generation.

The display list preserves logical message order, cached record conversion, placeholder/render-key
handoff, message virtualization, and reading anchors. Array identity and a private stable-history/
streaming-tail layout path are not public contracts or substitutes for user-visible performance.

Rich user content, mentions, inline Skills/files, collapse measurement, and search share the model's
visible-text projection. Search excludes raw or hidden metadata, ignored controls, and collapsed tool
details that its DOM highlighter cannot activate. Debounced scanning and highlighting preserve close,
Escape, result counts, visible matches, and keyboard navigation without using stale indices.

History loading distinguishes exhaustion from failure. Failure exposes an accessible retry path and
cannot falsely report the end of history. Search, Spotlight, capture, and export retain access to the
loaded history under the viewport's existing ownership rules.

## Asynchronous Appearance and Project State

- Floating controls subscribe before reading their initial snapshot. A failed optimistic write
  restores its actual previous value.
- Agent defaults resolving asynchronously cannot overwrite a project manually selected while the
  request was pending.
- Language state preserves explicit LTR as well as RTL direction.
- An outdated project snapshot error cannot overwrite a newer local mutation.

## Validation and Compatibility

Regression tests protect submit locking, refresh/deeplink races, directed events, visible search
semantics, history retry, and independent app cleanup. Markdown tests protect worker initialization,
artifact identity, language normalization, link/reference handling, retry, unmount guards, and the
live streaming handoff. Markstream profile constants remain tuning choices rather than application
API contracts.

Performance work must preserve sending, navigation, streaming, search, history, typed IPC, stored
data, and user settings. It must not replace the scroll controller, message-window anchors, or the
single `messageIpc.ts` tombstone/generation gate without a separately validated contract. Bundle,
cache, or worker changes require evidence of the cost they address.
