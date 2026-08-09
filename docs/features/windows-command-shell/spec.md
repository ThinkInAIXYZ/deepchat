# Windows Agent Command Shell

## Status

Implemented; packaged Windows validation is pending.

## Problem

DeepChat currently selects the Windows command interpreter implicitly. `getUserShell()` normally
returns `powershell.exe -NoProfile -Command` when `PSModulePath` is present and otherwise returns
`cmd.exe /c`. The selected shell is not represented in the turn resources or system prompt, while
command generation, permission analysis, path handling, skills, and process execution make
independent platform-level assumptions.

This produces several semantic mismatches on Windows:

- models commonly generate POSIX command syntax without knowing the active interpreter;
- Windows PowerShell does not support pipeline-chain operators such as `&&` and `||`;
- permission parsing and risk rules do not model PowerShell quoting and destructive commands;
- shell skills use command-line quoting that may not match the actual interpreter;
- delayed approval can execute after settings or the application process have changed, without a
  durable record of the shell profile that the user reviewed.

The feature is therefore a command-interpreter contract, not a terminal-emulator selector. Agent
commands continue to run headlessly and render their captured output in DeepChat.

## Goal

Make Windows agent command execution semantically consistent from prompt generation through
permission approval and process spawning. Users can retain the existing interpreter selection or
explicitly select Git Bash, while every consumer in a turn derives behavior from one immutable
resolved command-shell specification.

## Terminology And Data Model

The device-local setting is an atomic object:

```ts
interface AgentCommandShellConfig {
  preference: 'auto' | 'windows-powershell' | 'git-bash'
  gitBashExecutableOverride?: string
}
```

Runtime behavior uses a closed set of profiles:

```ts
type CommandShellProfile = 'posix' | 'cmd' | 'windows-powershell' | 'git-bash'
type CommandShellDialect = 'posix' | 'cmd' | 'powershell'
type CommandShellPathStyle = 'native' | 'win32' | 'msys'

interface ResolvedCommandShell {
  readonly profile: CommandShellProfile
  readonly dialect: CommandShellDialect
  readonly pathStyle: CommandShellPathStyle
  readonly executable: string
  readonly args: readonly string[]
  readonly displayName: string
}
```

`profile` is the stable semantic identity. `dialect` and `pathStyle` are total functions of the
profile and are never persisted independently. `executable` is local runtime state and is never
persisted in permission payloads.

## Profile Semantics

| Profile | Dialect | Path style | Interpreter contract |
| --- | --- | --- | --- |
| `windows-powershell` | `powershell` | `win32` | `powershell.exe -NoProfile -Command` |
| `cmd` | `cmd` | `win32` | `cmd.exe /c` |
| `git-bash` | `posix` | `msys` | validated Git for Windows `bash.exe -c` |
| `posix` | `posix` | `native` | current resolved `$SHELL -c` behavior |

`auto` preserves the current Windows selection exactly: the existing `PSModulePath` proxy chooses
`powershell.exe`; otherwise it chooses `cmd.exe`. `PSModulePath` is mutable and does not prove a
particular PowerShell version, so DeepChat does not claim that it has verified version 5.1.
PowerShell 7 (`pwsh`) is not discovered by `auto`. A future `pwsh` profile must be explicit and must
not silently replace the compatibility baseline.

The `posix` profile wraps current macOS and Linux behavior. It deliberately does not tighten the
accepted `$SHELL` set or promise that the interpreter remains unchanged if the user changes their
login shell between generation and delayed execution.

## User Experience

The Windows common settings page exposes a command shell selector and an optional Git Bash
executable override. Non-Windows platforms do not show these controls.

Before:

```text
Agent command shell: implicit
```

After:

```text
Agent command shell  [Auto                 v]

Git Bash selected:
Agent command shell  [Git Bash             v]
Executable           [C:\Program Files\Git\bin\bash.exe] [Browse]
Status               Available
```

The choices are `Auto`, `Windows PowerShell`, and `Git Bash`. The UI calls
`powershell.exe` **Windows PowerShell**, not the ambiguous **PowerShell** and not an unverified
version number.

Selecting Git Bash validates the effective executable asynchronously. An explicit selection that
cannot be resolved or validated reports an actionable error and never falls back to another shell.
Automatic discovery is not persisted; only the optional user override is stored.

## Resolution And Prompt Contract

`prepareTurnResources` resolves the command shell once per turn. The resulting immutable spec is
passed to prompt assembly, the loop run, tool-call options, permission analysis, path handling,
skill execution, RPC, and process spawning. The utility process receives a required spec and makes
no preference or environment-based selection decision.

The system prompt always identifies the resolved interpreter and emits profile-specific capability
guidance:

- `windows-powershell`: Windows PowerShell syntax; `&&` and `||` are unavailable, so use `;` when
  unconditional sequential execution is intended;
- `cmd`: Command Prompt syntax with `&&` and `||` support;
- `git-bash`: POSIX shell syntax; command-shell paths may use MSYS form, while file tools use
  Windows-native paths;
- `posix`: the actual resolved shell name.

Prompt text is derived from the resolved spec. No caller may hard-code a platform-wide shell
capability statement.

## Git Bash Resolution

Git Bash resolution uses the following precedence:

1. the configured executable override;
2. known Git for Windows installation paths;
3. paths derived from `where git` results.

A candidate is available only after DeepChat successfully runs `bash --version` and confirms a
non-empty `$BASH_VERSION` with MSYS `$OSTYPE` semantics. Validation does not parse localized
`--version` prose. Each process probe has a bounded timeout and the complete candidate search shares
one monotonic deadline. File existence alone is insufficient, and WSL/Cygwin Bash must not satisfy
the `git-bash` profile. Discovery and probing occur only when Git Bash is explicitly selected or the
user requests an availability check; `auto` never probes Git Bash.
User-controlled overrides must resolve to a validated `bash.exe`; candidates are passed as
executable arguments and are never interpolated into a command string.

Successful validation may be cached in memory by canonical candidate path and effective
configuration. Failed discovery and validation may be cached for at most 30 seconds so repeated
turn preparation does not rerun the complete bounded search. Both caches are invalidated when the
setting changes or an explicit refresh is requested. They are never persisted, and execution
errors still surface if a previously validated binary is removed or replaced.

MSYS environment inheritance, `PATH`, locale, `SHELL`, non-login behavior, and window visibility
remain explicit Windows manual-validation items. DeepChat may prepend Git's `usr/bin` directory if
testing shows inherited environment is insufficient.

## Permission And Deferred Execution Contract

Command authorization is namespaced by the shell profile:

```ts
authorizationSignature = `${profile}:${existingSignature}`
```

For shell authorization identity, pending command-permission payloads add only these fields to the
existing command and permission context:

```ts
{
  shellProfile: CommandShellProfile
  commandSignature: string
}
```

The signature is already namespaced. Deferred execution resolves the stored profile again on the
local machine and executes with that profile. A settings change does not reinterpret an already
reviewed command. If the recorded profile is no longer available, execution returns an error so the
model can regenerate the command.

There is no executable fingerprint, policy version, or current-setting comparison. The permission
payload does not duplicate dialect because dialect is derived from profile.

Legacy or malformed pending command approvals without both `shellProfile` and a namespaced
`commandSignature` fail closed. Approval and composition code must not reconstruct a signature from
the command or the current platform. Existing payload fields required to display and dispatch the
tool call remain unchanged. A one-shot approval granted before deferred dispatch must be revoked
precisely if dispatch fails before the command consumes it; unrelated approvals remain untouched.
Each in-memory one-shot grant receives an ephemeral lease ID so concurrent grants for the same
session and signature can be consumed or revoked independently. The lease is scoped to the approved
tool invocation and is never persisted in the pending interaction.

Local file-tool permissions also carry `shellProfile` when deferred execution must preserve the
path interpretation used during precheck. `commandSignature` remains specific to command
authorization.

Permission parsing uses the resolved dialect rather than `process.platform`. PowerShell handling
must recognize its single-quote and backtick semantics, command substitution, and destructive
operations such as recursive forced removal. CMD and syntax that cannot be analyzed safely use a
conservative approval policy.

## Path And Skill Contract

For the `git-bash` profile, DeepChat accepts the one-way MSYS drive form `/c/...` (case-insensitive
drive letter) and converts it to a canonical Windows-native path before filesystem permission and
allowed-directory checks. Traversal is resolved before containment checks. It does not add a
general POSIX path translation layer and does not accept ambiguous MSYS forms outside the supported
drive mapping.

The Windows shell skill runtime is enabled only for `git-bash`. Direct foreground and background
executable/script execution passes an executable and argv without shell serialization. Only an RTK
rewrite or another genuine shell plan is interpreted by the resolved shell. Shell quoting is
derived from the resolved dialect.

The bundled POSIX `deepchat` launcher recognizes the Windows `node.exe` runtime layout so Agent CLI
commands remain available when Git Bash resolves the launcher from `PATH`.

## Persistence And Backup

`agentCommandShell` is device-local application state. Backup export removes the setting, and
backup import preserves the receiving device's current value. The setting is not cloud-synced and
does not overwrite another device's executable override.

## Acceptance Criteria

- Existing users retain current Windows behavior under the default `auto` preference.
- A user can explicitly select Windows PowerShell or a validated Git Bash installation.
- Explicit Git Bash failure is visible and never falls back to Windows PowerShell or CMD.
- PowerShell 7 is never selected implicitly.
- One resolved spec supplies the prompt, permission, path, skill, RPC, and spawn paths for a turn.
- The utility process cannot select a different shell from the caller.
- System prompts accurately describe each resolved profile's syntax capabilities.
- Command permission signatures are isolated by profile.
- Delayed approval after a setting change runs through the profile used when the command was
  generated.
- Missing legacy permission metadata fails closed.
- A pre-dispatch failure revokes only the corresponding one-shot authorization.
- Git Bash `/c/...` paths are converted before filesystem authorization checks.
- Windows shell skills run only when Git Bash is the resolved profile.
- The bundled DeepChat CLI launcher resolves the packaged Windows runtime under Git Bash.
- Both Windows spawn paths use `windowsHide: true`.
- macOS and Linux preserve current shell resolution and execution behavior.
- Device-local command-shell settings are excluded from backup and preserved on import.

## Constraints

- Keep native capability behind typed main/preload/renderer boundaries.
- Treat renderer-provided paths and persisted settings as untrusted input.
- Do not persist auto-discovered executable paths.
- Do not use terminal applications, PTYs, or visible console windows for agent commands.
- Keep profile-to-dialect and profile-to-path-style mappings exhaustive and centrally owned.
- Preserve the existing command signature algorithm inside its profile namespace.

## Non-Goals

- Selecting Windows Terminal, `conhost`, `mintty`, or another terminal emulator.
- Automatically preferring PowerShell 7.
- Supporting WSL as another shell profile. WSL requires a separate execution-backend architecture
  design.
- Changing non-Windows shell selection or restricting `$SHELL` to POSIX-conforming interpreters.
- General MSYS, Cygwin, or WSL path emulation.
- Redesigning the command permission UI.

## Manual Validation

Windows validation must cover:

- Auto on hosts with and without `PSModulePath`;
- standard and nonstandard Git for Windows installations;
- invalid, missing, and later-uninstalled Git Bash overrides;
- spaces and non-ASCII characters in executable and working-directory paths;
- Git Bash environment, locale, standard tools, and non-login startup behavior;
- bundled `deepchat` CLI invocation from Git Bash;
- no console-window flash in managed and detached execution;
- pausing for permission, changing the preference, then approving;
- restarting while a permission interaction is pending;
- `/c/...` path access inside and outside allowed directories;
- PowerShell and Git Bash commands with quoting, control syntax, and destructive-operation prompts.
