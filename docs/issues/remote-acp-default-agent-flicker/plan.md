# Plan

## Implementation Approach
- Treat `resolveAcpAgentAlias` strictly as an *equivalence-matching* helper. Never let an alias-flattened id leak out as a stored or returned `defaultAgentId`.
- Rewrite `sanitizeDefaultAgentId` so it locates the matching `enabledAgent` (using alias for equivalence) and returns that agent's **own** id — i.e. the id the renderer's `availableAgents` will contain.
- Promote `resolveAcpAgentAlias` and `ACP_LEGACY_AGENT_ID_ALIASES` to `src/shared/utils/acpAgentAlias.ts` so renderer code can reuse the exact same alias table that main relies on. `src/main/presenter/configPresenter/acpRegistryConstants.ts` re-exports them to keep all current `import` sites working.
- Patch `defaultAgentOptions` in `RemoteSettings.vue` to recognise an alias-equivalent agent and use its real id instead of unshifting a bare-id ghost option.

## Affected Interfaces
- `sanitizeDefaultAgentId(channel, candidate)` — internal to `RemoteControlPresenter`. Return type unchanged (`Promise<string>`); semantics tightened to "return one of the SQLite agent ids, or the channel default".
- New module `src/shared/utils/acpAgentAlias.ts` exporting `ACP_LEGACY_AGENT_ID_ALIASES` and `resolveAcpAgentAlias`.
- `src/main/presenter/configPresenter/acpRegistryConstants.ts` becomes a thin re-export for the alias pieces; the rest of its constants stay co-located.

## Data Flow
1. Renderer Select emits real SQLite agent id → `updateXxxDefaultAgentId(value)` writes it into `xxxSettings.value.defaultAgentId`.
2. `persistChannelSettings` calls `saveXxxSettings`. Main `sanitizeDefaultAgentId` matches via alias but returns the *real* enabledAgent id and writes that into `bindingStore`.
3. `getXxxSettings` returns the same real id. `syncXxxFields(saved)` overwrites the renderer state with the same id the user picked → no flicker.
4. For legacy bindings whose stored id is an alias-table key, `sanitizeDefaultAgentId` translates it into the real id during the next get/save, and the renderer's `defaultAgentOptions` resolves it via alias-equivalence so the Select stays bound to the canonical option instead of fabricating a ghost row.

## Compatibility
- All existing `acpRegistryConstants` import sites continue to compile via re-export.
- Existing alias-equivalent behavior preserved: a candidate that maps via the alias table to an enabled agent is still considered a match.
- No data migrations. Bindings carrying historical alias-key ids self-heal on first sanitize call.

## Test Strategy
- New main-side unit test: `sanitizeDefaultAgentId` returns the SQLite agent id for (a) exact-match candidate, (b) alias-key candidate against an alias-value agent, and (c) alias-value candidate against an alias-key agent. Falls back to channel default only when no alias-equivalent agent exists.
- New renderer-side unit test: `defaultAgentOptions` returned to the Select reconciles a legacy `currentAgentId` to the corresponding modern entry without inserting a ghost row.
- Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run format`, `pnpm run i18n` (no new strings — runs as a no-op confirmation per repo guideline).
