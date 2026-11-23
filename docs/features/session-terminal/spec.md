# Session Terminal Specification

> Status: implemented. Tracks [#2470](https://github.com/ThinkInAIXYZ/deepchat/issues/2470).

## Context

After an agent edits code, users want to run tests, inspect `git diff`, install dependencies, or
repeat a command themselves. Today they either ask the agent (one model round, output enters the
context) or leave DeepChat through "Open in Terminal". The right side panel already hosts
workspace, browser, MCP app, and tape inspector tabs; `node-pty` is a production dependency.

## Goals

- Add a **Terminal** tab to the chat side panel that runs the user's interactive shell in the
  session's working directory.
- Render with [`ghostty-web`](https://github.com/coder/ghostty-web) (Ghostty's VT core compiled to
  WASM, xterm.js-compatible API) for accurate escape-sequence and grapheme handling.
- Keep the shell alive while the user switches tabs, closes the panel, or switches sessions, and
  replay recent output when the panel reattaches.
- Toggle the terminal with a configurable shortcut (default `Control+\`` on every platform;
  macOS reserves `Command+\`` for cycling windows).
- Keep terminal I/O out of the agent: it never enters model context, tape, or transcripts.

## Non-Goals

- Multiple terminals per session, split panes, or tabs inside the terminal panel.
- Remote control, IM channels, CLI, or agent tools driving this terminal.
- Sending terminal selections to the conversation (possible follow-up).
- Replacing xterm in `AcpAuthDialog`.
- Persisting terminals across application restarts.

## User Experience

```
┌ Workspace │ Browser │ Terminal ─────────────────── ✕ ┐
│ ~/proj (main) $ pnpm test                            │
│ ...                                                  │
├──────────────────────────────────────────────────────┤
│ zsh · ~/proj                         [Restart] [Kill]│
└──────────────────────────────────────────────────────┘
```

- The tab is available whenever the panel has a session id (chat or new-thread draft).
- Without a working directory the panel shows an empty state asking the user to choose one; it does
  not fall back to the home directory.
- When the shell exits, the panel shows the exit code and a restart action.
- When the session's working directory changes, the running shell is left untouched and the footer
  offers "restart in new directory".
- The shortcut opens the panel on the Terminal tab and focuses it; pressing it while the terminal
  tab is visible closes the panel.
- With OS accessibility support enabled, the panel uses `@xterm/xterm` with `screenReaderMode`
  instead of ghostty-web, because ghostty-web renders to canvas and exposes no accessible buffer.

## Architecture

### Main process: `src/main/terminal/`

`SessionTerminalService` owns at most **one PTY per session id**.

- **Working directory**: resolved in the main process from the session record's `projectDir`.
  One exception: an unsent draft's record is not updated until its first message, so for a draft
  that is owned by the calling `webContents` the main process accepts the renderer's
  `draftWorkdir` (absolute paths only). The working directory is revalidated after the shell
  environment resolves. A missing or non-directory path rejects with a typed error.
- **Shell**: POSIX uses the user's login shell (`getUserShell()`) with `-l`; Windows uses
  `powershell.exe -NoLogo`, falling back to `cmd.exe`.
- **Environment**: `process.env` merged with `getShellEnvironment()` PATH data, plus
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=DeepChat`. Electron-internal
  variables (`ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, …) are removed.
- **Output**: coalesced for ~8 ms before publishing; each event chunk is at most 64 KiB and never
  splits a UTF-16 surrogate pair. A 256 KiB chunked tail per PTY supports replay on attach; a
  trimmed replay starts at a line boundary after an SGR reset. No total output cap and no idle
  timeout.
- **Access**: `attach` and `restart` require the caller to be a chat-type app window that is
  showing the session (`DesktopSessionBinding`) or owns it as a draft, matching the browser
  routes. A PTY is then owned by that `webContents`; input, resize, kill, and restart from any
  other `webContents` are rejected and output events go only to the owner. A second window
  showing the same session gets a typed `forbidden` error rather than a shared PTY.
- **Capacity**: at most 8 PTYs across the app, counting in-flight creates and shells that are
  still terminating. Concurrent attaches for one session share a single in-flight create. Exited
  terminals keep their replay until restart; beyond 8 the oldest are evicted.
- **Cancellation**: session deletion and shutdown cancel an in-flight create, so a shell is never
  spawned after its session is gone.
- **Termination**: user kill, shell exit, session deletion (`destroySessionTerminal` stage of
  `SessionDeletion`, which also covers discarded drafts), owner `webContents` destruction, and
  application shutdown. Kill sends the default signal, escalates to `SIGKILL` after 2 s on POSIX,
  and settles after a 4 s fallback. On Windows there is no escalation; `node-pty` closes the
  ConPTY, and the fallback only stops waiting.

### IPC contract

Routes (`terminal.routes.ts`), main chat window callers only:

| Route | Input | Output |
| --- | --- | --- |
| `terminal.attach` | `sessionId, cols, rows, draftWorkdir?` | `terminalId, cwd, shell, replay, outputEnd, status, exitCode?` |
| `terminal.input` | `terminalId, data` (≤16 KiB) | `sent` |
| `terminal.resize` | `terminalId, cols, rows` | `resized` |
| `terminal.kill` | `terminalId` | `killed` |
| `terminal.restart` | `sessionId, cols, rows, draftWorkdir?` | same as attach |

Events (`terminal.events.ts`): `terminal.output { terminalId, offset, data }` and
`terminal.exit { terminalId, exitCode, signal? }`, delivered to the owner only. `offset` is the
character position of `data` in the terminal's output stream; `outputEnd` is the position just
past `replay`.

`attach` creates the PTY when none exists for the session, otherwise returns the existing one with
its replay buffer. Callers outside chat windows (settings, plugin, CLI, remote) are rejected.

### Renderer

- `SidePanelTab` gains `'terminal'`; `sidepanelStore.openTerminal()` / `toggleTerminal()`.
- `TerminalPanel.vue` lazy-loads ghostty-web (`init()` on first use) and its `FitAddon`; input is
  batched for 8 ms and chunked to 16 KiB like `AcpAuthDialog`.
- The panel only creates or attaches a terminal while the side panel is open on the Terminal tab.
  Closing the panel, switching tabs, or switching sessions disposes the view but not the PTY.
- Output that arrives while an attach is in flight is buffered and replayed through the same
  offset check once the snapshot is applied, so nothing between snapshot and render is lost.
- Fitting is skipped while the host has no size, so the closing animation never resizes a live
  shell. xterm uses `@xterm/addon-fit`.
- The renderer choice waits for the native accessibility status before the first view is created.
- The toggle shortcut is stopped in the capture phase before either backend sees it, without
  cancelling the event, so the menu accelerator fires and the shell never receives it.
- Theme follows the app's light/dark mode. ghostty-web cannot change themes after `open()`, so a
  theme or accessibility change rebuilds the view and replays the buffer.
- Output carries a stream offset so events racing the attach replay are de-duplicated.
- ghostty-web 0.4 throws on zero-length writes; the panel never writes empty strings.
- The WASM blob is inlined into the lazily loaded ghostty-web chunk as a data URL, so packaged
  builds need no extra asset path.

### Shortcut

`ToggleTerminal` joins `defaultShortcutKey`, the View menu, `ShortcutSettings`, and the
`appRuntime.shortcutRequested` action enum, following `ToggleWorkspace`.

## Security

- Native capability stays behind typed routes; the renderer gets no PTY handle or spawn options.
- cwd is derived from trusted session state. The only renderer-supplied path is `draftWorkdir`,
  honored solely for an unsent draft owned by the caller, absolute, and checked to be a directory.
- `attach`/`restart` require a chat window showing the session; owner checks on every mutating
  route; events never broadcast.
- Not exposed to remote-control, IM, CLI, or agent callers.

## Validation

- Main tests with mocked `node-pty`: owner and session-view enforcement, cwd resolution, replay
  bound and boundary, surrogate-safe chunks, cancellation during bootstrap, capacity (concurrent and
  terminating), exited eviction, termination on deletion / renderer destruction / shutdown.
- Renderer tests: key handling in both backends, early output, hidden-panel attach, missing-workdir
  recovery, accessibility readiness.
- Manual on macOS: CJK IME input, vim/htop/less, resize, large output (`pnpm install`, `cat` of a
  large file), copy/paste, packaged build WASM loading.
- format, i18n, lint, typecheck, relevant main/renderer suites.
