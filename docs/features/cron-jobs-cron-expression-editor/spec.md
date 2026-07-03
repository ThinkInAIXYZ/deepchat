# Cron Jobs Cron Expression Editor

## Goal

Make Cron Jobs schedule editing easier than typing raw cron expressions.

## Decision

Use `@vue-js-cron/core` as the cron editor base.

Rationale:

- It is renderless, so DeepChat can keep the existing shadcn-vue visual system.
- It targets Vue and supports Vue 3 through the current package line.
- It avoids importing another full UI framework such as Ant Design Vue, Element Plus, Vuetify,
  Quasar, PrimeVue, or Naive UI.
- It can keep `cronExpr` as the persisted value, matching the current phase 2 model.

## Requirements

- The editor writes only the existing `cronExpr` field.
- The raw cron input remains available for expressions the visual editor cannot represent.
- Existing preset controls can stay as shortcuts; they must still write cron expressions only.
- Preview and validation continue to use the main-process `cronJobs.previewSchedule` and
  `cronJobs.validateSchedule` routes.
- No scheduler, SQLite, or route-contract changes.

## UX Shape

```text
+---------------------------------------------------------+
| Schedule                                                |
| [Preset v] [Visual editor] [Raw cron]                  |
|                                                         |
| Every [day v] at [09:00]                               |
| Cron: 0 9 * * *                                        |
| Timezone: [Asia/Shanghai v]                            |
|                                                         |
| Next runs                                               |
| [2026-07-03 09:00] [2026-07-04 09:00] ...              |
+---------------------------------------------------------+
```

## Non-Goals

- Do not add a second cron parser.
- Do not persist schedule mode, editor tabs, or UI-only state.
- Do not add an external UI framework package.
- Do not implement this in the documentation-only slice.
