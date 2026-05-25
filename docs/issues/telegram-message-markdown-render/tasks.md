# Telegram Message Markdown Render Tasks

- [x] Capture the reproduction from issue #1665 and confirm `sendMessage`/`editMessageText` ship raw Markdown without `parse_mode`.
- [x] Draft SDD spec, plan, tasks documents.
- [ ] Implement `telegram/telegramMarkdown.ts` with `convertMarkdownToTelegramHtml`.
- [ ] Thread an optional `parseMode` through `TelegramClient.sendMessage`, `editMessageText`, and `sendPhoto`.
- [ ] Update `TelegramPoller` to apply the converter and pass `parse_mode: 'HTML'` on all generated text paths.
- [ ] Add focused tests for the converter and parse-mode wiring; keep existing telegram tests green.
- [ ] Run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck:node`, and the focused test suites.
