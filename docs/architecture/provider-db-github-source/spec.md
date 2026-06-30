# Provider DB GitHub Source - Spec

## Problem

Release builds can inject `VITE_PROVIDER_DB_URL` from `CDN_PROVIDER_DB_URL`, while local/test builds use the GitHub-hosted provider database. The CDN is being retired, so builds and runtime refreshes must stop depending on CDN injection.

## Goal

Use the GitHub provider database URL everywhere and remove provider DB URL override support from build workflows and runtime code.

## Acceptance Criteria

1. CI/release workflows no longer inject `CDN_PROVIDER_DB_URL` or `VITE_PROVIDER_DB_URL`.
2. Runtime provider DB refresh always uses the GitHub default URL.
3. Build-time provider DB fetch always uses the GitHub default URL.
4. Type declarations no longer expose `VITE_PROVIDER_DB_URL`.
5. The retired CDN hostname has no repository references.

## Non-Goals

- Do not remove unrelated `deepchatai.cn` official website, OAuth callback, or referer usage.
