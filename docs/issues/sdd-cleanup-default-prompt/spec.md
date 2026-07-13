# SDD Cleanup Default Prompt

## Issue

The `deepchat-sdd-cleanup` default prompt sounded like a routine post-implementation action instead
of a manual-only cleanup workflow.

## Impact

Agents could treat SDD cleanup as an automatic final step and prune docs without an explicit
developer request.

## Root Cause

The YAML `default_prompt` described cleaning completed SDD folders after implementation and
validation, while the cleanup skill itself requires an explicit cleanup request.

## Fix Plan

- Tighten the default prompt so the manual-only gate is explicit.
- Keep the cleanup skill implementation and behavior unchanged.

## Tasks

- [x] Update the cleanup skill default prompt.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`

## Linked GitHub Issue

None. Handled from PR #1875 review feedback.
