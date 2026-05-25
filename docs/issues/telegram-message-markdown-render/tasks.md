# Telegram Message Markdown Render Tasks

- [x] Capture the reproduction from issue #1665 and confirm `sendMessage`/`editMessageText` ship raw Markdown without `parse_mode`.
- [x] Draft SDD spec, plan, tasks documents.
- [x] Implement `telegram/telegramMarkdown.ts` with `convertMarkdownToTelegramHtml`.
- [x] Thread an optional `parseMode` through `TelegramClient.sendMessage`, `editMessageText`, and `sendPhoto`.
- [x] Update `TelegramPoller` to apply the converter and pass `parse_mode: 'HTML'` on all generated text paths.
- [x] Add focused tests for the converter, table fallback, parse-mode wiring, and plain-text retry.
- [ ] Run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck:node`, and the focused test suites.
