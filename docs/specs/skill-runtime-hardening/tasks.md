# Skill Runtime Hardening Tasks

1. Add shared types for skill runtime config and script descriptors.
2. Extend `SkillPresenter` with sidecar persistence and script discovery.
3. Add `SkillExecutionService` and wire `skill_run` into agent tools.
4. Harden binary read behavior in ACP and main agent reads.
5. Switch exec completion logic from `exit` to `close` and await output flush.
6. Extend skills settings UI to edit runtime config and show summaries.
7. Add or update tests for presenter, ACP, agent tooling, and process output behavior.
