# 302ai Domain Update

## User Need

302 provider links should point users to the new public domain `https://302ai.cn/`.

## Goal

Update user-facing 302 provider website links from `https://302.ai` to `https://302ai.cn` where the link represents the provider home page or pricing page.

## Acceptance Criteria

- `README.md`, `README.zh.md`, and `README.jp.md` provider link hrefs point to `https://302ai.cn/`.
- `src/main/presenter/configPresenter/providers.ts` updates only website metadata that currently uses the old public site:
  - `websites.official`: `https://302ai.cn/`
  - `websites.models`: `https://302ai.cn/pricing/`
- Model request URLs remain unchanged:
  - `baseUrl`: `https://api.302.ai/v1`
  - `websites.defaultBaseUrl`: `https://api.302.ai/v1`
  - 302 balance check: `https://api.302.ai/dashboard/balance`
- Other 302-related addresses remain unchanged unless separately confirmed:
  - API key dashboard: `https://dash.302.ai/apis/list`
  - API docs: `https://302ai.apifox.cn/doc-3704971`
- Generated model database snapshot is not manually edited in this change.

## Constraints

- Keep the provider id `302ai`.
- Keep API compatibility for existing user configuration.
- Do not change model request behavior.
- Keep the visible provider name `302.AI` unless a separate product naming change is requested.

## Non-Goals

- No provider implementation refactor.
- No model list or model database refresh.
- No migration of saved user settings.
- No UI/UX layout changes.

## Located References

Planned updates:

- `README.md:277`
- `README.zh.md:275`
- `README.jp.md:275`
- `src/main/presenter/configPresenter/providers.ts:348`
- `src/main/presenter/configPresenter/providers.ts:351`

Found but intentionally not updated:

- `src/main/presenter/configPresenter/providers.ts:345`
- `src/main/presenter/configPresenter/providers.ts:349`
- `src/main/presenter/configPresenter/providers.ts:352`
- `src/main/presenter/llmProviderPresenter/providers/aiSdkProvider.ts:2155`
- `resources/model-db/providers.json:30161`
- `resources/model-db/providers.json:30162`
- `resources/model-db/providers.json:30163`
- `resources/model-db/providers.json:30164`
