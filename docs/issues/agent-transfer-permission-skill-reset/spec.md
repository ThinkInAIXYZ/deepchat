# Agent Transfer Permission / Skill Reset

## Issue

Moving a session to another DeepChat agent updates `agent_id`, model, permission mode, and disabled
tools, but keeps conversation-scoped command/file/settings approvals, unfiltered active skill pins,
plan state, and runtime-activated skills from the previous host.

## Impact

A session transferred from a permissive agent to a strict agent can retain prior approvals and skill
pins that the target host policy would not grant.

## Root Cause

`setSessionAgentContext` rebinds identity and caches but does not clear session security state.

## Fix Plan

On agent rebind:

- clear session permission approvals
- clear agent plan state
- clear runtime-activated skills
- refilter persisted active skills to the target `enabledSkillNames`
- keep existing tool-profile / system-prompt invalidation

## Tasks

- [x] Implement reset in `setSessionAgentContext`
- [x] Extend skillPresenter port with `setActiveSkills` where needed
- [x] format / lint / focused tests

## Validation

- After transfer, permission caches for the session are empty.
- Active skills are a subset of the target agent's allow-list (or empty when none allowed).
