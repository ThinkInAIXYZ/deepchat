# Settings Control Center

## Goal

Refactor the settings window from a flat configuration list into a system control center.

## Requirements

- Add a default Settings Overview route that merges the old usage Dashboard.
- Refactor every settings tab into the new grouped settings layout.
- Keep Health Check out of this iteration.
- Use existing shadcn-vue components and semantic tokens.
- Support light/dark themes, RTL, i18n, minimum window width, and responsive content.
- Add a durable settings activity table that keeps the newest 2000 records and shows at most 200.
- Preserve existing settings behavior, deeplinks, and e2e navigation.

## UX

```text
┌──────────────────────────────────────────────────────────────┐
│ Settings                                                     │
├───────────────┬──────────────────────────────────────────────┤
│ Overview      │ Settings Overview                            │
│ Setup         │ Search settings, providers, MCP...           │
│  General      │                                              │
│  Display      │ Providers | MCP | Knowledge | Data           │
│  Environment  │                                              │
│  Shortcuts    │ Quick Tasks        Needs Attention           │
│ Models        │ Recent Changes     Usage Dashboard           │
│  Providers    │                                              │
│ Tools         │                                              │
│  MCP          │                                              │
│  Agents       │                                              │
│ Knowledge     │                                              │
│ System        │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

## Acceptance

- `/overview` is the default settings route.
- `/dashboard` still works but is no longer shown in the sidebar.
- Overview shows system status, quick tasks, recent activity, and usage dashboard.
- Provider, MCP, and Data pages use the new control-center interaction model.
- Other tabs use the grouped shell and remain functional.
- `settings_activity` never stores secret values.
- Automated tests, linting, typecheck, i18n checks, e2e, and screenshots pass before completion.
