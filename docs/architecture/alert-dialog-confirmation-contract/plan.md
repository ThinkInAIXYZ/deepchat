# Alert Dialog Confirmation Contract Plan

## Approach

Implement the contract as separate, reviewable layers. Shared UI defines event ordering, async
surfaces own completion, feature state retains operation targets, and Memory services preserve
domain rejection reasons.

## 1. Shared synchronous wrapper contract

Update the vendored `AlertDialogAction` and `AlertDialogCancel` wrappers to:

- disable automatic attribute fallthrough;
- declare a typed `click` event;
- forward non-click attributes to Reka;
- synchronously emit the consumer click from a capture listener before Reka's bubbling
  `DialogClose` handler.

Use Vue `mergeProps` semantics so an explicit consumer `@click.capture` remains ordered before the
wrapper's component-event bridge and executes only once. Remove the ChatPage `.capture`
workaround.

Add a real-primitive contract suite using actual Reka components. Cover Action and Cancel ordering,
ordinary and capture listeners, `once`, `prevent`, `stop`, descendant click targets, disabled
state, and keyboard-generated clicks. Modifier cases document native behavior; application source
will forbid using `prevent` or `stop` as lifecycle control.

## 2. Explicit asynchronous action

Add a visually compatible alert-dialog action implemented on the project Button primitive rather
than Reka `AlertDialogAction`. It never closes the dialog automatically.

Migrate:

- OCR cache cleanup;
- browser sandbox cleanup;
- data reset;
- provider rate-limit disable;
- `MemoryInlinePanel` deletion.

Each owner controls open, pending, success, and failure explicitly. Cancel and Escape dismissal are
ignored while pending. Success closes; failure retains the dialog and retry context.

After migration, add a lint-time source guard that scans Vue opening tags and rejects
`@click.prevent` or `@click.stop` on `AlertDialogAction` and `AlertDialogCancel`. Remove all
remaining local `.capture` workarounds.

## 3. Typed confirmation target state

Replace Memory list deletion's nullable target/open coupling with a discriminated request state:

```text
idle
confirming(target)
pending(target)
```

Derive dialog visibility from the state and retain the target through the request. Dismissal only
transitions `confirming -> idle`.

Replace Skill conflict's independently mutable `conflictDialogOpen`,
`pendingInstallAction`, and display name with one typed request state. Snapshot the install
operation before transitioning out of confirmation.

## 4. Structured Memory command outcomes

Define a shared `MemoryCommandResultSchema` with `applied` and `rejected` variants and a closed
reason enum. Preserve reasons inside management, persona, and conflict services rather than
mapping a final boolean at the route.

Migrate boolean Memory command routes and clients coherently, prioritizing:

- conflict resolution;
- persona rollback;
- persona draft approval and rejection;
- persona anchor updates;
- archive, restore, and delete paths already checking booleans.

Keep result payloads minimal unless a caller needs a committed entity. Update renderer callers to
handle `rejected` explicitly and add failure-path tests.

Remove `MemoryInlinePanel.changed` declarations and emissions. Keep `memory.updated` as the only
page-level refresh signal.

## 5. Validation and review

For every commit:

1. inspect the staged diff and affected callers;
2. review hidden side effects, compatibility, boundaries, performance, security, naming, test
   gaps, and maintenance cost;
3. report findings in severity order internally;
4. fix every actionable finding;
5. rerun focused tests and type checks before committing.

Final validation:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:memory
pnpm run test:renderer
```

Run smaller focused suites after each implementation layer. Do not push the branch.

## Rollback

Each layer is independently revertible. No persistence migration is introduced. Reverting the
Memory result-contract commit requires reverting its synchronized service, route, client, and
renderer changes together.
