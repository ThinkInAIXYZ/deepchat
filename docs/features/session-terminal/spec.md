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
- Toggle the terminal with a configurable shortcut (default `CommandOrControl+\``).
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
  The renderer never supplies a path. A missing or non-directory path rejects with a typed error.
- **Shell**: POSIX uses the user's login shell (`getUserShell()`) with `-l`; Windows uses
  `powershell.exe -NoLogo`, falling back to `cmd.exe`.
- **Environment**: `process.env` merged with `getShellEnvironment()` PATH data, plus
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=DeepChat`. Electron-internal
  variables (`ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, …) are removed.
- **Output**: coalesced for ~8 ms before publishing; each event chunk is at most 64 KiB. A 256 KiB
  ring buffer per PTY supports replay on attach. No total output cap and no idle timeout.
- **Ownership**: a PTY is owned by the `webContents` that created it. Input, resize, kill, and
  restart from any other `webContents` are rejected. Output events go only to the owner.
- **Capacity**: at most 8 live PTYs across the app; creating a ninth rejects with a typed error.
- **Termination**: user kill, shell exit, session deletion (`SessionDeletion` runtime stage, which
  also covers discarded drafts), owner `webContents` destruction, and application shutdown. Kill
  sends the default signal, escalates to `SIGKILL` after 2 s on POSIX, and settles after a 4 s
  fallback.

### IPC contract

Routes (`terminal.routes.ts`), main chat window callers only:

| Route | Input | Output |
| --- | --- | --- |
| `terminal.attach` | `sessionId, cols, rows` | `terminalId, cwd, shell, replay, status, exitCode?` |
| `terminal.input` | `terminalId, data` (≤16 KiB) | `sent` |
| `terminal.resize` | `terminalId, cols, rows` | `resized` |
| `terminal.kill` | `terminalId` | `killed` |
| `terminal.restart` | `sessionId, cols, rows` | same as attach |

Events (`terminal.events.ts`): `terminal.output { terminalId, data }` and
`terminal.exit { terminalId, exitCode, signal? }`, delivered to the owner only.

`attach` creates the PTY when none exists for the session, otherwise returns the existing one with
its replay buffer. Callers outside chat windows (settings, plugin, CLI, remote) are rejected.

### Renderer

- `SidePanelTab` gains `'terminal'`; `sidepanelStore.openTerminal()` / `toggleTerminal()`.
- `TerminalPanel.vue` lazy-loads ghostty-web (`init()` on first use) and its `FitAddon`; input is
  batched for 8 ms and chunked to 16 KiB like `AcpAuthDialog`.
- Detaching (tab switch, panel close, session switch) disposes the view but not the PTY.
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
- cwd is derived from trusted session state, never from renderer input.
- Owner checks on every mutating route; events never broadcast.
- Not exposed to remote-control, IM, CLI, or agent callers.

## Validation

- Main tests with mocked `node-pty`: owner enforcement, cwd resolution, replay bound, termination
  on session deletion / renderer destruction / shutdown, capacity limit.
- Manual on macOS: CJK IME input, vim/htop/less, resize, large output (`pnpm install`, `cat` of a
  large file), copy/paste, packaged build WASM loading.
- format, i18n, lint, typecheck, relevant main/renderer suites.
