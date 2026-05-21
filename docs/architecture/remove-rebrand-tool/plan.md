# Remove Rebrand Tool Plan

## Approach

- Keep this SDD folder as the decision record for removing the deprecated tooling.
- Delete the orphaned rebrand script, brand config template, example brand config, and brand asset
  placeholder.
- Leave `package.json`, Electron builder configuration, runtime resources, and application metadata
  untouched because no package script currently exposes the rebrand path.

## Compatibility

- The only removed interface is direct ad hoc execution of `node scripts/rebrand.js`.
- No stored user data, app configuration, IPC contract, or build artifact schema changes.

## Validation

- Verify no references remain outside this SDD record with a repository search for `rebrand`,
  `brand-assets`, and `brand-config`.
- Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
