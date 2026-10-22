# Remove RTK integration

## Contract

DeepChat executes approved shell commands directly through the selected command shell. It does not
rewrite commands through RTK, discover RTK binaries, inject RTK paths or tracking variables, run RTK
health checks, or collect RTK savings. Shell environment merging, command permission checks,
programmatic execution grants, cancellation, background execution, and output offloading remain owned
by their existing services.

RTK has no settings switch, usage dashboard card, tool-call badge, retry route, startup task, shared
metadata contract, installation pin, or CI token requirement. Runtime packaging excludes stale RTK
files from an existing build directory. Node, uv, and cloudflared delivery remains supported.

The shell handler owns command execution; the usage service owns model usage; settings and message
components render only their remaining contracts. Persisted conversations remain readable when old
tool-call objects contain unknown RTK fields. Stored user history and preferences need no destructive
migration; obsolete RTK settings and its private history database are inert.

## Scope and acceptance

- Remove RTK implementation and its callers, contracts, presentation, translations, and fixtures.
- Keep model usage, shell execution, permission boundaries, and historical message rendering working.
- No installer or packaged application distributes RTK, including from a stale local runtime tree.
- Existing focused execution, route, persistence, settings, and packaging checks pass alongside
  formatting, translations, lint, and type checks.
- No replacement compression engine, dependency, database migration, or remote publishing is added.

## Settings layout

```text
BEFORE                         AFTER
Dashboard                      Dashboard
  Model usage                    Model usage
  RTK savings + status           Usage breakdown
  Usage breakdown
Tool call [RTK]                 Tool call
```

## Upstream reference

[RTK 1.0 release](https://github.com/rtk-ai/rtk/releases/tag/v1.0.0) changes the default binary's
license and provides a separate Apache-2.0 edition. DeepChat carries no RTK edition.
