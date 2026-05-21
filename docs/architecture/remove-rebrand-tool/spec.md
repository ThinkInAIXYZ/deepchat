# Remove Rebrand Tool

## Goal

Remove the deprecated repository-local rebrand tooling so the project no longer carries an
unmaintained brand replacement path.

## Acceptance Criteria

- `scripts/rebrand.js` is removed.
- `brand-config.template.json` and `brand-config.example-banana.json` are removed.
- `scripts/brand-assets/` no longer has a tracked placeholder file.
- No code, build, package script, or documentation outside this SDD record references the removed
  rebrand assets.
- Runtime app behavior, branding, build configuration, IPC, config storage, and i18n output remain
  unchanged.

## Non-Goals

- Do not replace the rebrand tool with a new white-labeling mechanism.
- Do not alter current DeepChat product metadata, icons, logos, updater settings, or application
  resources.
- Do not add migrations or compatibility shims for direct `node scripts/rebrand.js` use.

## Open Questions

None.
