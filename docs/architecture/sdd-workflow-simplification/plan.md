# Plan

## Approach

Update the policy documents and project skills directly. Keep the workflow text short and make the
single-file bug path explicit enough that agents do not invent another issue format.

## Affected Files

- `docs/spec-driven-dev.md`
- `docs/README.md`
- `AGENTS.md`
- `.agents/skills/deepchat-sdd/SKILL.md`
- `.agents/skills/deepchat-sdd/agents/openai.yaml`
- `.agents/skills/deepchat-sdd-cleanup/SKILL.md`
- `.agents/skills/deepchat-sdd-cleanup/agents/openai.yaml`

## Compatibility

Existing feature, issue, and architecture folders stay valid. The new rule affects future work and
manual cleanup decisions only.

## Validation

- Run the skill validator for `deepchat-sdd-cleanup`.
- Check for stale references that still claim every issue requires `plan.md` and `tasks.md`.
- Run repository formatting/lint commands if the documentation-only change affects their inputs.
