# Alert Dialog Confirmation Contract

## Status

Implemented.

## Context

DeepChat wraps `reka-ui` alert-dialog primitives in vendored shadcn components. In
`reka-ui@2.10.1`, `AlertDialogAction` and `AlertDialogCancel` both delegate to `DialogClose`.
`DialogClose` installs its own bubbling click handler before fallthrough consumer handlers, so a
controlled dialog emits `update:open=false` before the business `@click` handler runs.

That ordering creates several distinct failures:

- Memory list deletion clears its target during `update:open` and then performs no deletion.
- Skill conflict overwrite clears its pending install action and then performs no overwrite.
- OCR cache and browser sandbox cleanup run, but their failure feedback is hidden after the
  confirmation dialog closes.
- Data reset loses dialog-owned pending and retry context even though page feedback remains.
- Local `.capture` and `.prevent` workarounds encode inconsistent and misleading behavior.

The existing renderer tests replace alert-dialog actions with plain buttons. Those doubles erase
the close-before-click behavior and produce false-positive deletion and overwrite tests.

Memory commands expose a related truthfulness problem. Several service methods return `boolean`,
where `false` can mean unavailable, not found, invalid state, stale conflict state, or a rejected
transition. Five renderer call sites ignore that value and rely exclusively on `memory.updated`,
which is not emitted for a rejected command.

A post-implementation review exposed additional ownership gaps:

- an async action can remain enabled after its handler eligibility changes and then return without
  feedback;
- regular close actions can still call locally declared `async` handlers;
- several destructive confirmations still close before their pending and failure state settles;
- page-level feedback can be moved into, or cleared by, an unrelated delete dialog;
- structured Memory rejection reasons reach the renderer but are collapsed to generic copy;
- rejected commands that prove a local projection stale do not trigger reconciliation;
- the Memory agent tool forwards the internal command-result object into model-visible output.

## Goal

Establish one explicit confirmation contract across shared UI and Memory domain boundaries:

1. synchronous alert-dialog business handlers run before the primitive closes;
2. asynchronous confirmations that own pending or failure UI do not inherit automatic close;
3. confirmation targets survive dismissal and pending transitions through typed state;
4. rejected Memory commands retain a typed reason instead of collapsing to `false`;
5. real primitive tests protect the event-order contract and user-visible regressions.

## Required Invariants

### Synchronous close actions

- `AlertDialogAction` and `AlertDialogCancel` expose the same component-level `click` event
  contract.
- The consumer handler runs exactly once before Reka emits `update:open=false`.
- native attributes and explicit capture listeners continue to reach the rendered element.
- disabled buttons do not invoke the consumer or close the dialog.
- keyboard activation follows the same ordering as pointer activation.
- the wrapper does not wait for returned promises.

`@click.prevent` and `@click.stop` are not lifecycle APIs. Neither modifier may be used on
`AlertDialogAction` or `AlertDialogCancel` call sites. A source guard must reject both so future
code cannot accidentally depend on modifier-specific propagation behavior.

Regular close-action click handlers must be synchronously declared. A source guard must reject
locally declared `async` handlers, inline async expressions, and dynamic listener forms that it
cannot prove synchronous. A workflow that intentionally closes after synchronously retaining its
target may start background work from a synchronous handler.

### Asynchronous confirmations

- a dedicated alert-dialog action renders the same visual button contract without delegating to
  `DialogClose`;
- the owning component snapshots the operation target before starting work;
- pending state disables dismissal and repeated submission;
- success explicitly closes the dialog;
- failure keeps the dialog open with local retry context;
- async callers do not depend on a pending flag being set before the first `await` to suppress
  automatic close.
- the action's disabled predicate covers every condition that can make its handler return before
  starting work.
- controlled content remains mounted while its operation is pending, including when a related
  refresh switches the owning panel into a loading state.

OCR cache cleanup, browser sandbox cleanup, data reset, provider rate-limit disable, and inline
Memory deletion must use the explicit async contract because they already render pending or
failure state associated with their confirmation surface.

Memory directive deletion, Memory clear-all, persona rollback, and built-in knowledge
configuration removal must follow the same contract. Their confirmation target and failure
feedback remain owned by the dialog until success or explicit dismissal.

### Feedback ownership

- page or panel feedback remains visible in its owning surface while a confirmation is open;
- a confirmation renders only feedback produced by its own operation;
- dismissing a confirmation clears only confirmation-owned feedback;
- an unrelated refresh or background mutation cannot move feedback into a destructive dialog.

### Confirmation target ownership

Visibility must be derived from a typed operation state when closing the dialog can otherwise
destroy the command payload. Memory deletion and Skill overwrite must not maintain an independently
mutable `open` boolean and nullable target or callback whose lifetimes can diverge.

Dismissal may clear a confirming request. It must not clear an in-flight request.

### Memory command results

Memory commands that can reject without throwing return a discriminated result from the service
boundary:

```text
{ action: 'applied' }
{ action: 'rejected', reason: <closed domain reason> }
```

- the service preserves the reason where the decision is made;
- shared routes validate the closed result;
- renderer clients return the typed result;
- renderer callers handle both variants exhaustively;
- a rejected command displays reason-specific local feedback and does not wait for
  `memory.updated`;
- `not-found`, `invalid-state`, and `stale` rejections reconcile the local projection explicitly
  because rejected commands emit no mutation event.
- reconciliation feedback is promoted to the persistent projection owner before a stale child
  surface can be removed.

The existing `MemoryDirectiveCommandResultSchema` is the local precedent. New command reasons may
share vocabulary, but directive-specific payloads remain separate. Directive capacity remains a
directive-only reason; shared `not-found` and `unavailable` meanings reuse the Memory command
vocabulary. Directive deletion returns a structured command result rather than the last bare
boolean route.

### Refresh ownership

`memory.updated` remains the single cross-panel refresh path. The unused
`MemoryInlinePanel.changed` event is removed rather than wired to a second refresh source.
Local recovery after a rejected command may request reconciliation from the immediate projection
owner; that event reports no mutation and does not replace `memory.updated`.

### Model-visible tool output

Internal Memory command results are not forwarded wholesale to model-visible tool output.
`memory_forget` preserves its public `{ ok }` result and uses sanitized summaries; internal action
and rejection enums remain diagnostic implementation details.

## Acceptance Criteria

1. Memory list permanent delete invokes `memoryClient.remove` exactly once with the selected ID.
2. Skill overwrite invokes the retained install operation exactly once.
3. Action and Cancel consumer clicks run before `update:open=false` with real Reka primitives.
4. OCR, sandbox, reset, provider-rate-limit, and inline Memory confirmations remain open while
   pending and after failure, then close on success.
5. No alert-dialog Action or Cancel uses `.capture`, `.prevent`, or `.stop` as a local workaround.
6. A lint-time source guard rejects future `.prevent` and `.stop` call sites.
7. Rejected Memory persona and conflict commands produce local failure feedback.
8. `MemoryInlinePanel` declares and emits no `changed` event.
9. Every async confirmation keeps its own pending and failure state visible and cannot silently
   return from an enabled action.
10. Regular close actions cannot bind locally declared async or uninspectable click handlers.
11. Memory command rejection copy identifies the actionable reason and stale projections reload.
12. Delete-dialog dismissal cannot clear unrelated page or panel feedback.
13. `memory.deleteDirective` returns a structured command result and `memory_forget` exposes only
    its stable public result.
14. Pending confirmation content survives owner refresh and reconciliation feedback survives child
    removal.
15. Focused renderer and Memory suites, formatting, i18n, lint, and type checking pass.
16. Every commit is preceded by a severity-ordered review and no branch is pushed.

## Compatibility

- Existing Action and Cancel props, slots, styling, and native attributes remain supported.
- The `click` listener becomes an explicitly declared component event instead of native
  fallthrough; event payload remains the original `MouseEvent`.
- Action/Cancel callback ordering intentionally changes from close-before-click to
  click-before-close.
- Memory route output changes are internal typed IPC contracts and require synchronized main,
  preload/client, renderer, and test updates. No persisted data or database migration changes.

## Non-Goals

- Replacing Reka UI or the vendored shadcn component set.
- Building a generic promise-owning dialog framework.
- Reworking unrelated Dialog, Sheet, Drawer, or notification behavior.
- Consolidating all duplicated Memory panel lifecycle code.
- Caching forwarded wrapper attributes: Vue `useAttrs()` is live but not reactive, so merging
  during render is required for updated fallthrough attributes.
- Adding or synchronizing a GitHub issue.
