# Sidebar Session Context Menu

## Overview

Add a session context menu to the left sidebar list so users can right-click any session item and access the same core session actions already available from the chat top bar.

## User Story

As a user browsing the left session list, I want to right-click a session and manage it in place, so I do not need to open the session first just to pin, rename, clear, or delete it.

## Acceptance Criteria

1. Right-clicking a pinned or unpinned session item in `WindowSideBar` opens a context menu.
2. The context menu includes:
   - `Pin` or `Unpin` depending on current state
   - `Rename`
   - `Clear Messages`
   - `Delete`
3. Left-clicking a session item still activates that session exactly as before.
4. Selecting `Rename`, `Clear Messages`, or `Delete` opens the existing confirmation/input dialog flow from the sidebar.
5. Selecting `Pin` or `Unpin` updates the session pinned state through the existing session store action.
6. Pinned sessions remain rendered in the pinned section, and unpinned sessions remain rendered in grouped sections after actions complete.
7. All user-facing labels continue to come from existing i18n keys; no hard-coded menu text is introduced.

## Non-Goals

- Replacing the existing top bar session action menu
- Adding new session actions beyond the current top bar set
- Changing session grouping, sorting, or persistence behavior
