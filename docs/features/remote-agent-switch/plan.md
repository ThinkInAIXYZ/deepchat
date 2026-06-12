# Implementation Plan — `/agent` Remote Command

## Touch points

### Shared types — `src/main/presenter/remoteControlPresenter/types.ts`
- `agent` entry added to `TELEGRAM_REMOTE_COMMANDS`, `FEISHU_REMOTE_COMMANDS`, `QQBOT_REMOTE_COMMANDS`, `DISCORD_REMOTE_COMMANDS`. Weixin iLink keeps its private `COMMANDS` array.
- New types: `TelegramAgentOption`, `TelegramAgentMenuState`, `TelegramAgentMenuCallback`.
- New constants/codecs: `TELEGRAM_AGENT_MENU_TTL_MS`, `buildAgentMenuChoiceCallbackData`, `buildAgentMenuCancelCallbackData`, `parseAgentMenuCallbackData`. Callback prefix `agent`, mirrors the existing `model` prefix model.

### Persistence — `src/main/presenter/remoteControlPresenter/services/remoteBindingStore.ts`
- New menu state: `createAgentMenuState`, `getAgentMenuState`, `clearAgentMenuState` plus `clearAgentMenuStatesForEndpoint` / `clearExpiredAgentMenuStates`. Cleared on rebind, on `clearTransientStateForEndpoint`, and on full `clearBindings()`.
- New helper: `setChannelDefaultAgentId(endpointKey, agentId)` — picks the right per-channel updater (`updateTelegramConfig` / `updateFeishuConfig` / `updateQQBotConfig` / `updateDiscordConfig` / `updateWeixinIlinkConfig`).

### Runner — `src/main/presenter/remoteControlPresenter/services/remoteConversationRunner.ts`
- `listAvailableAgents()` → `TelegramAgentOption[]`: `configPresenter.listAgents()` filtered by `enabled !== false`, projected to `{ agentId, agentName, agentType, source }`.
- `setChannelDefaultAgent(endpointKey, candidateId)` → `{ session, agent }`:
  1. Reject empty input with usage hint.
  2. Match against enabled agents by `id` first, then by `resolveAcpAgentAlias` equivalence.
  3. ACP-only guard: refuse when `getChannelDefaultWorkdir(endpointKey)` is empty (the existing private helper).
  4. `bindingStore.setChannelDefaultAgentId(endpointKey, agent.id)`.
  5. `createNewSession(endpointKey)` (already rebinds endpoint and uses `resolveDefaultAgentId`, which is the persisted channel default we just changed).

### Telegram router — `src/main/presenter/remoteControlPresenter/services/remoteCommandRouter.ts`
- `case 'agent'` mirrors `case 'model'` shape but uses `runner.listAvailableAgents()` and `bindingStore.createAgentMenuState`.
- `handleCallbackQuery` first tries `parseAgentMenuCallbackData`. On hit:
  - `cancel`: clears state, edits message to "Agent selection cancelled.".
  - `choice`: calls `runner.setChannelDefaultAgent`, edits message to confirmation including new session label and provider/model. On error (e.g. ACP workdir missing) returns `callbackAnswer.showAlert: true` with the runner's message.
- Helpers added: `buildAgentMenuKeyboard`, `formatAgentMenuText`, `formatAgentButtonLabel`, `formatAgentSwitchSuccessText`, `buildExpiredAgentMenuResult`.

### Text-channel routers
- `feishuCommandRouter.ts`, `qqbotCommandRouter.ts`, `discordCommandRouter.ts`, `weixinIlinkCommandRouter.ts`: each gets a `case 'agent'` that delegates to a new `handleAgentCommand` private method, plus a `formatAgentOverview` helper. The pattern is symmetric to `handleModelCommand` / `formatModelOverview`.

## Decisions

- **Switching = new session, not in-place agent change.** DeepChat sessions bind agentId at creation. Doing it any other way would require a new presenter API and break the existing default-agent invariants. The new-session reply communicates this clearly.
- **Per-channel default, not per-user.** Matches `/model` behaviour and the existing config schema.
- **ACP workdir guard is in the runner**, not the routers — single source of truth for both Telegram (button) and text channels (`/agent <id>`).
- **Callback prefix is a new namespace `agent:`** (not reused `model:`) so the existing model menu callback parsing keeps working unchanged.

## Test coverage

- `remoteBindingStore.test.ts`: agent menu state lifecycle; `setChannelDefaultAgentId` for each endpoint prefix.
- `remoteConversationRunner.test.ts`: enabled-only filter, alias-tolerant match, unknown agent rejection, ACP workdir guard, successful switch + new session.
- `remoteCommandRouter.test.ts` (Telegram): `/agent` menu render; callback success path; callback ACP-failure surfaces as alert; `/help` includes `/agent`.
- `feishuCommandRouter.test.ts`: text overview without args; `/agent <id>` happy path.
- (qqbot/discord/weixin tests intentionally light — same code path as Feishu, covered by the runner tests.)
