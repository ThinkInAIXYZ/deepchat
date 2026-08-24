# OpenAI Codex Image Generation

Status: implemented.

## Context

DeepChat already treats `openai-codex` as a dedicated runtime that uses ChatGPT OAuth credentials
against `https://chatgpt.com/backend-api/codex`. Its curated model catalog currently exposes only
text-output Codex models, and its AI SDK context only creates a Responses language model.

OpenAI documents that Codex built-in image generation uses `gpt-image-2` and counts against general
Codex usage limits. The model supports text input and image output through
`/images/generations`. The Codex client implementation sends that image request through the active
model provider and auth context, so ChatGPT OAuth uses the same Codex backend base URL with the
image endpoint appended.

References:

- <https://learn.chatgpt.com/docs/image-generation>
- <https://developers.openai.com/api/docs/models/gpt-image-2>
- <https://github.com/openai/codex/blob/rust-v0.142.3/codex-rs/ext/image-generation/src/tool.rs>
- <https://github.com/openai/codex/blob/rust-v0.142.3/codex-rs/ext/image-generation/src/backend.rs>

## Goals

- Expose `gpt-image-2` in the curated OpenAI Codex model list when its OpenAI provider-db record is
  available.
- Route generation through `POST /images/generations` with the existing OpenAI Codex OAuth token
  and account header.
- Reuse DeepChat's existing image-generation conversation flow, image cache, model type detection,
  and OpenAI image settings.
- Preserve the current text-model connection check so enabling or refreshing the provider does not
  consume image-generation quota.

## Non-goals

- Add a second OpenAI or Codex provider.
- Store OAuth credentials in provider API-key fields or expose them to the renderer.
- Add image editing or reference-image input to DeepChat's standalone image-generation flow.
- Reproduce the Codex `imagegen` skill, prompt rewriting, or artifact filesystem conventions.
- Add settings that `gpt-image-2` does not support, including transparent backgrounds.

## Design

### Provider catalog

`openai-codex` continues to use the OpenAI provider database as its capability identity and model
metadata source. `gpt-image-2` joins the explicit curated model ID list. If provider-db does not
contain that ID, it is omitted in the same way as every other curated Codex model.

The provider-db record owns the `imageGeneration` type and text/image modalities. Renderer code
does not add a Codex-specific type rule.

### Runtime transport

The existing `openai-codex` AI SDK factory branch creates both:

- a Responses language model for `/responses`; and
- an image model for `/images/generations`.

Both models use the same Codex-specific fetch adapter. The adapter refreshes OAuth once after a
`401`, preserves abort signals, includes `ChatGPT-Account-ID` when present, and normalizes provider
errors without exposing credentials.

Request handling is endpoint-aware:

- `/responses` keeps `store: false`, removes unsupported `max_output_tokens`, and defaults
  `Accept` to `text/event-stream`;
- image endpoints keep the AI SDK image body unchanged and default `Accept` to
  `application/json`.

This separation prevents Responses-only compatibility fields from reaching the image API.

### Data flow

```text
user selects GPT Image 2
          |
          v
existing image-generation chat route
          |
          v
AI SDK OpenAI image model
          |
          v
Codex OAuth fetch adapter -- refresh on 401 --> encrypted credential store
          |
          v
POST /backend-api/codex/images/generations
          |
          v
base64 image -> existing DeepChat image cache and message preview
```

### User-visible layout

```text
BEFORE                              AFTER
OpenAI Codex                        OpenAI Codex
  GPT-5.6 Luna       [chat]           GPT-5.6 Luna       [chat]
  GPT-5.6 Sol        [chat]           GPT-5.6 Sol        [chat]
  ...                                   ...
                                      GPT Image 2        [imageGeneration]
```

Selecting `GPT Image 2` uses the existing image settings panel and image result rendering; no new
screen, control, or copy is introduced.

## Ownership and security

- Provider ID: `openai-codex`.
- Runtime/API type: dedicated `openai-codex` transport over OpenAI-compatible image JSON.
- Default base URL: `https://chatgpt.com/backend-api/codex`.
- Auth: ChatGPT OAuth; tokens remain in the existing OpenAI Codex credential store in the main
  process.
- Model metadata: built-in provider-db, source provider `openai`.
- Connection check: `generate-text` with `gpt-5.6-luna` and prompt `Hello`.
- Image generation model: `gpt-image-2`.

The renderer receives only model metadata and auth status. Raw access tokens, refresh tokens, and
account identifiers never cross the preload boundary or appear in request traces.

## Compatibility and failure behavior

- Existing OpenAI Codex text requests retain their wire shape and streaming behavior.
- Existing API-key OpenAI image generation is unchanged.
- Accounts without image entitlement receive the existing normalized Codex permission error.
- Missing provider-db metadata omits `gpt-image-2` instead of synthesizing incomplete capability
  data.
- The default provider connection check remains a text request and does not prove image entitlement;
  image-specific errors surface on the first generation request.

## Acceptance criteria

- Refreshing OpenAI Codex models includes `gpt-image-2` when bundled provider-db includes it.
- DeepChat identifies that model as an image-generation model and shows the existing image settings UI.
- A generation request targets `/backend-api/codex/images/generations` with OAuth/account headers,
  a JSON accept header, and no Responses-only `store` field.
- Returned base64 image data follows the existing image cache and preview path.
- Text generation, OAuth refresh, error normalization, and provider checks remain unchanged.

## Open questions

None.
