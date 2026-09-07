# Test Suite Value Cleanup Plan

## Approach

1. Inventory the full test surface, configuration, CI entry points, focused/skipped
   tests, snapshots, assertion-free tests, duplicate titles, and weak assertions.
2. Classify candidates by the regression signal they provide rather than by syntax
   alone.
3. Preserve or add the strongest nearby behavioral assertion before removing
   redundant cases.
4. Keep the diff test-only and prefer deletion or local table-driven assertions over
   new helpers and abstractions.
5. Run focused suites, then the complete main and renderer suites, followed by
   repository quality checks.

## Cleanup Slices

### Vacuous tests

- Delete the unrecognized-format case that computes a result but makes no assertion.
- Delete adapter-filter loops whose assertions never use the iterated adapter.

### Type and existence checks

- Delete constructor-only and method-existence cases when public behavioral tests in
  the same suite already instantiate and exercise the subject.
- Delete checks that verify test cleanup or fixture isolation instead of product
  behavior.
- Keep compile-time `expectTypeOf` tests and runtime shape checks that protect actual
  protocol boundaries.

### Weak behavioral assertions

- Replace non-negative collection-length assertions with fixture-derived content.
- Strengthen error assertions when the public contract exposes a stable error.
- Remove empty catches that allow unexpected execution errors to be hidden.
- Replace fixed renderer sleeps with existing Vue Test Utils async settlement where
  no real clock behavior is under test.
- Use public lifecycle shutdown hooks for deterministic teardown instead of
  speculative fixture delays.

### Duplicate registry checks

- Replace repeated built-in adapter class/lookup boilerplate with one complete
  registry contract.
- Keep custom registration, replacement, unknown lookup, and detection-order tests
  because they cover distinct behavior.

## Validation

Run:

```text
pnpm exec vitest run --config vitest.config.ts <changed main tests>
pnpm exec vitest run --config vitest.config.renderer.ts <changed renderer tests>
pnpm run test:main
pnpm run test:renderer
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Packaged and live-provider end-to-end suites remain gated by their documented
environment requirements.

## Rollback

The change contains no production migration. Reverting the test and documentation
diff restores the previous suite.
