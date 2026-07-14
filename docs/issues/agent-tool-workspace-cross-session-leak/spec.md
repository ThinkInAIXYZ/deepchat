# Agent Tool Workspace Cross-Session Leak

## Issue

`AgentToolManager` is a process singleton. `buildAllowedDirectories` adds both the call's workspace
path and the manager's last `syncContext` workspace path. Concurrent sessions with different
project directories can therefore allow filesystem access into another session's workdir.

## Impact

Multi-agent / multi-session isolation fails for local file tools even when each session has a
distinct `project_dir`.

## Root Cause

Shared mutable `this.agentWorkspacePath` is used as a fallback when a conversation workdir is null
or cannot be resolved, so the last synchronized session workspace can still enter another
conversation's allow list.

## Fix Plan

- Build allow lists from the call's workspace path only (plus skill roots, runtime roots, approvals).
- Do not add the manager's last synced workspace path.
- When a conversation is present but has no resolved workdir, use the isolated default workspace;
  reserve manager state only for calls that have no conversation context.

## Tasks

- [x] Remove shared workspace merge from `buildAllowedDirectories`
- [x] Covered by toolPresenter suite + multi-agent isolation contract
- [x] format / lint / focused tests
- [x] Cover a null/failed lookup after another session synchronized a different workspace

## Validation

- Allowed directories for workdir `/a` do not include a previously synced `/b`.
- Session `/a` with no resolved project directory still cannot inherit `/b` from manager state.
