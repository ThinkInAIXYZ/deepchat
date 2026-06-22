# Plan

## Approach

- Keep the first pass in `AgentRuntimePresenter`.
- Add slow-step logging around pre-stream preparation so the next reproduction points to the exact
  await.
- If `system-prompt` is slow, add nested slow-step logging inside system prompt assembly.
- Treat missing `AGENTS.md` as normal by returning an empty instruction block without logging a full
  `Error` object. Keep lightweight warning metadata for real read failures.
- Add a small stale-while-revalidate cache around `AGENTS.md` reads. First reads get a short latency
  budget; late results populate the cache for the next prompt.
- Do not change tool availability, memory behavior, or provider streaming until the slow step is
  confirmed.

## Test Strategy

- Run format, i18n, lint, typechecks, and focused tests that cover `processMessage`.
