# DeepChat Agent Harness Boundaries Tasks

## Typed Tool Execution Contract

- [x] Compare Pi and Bub execution semantics with DeepChat's current runtime.
- [x] Record the 156-test dispatch, context-builder, and ToolService baseline.
- [x] Define the trust boundary, capability model, scheduling invariants, and non-goals.
- [x] Review and commit the SDD slice.
- [x] Add the canonical nested execution contract and shared preset catalog.
- [x] Classify every built-in definition and default external MCP definitions conservatively.
- [x] Extract and integrate the fail-closed batch execution policy.
- [x] Preserve provider projection and historical context-reserve behavior.
- [x] Add policy, dispatch, MCP ingress, provider-boundary, and token-boundary coverage.
- [x] Run focused tests and full type checking.
- [x] Run formatting, i18n validation, lint, and the full main-process suite.
- [x] Review the complete implementation diff and fix every finding.
- [x] Commit the implementation without pushing.

## Coordinator Ownership

- [x] Compare Pi and Bub orchestration boundaries with DeepChat's durable runtime semantics.
- [x] Define minimal Session scope and the four distinct lifecycle fence semantics.
- [x] Define owner responsibilities, typed claim disposition, feedback-loop wiring, compatibility,
      and non-goals.
- [x] Remove private coordinator reflection from runtime tests without changing production source.
- [x] Add status-order, settlement, fencing, queue-disposition, return-mapping, and Memory baselines.
- [x] Add minimal runtime scopes and extract status/pre-stream/context-budget policies.
- [x] Make one coordinator own run lifecycle, cancellation, settlement, and queue wakeup.
- [x] Extract pending-input admission and the single queue pump; delete duplicate claim/drain logic.
- [x] Extend the existing compaction owner and reduce the root to composition and compatibility.
- [x] Split owner tests while retaining focused full-runtime integration coverage.
- [x] Update architecture guards and regenerate the layered-runtime baseline.
- [x] Correct the SDD to enumerate all twelve intentional ownership behavior changes.
- [x] Pin the follow-up/drain overlap and verify the four existing ownership regression tests.
- [x] Treat concurrent terminal interaction settlement as clean ownership loss.
- [x] Tighten claim settlement typing and preserve primary settlement errors.
- [x] Cache runtime scopes and share transcript parsing across pending-input gates.
- [x] Replace regex ownership checks with fail-closed TypeScript AST checks.
- [x] Correct claim diagnostics and stale-instance error classification.
- [x] Make pending-input single flight atomic and token-owned before the first asynchronous read.
- [x] Prevent cleanup hydration and terminalize every canceled interaction message.
- [x] Stop terminal persistence from referencing messages removed by retry rollback.
- [x] Standardize recovery logging and remove duplicated lane/project-directory mutation paths.
- [x] Add focused admission, drain-race, cancellation, and rollback regression coverage.
- [x] Run pull-request review validation and inspect the complete follow-up diff.
- [x] Commit the reviewed pull-request follow-up without pushing.
- [x] Run focused and full validation, review the complete diff, and fix every finding.
- [x] Commit every reviewed stage without pushing.

## Harness Facade

- [x] Specify the owner map, port narrowing rules, single late binding, and zero-behavior-change
      invariants in this architecture record.
- [x] Extract identity, state resolution, session lifecycle, transcript mutation, and message
      projection owners; make `resolveStreamRequestId` a pure helper.
- [x] Bind the prompt assembler factory, tool result normalization, and permission review through
      named ports without wrapping domain functions in single-method classes.
- [x] Replace registry-shaped callbacks with `SessionScopeRegistry` and `SessionRuntimeScope`.
- [x] Replace remaining owner callbacks with concrete collaborators and compose the six Tape
      capabilities into one domain port.
- [x] Introduce the named pending-input wakeup binding and remove every other deferred wiring.
- [x] Delete `DeepChatAgentInstanceDelegate`, the registry hydrator, and `dispose()`; route manager
      backend send, cancel, snapshot, and close through the harness port.
- [x] Add the composition factory and the facade implementing the existing manager and session
      contracts.
- [x] Delete `deepChatRuntimeCoordinator.ts` and migrate app composition, ACP compatibility, session
      deletion, and transcript mutation wiring.
- [x] Pin state hydration, message refresh, status publication, and destroy ordering with tests that
      fail if their order changes.
- [x] Add focused owner suites for every extracted owner without reducing executed test count.
- [x] Keep the harness barrel package-private around the owner graph, its factory, and the wakeup
      binding, and guard the export surface plus deep imports.
- [x] Break the interaction/turn and facade/factory source cycles through neutral contract modules.
- [x] Record the build preflight resource refresh as the one exception to the zero-behavior-change
      constraint.
- [ ] Make the retained full-runtime suite compact by moving its owner-specific describe blocks into
      the owner suites. Deferred: the suite declares four module-scope `vi.mock` factories that
      cannot be shared across files without restructuring the mock wiring.
- [x] Replace root guard rules with harness boundary rules and a smaller facade size ceiling.
- [x] Regenerate the layered-runtime baseline and update affected architecture records.
- [x] Fence asynchronous Session settings updates to one runtime scope and add replacement-race
      coverage.
- [x] Close harness barrel export escapes and require explicit pending-input rollback ownership.
- [x] Run focused and full validation, review the complete diff, and disposition every finding.
- [x] Commit every reviewed stage without pushing.

## Typed Hook Notification Pipeline

- [x] Record the 16-test hook baseline and enumerate the contract, ordering, and cost defects.
- [x] Specify the event contract, runtime scope, delivery semantics, corrections, and non-goals.
- [x] Add the canonical `HookEvent` union with coverage and rejection guards.
- [x] Replace the untyped observer contract with `isObserved` plus a typed `notify`.
- [x] Make `HookService` own its configuration and derived subscription index with atomic refresh.
- [x] Project and truncate synchronously, then clone only the permission record.
- [x] Serialize delivery per session without coupling sessions or awaiting hook commands.
- [x] Turn `RuntimeHookSink` into a scope factory and unify the terminal projection.
- [x] Migrate the loop, turn, interaction, and ACP compatibility producers onto the scope.
- [x] Route hook configuration writes through the service and drop the unused message query port.
- [x] Add subscription, ordering, projection, terminal parity, and resilience coverage.
- [x] Run focused and full validation, review the complete diff, and disposition every finding.
- [x] Commit every reviewed stage without pushing.

## Future Pull Requests

- [ ] Design hook decision semantics separately if the product and security model are approved.
- [ ] Design same-run steering separately if the product semantics are approved.
