# Legacy Provider Runtime Retirement Tasks

- [x] Delete `src/main/presenter/llmProviderPresenter/aiSdk/runtimeMode.ts`
- [x] Remove `DEEPCHAT_LLM_RUNTIME` and `llmRuntimeMode`
- [x] Convert provider request paths to AI SDK-only implementations
- [x] Remove provider-specific MCP tool conversion interfaces from presenter ports
- [x] Replace legacy SDK type imports with local neutral types where still needed
- [x] Remove obsolete provider SDK dependencies from `package.json`
- [x] Rewrite provider tests around AI SDK runtime helpers and delegate routing
- [x] Archive legacy runtime history and document the last legacy-code commit
- [x] Run `pnpm install`
- [x] Run `pnpm run format`
- [x] Run `pnpm run i18n`
- [x] Run `pnpm run lint`
- [x] Run `pnpm run typecheck`
- [x] Run targeted provider tests for the migrated AI SDK-only paths
- [ ] Run `pnpm run test:main`
