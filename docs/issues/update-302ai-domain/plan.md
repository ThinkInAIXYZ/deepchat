# Implementation Plan

## Approach

Use the smallest safe update: replace old public website links only, preserve every API endpoint and provider identity.

## File Changes

- Update README provider table links in:
  - `README.md`
  - `README.zh.md`
  - `README.jp.md`
- Update 302 website metadata in:
  - `src/main/presenter/configPresenter/providers.ts`

## Compatibility

Existing saved provider configs and request routing continue to use `https://api.302.ai/v1`. This change only affects outbound documentation/open-external links.

## Test Strategy

- Run a targeted search after editing:
  - `rg -n "https://302\\.ai|302ai\\.cn|api\\.302\\.ai|dash\\.302\\.ai" README* src/main/presenter resources/model-db`
- No unit test is required because the implementation is static metadata/link replacement.
- Run repository hygiene commands after implementation:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`

## Risk

`resources/model-db/providers.json` contains generated provider metadata with `doc: "https://doc.302.ai"`. Manual edits would fight the build-time provider DB refresh, so leave it unchanged unless the upstream source changes or the project decides to patch generated snapshots.
