# Splash Window UX Refresh

## Overview
Current splash window behavior feels disconnected from app startup: it always creates a window (even for fast starts) and can appear as blank/oversized. This spec improves perceived performance and provides a compact, informative splash only when startup is slow.

## Goals
- Show splash only when startup takes longer than 1s.
- If a main window already exists within 1s, do not construct the splash window.
- Replace the large/blank splash with a compact centered indicator: DeepChat icon + status text (and optional progress bar).

## Non-Goals
- Reworking lifecycle phases/hook ordering.
- Adding new IPC channels beyond the existing `splash-update`.
- Full i18n for splash-only strings.

## User Stories
- As a user, I want fast startups to go directly to the main window without extra splash flicker.
- As a user, I want slow startups to show a small, clear indicator of what the app is doing.

## UX Notes
- Window shape: narrow centered bar.
- Content: app icon + status text; optionally show a small progress bar driven by lifecycle progress.
- Behavior: appears only after 1s delay; closes when startup completes.

## Acceptance Criteria
- [ ] If startup completes and at least one non-splash window exists within 1s, splash is never created.
- [ ] If no window exists after 1s and startup is still running, splash is created and shown.
- [ ] Splash displays DeepChat icon and a status text that updates as lifecycle progress updates arrive.
- [ ] Splash window is compact (narrow bar) and avoids white/blank flashes.

## Open Questions
- None.

## Security & Privacy Notes
- Keep `contextIsolation` + preload bridge usage consistent with other windows.
- Do not expose additional privileged APIs to the splash renderer beyond what `preload/index.mjs` already exposes.

## Compatibility & Migration
- No config/data migrations.

