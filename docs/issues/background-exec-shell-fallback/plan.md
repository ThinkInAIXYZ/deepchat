# Background Exec Shell Fallback Plan

## Approach

- Centralize fallback behavior in `getUserShell()` so foreground exec, background exec, and shell
  environment bootstrap share the same shell resolution.
- Check absolute shell candidates for path and executable availability before returning them.
- Search `PATH` plus DeepChat default paths when `SHELL` is a bare command name.
- Use conservative POSIX fallback chains and keep Windows behavior intact.
- Validate shell process working directories before calling `spawn`, because Node reports missing
  `cwd` as `spawn <shell> ENOENT`.

## Affected Paths

- `src/main/lib/agentRuntime/shellEnvHelper.ts`
- `src/main/lib/agentRuntime/backgroundExecSessionManager.ts`
- Existing shell environment and background exec tests.

## Compatibility

- Existing valid user shells are still preferred.
- Missing or non-executable shells now fall back to an available POSIX shell instead of failing
  with `ENOENT`/`EACCES`.
- Plain `sh` bootstrap no longer receives login-shell flags it may not support.
- Missing working directories now produce a direct working-directory error.
