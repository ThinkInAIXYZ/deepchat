# Skill Runtime Hardening

## Summary

Add runtime-aware skill extensions without changing external `SKILL.md` formats. DeepChat stores skill-only runtime settings in a sidecar directory and uses them to execute bundled scripts safely and predictably.

## User Stories

### US-1: Configure skill environment variables
- As a user, I can define env vars for a skill in Settings.
- Acceptance:
  - Env vars are stored outside the skill folder as plaintext sidecar metadata.
  - Editing a skill does not rewrite external `SKILL.md` frontmatter to persist env vars.

### US-2: Run skill scripts reliably
- As an agent, I can run scripts bundled in an active skill without guessing relative paths.
- Acceptance:
  - Only scripts under `<skillRoot>/scripts/` can be executed.
  - The runtime picks system `uv`/`node` first, then falls back to DeepChat bundled runtimes.
  - Python scripts run from the skill root and honor `pyproject.toml` via `uv run --project`.

### US-3: Prevent prompt pollution from binary file reads
- As an agent, reading an image or binary file through text-file APIs does not inject raw bytes into prompt context.
- Acceptance:
  - ACP `fs/read_text_file` rejects image/PDF/common binary files with remediation guidance.
  - Main agent `read` keeps image OCR fallback, but rejects unsupported binary formats instead of returning raw bytes.

### US-4: Guide the model toward stable skill execution
- As an agent, active skill instructions clearly include absolute paths, script inventory, and the preferred execution tool.
- Acceptance:
  - Active skill prompt includes `skillRoot`, recommended `base_directory`, runnable scripts, and explicit guardrails against inline `python -c` / `node -e`.

### US-5: Keep process output after process exit
- As an agent, command output is still available when a child process writes a large payload right before exiting.
- Acceptance:
  - Foreground exec waits for child `close`.
  - Background exec sessions are considered complete only after `close` and log flush.
  - Large foreground output is offloaded to a session log file instead of being silently truncated away.

## Non-Goals
- Secret encryption or OS keychain storage for skill env vars.
- Extending external skill formats with DeepChat-only frontmatter fields.
- General workflow orchestration across multiple skills.

## Constraints
- Keep existing skills compatible.
- Ignore `.deepchat-meta` in skill discovery and sync/export flows.
- Reuse the existing `process` tool for background session management.
