# Splash Experience

## User Need

Startup should present a recognizable DeepChat loading composition while preserving clear visual differentiation between automatic system unlock and manual database unlock.

## Goals

- Replace textual loading progress with an animated logo-based splash.
- Render loading and system credential unlock inside circular DOM compositions.
- Keep manual password unlock square and functional.
- Preserve existing database unlock IPC behavior.

## Acceptance Criteria

- The loading state uses the DeepChat logo, layered light effects, and reduced-motion support.
- The loading and system-unlock background circles are created by renderer DOM/CSS, not BrowserWindow shape configuration.
- Manual unlock uses a rectangular DOM background and keeps its password controls available.
- Real unlock request and progress events still transition states and submit/cancel requests.

## Constraints

- No BrowserWindow sizing, transparency, shape, shadow, or background changes.
- Use trusted local raw SVG assets only.
- Do not expose secrets or alter unlock authorization behavior.

## Non-Goals

- Development splash-preview controls.
- Changing splash lifecycle timing or database unlock architecture.
