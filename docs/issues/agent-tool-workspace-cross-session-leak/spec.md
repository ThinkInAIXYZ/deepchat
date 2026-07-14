# Agent Tool Workspace Cross-Session Leak

## Issue

`AgentToolManager` is a process singleton. `buildAllowedDirectories` adds both the call's workspace
path and the manager's last `syncContext` workspace path. Concurrent sessions with different
project directories can therefore allow filesystem access into another session's workdir.

## Impact

Multi-agent / multi-session isolation fails for local file tools even when each session has a
distinct `project_dir`.

## Root Cause

Shared mutable `this.agentWorkspacePath` is merged into every call's allow list.

## Fix Plan

- Build allow lists from the call's workspace path only (plus skill roots, runtime roots, approvals).
- Do not add the manager's last synced workspace path.

## Tasks

- [x] Remove shared workspace merge from `buildAllowedDirectories`
- [x] Covered by toolPresenter suite + multi-agent isolation contract
- [x] format / lint / focused tests

## Validation

- Allowed directories for workdir `/a` do not include a previously synced `/b`.
