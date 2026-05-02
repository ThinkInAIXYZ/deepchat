# Skill Runtime Hardening Plan

## Data Model
- Add `SkillExtensionConfig` with `version`, `env`, `runtimePolicy`, and `scriptOverrides`.
- Add `SkillScriptDescriptor` generated from `scripts/**/*.{py,js,mjs,cjs,sh}` and merged with sidecar overrides.
- Store sidecars in `<skillsDir>/.deepchat-meta/<skillName>.json`.

## Runtime Flow
- `SkillPresenter` owns sidecar read/write and script discovery.
- `SkillExecutionService` validates active skill access, resolves scripts, merges env, selects runtime, and executes scripts.
- `skill_run` becomes the preferred skill-local execution entrypoint.

## Read Guardrails
- Add shared binary-read helpers for ACP and main agent reads.
- ACP rejects non-text files through `fs/read_text_file`.
- Main agent keeps image OCR fallback, but rejects unsupported binary reads with guidance.

## Process Output Reliability
- Move foreground and background completion semantics from `exit` to `close`.
- Await output flush before returning completed process results.
- Offload large foreground output to session files when possible.

## UI
- Extend the skill editor with runtime policy, env rows, and discovered scripts.
- Show script/env/runtime summary badges on skill cards.

## Tests
- Presenter: sidecar lifecycle, script discovery, overwrite/uninstall behavior.
- Runtime: active skill enforcement, runtime fallback, script path validation.
- Agent tooling: prompt injection, `skill_run`, binary read rejection.
- ACP: `read_text_file` binary rejection.
- Process handling: `close`-based flush behavior.
