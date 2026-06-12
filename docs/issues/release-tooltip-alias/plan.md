# Release Tooltip Alias Build Failure Plan

## Approach

Add an explicit TypeScript module entry for `@shadcn/components/ui/tooltip` that re-exports the
existing directory index. This keeps the public import path stable while avoiding resolver ambiguity
in release CI.

## Validation

- Run `pnpm run format`
- Run `pnpm run i18n`
- Run `pnpm run lint`
- Run `pnpm run typecheck`
- Run `pnpm run build`
