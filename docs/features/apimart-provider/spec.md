# APIMart Provider

Status: implemented provider contract.

## Objective

DeepChat exposes APIMart as a disabled built-in provider at `https://api.apimart.ai/v1`. The
provider uses one API key and one account-scoped model catalog for chat, embeddings, speech,
transcription, image generation, and video generation.

## Provider Identity And Discovery

- The stable provider ID and API type are both `apimart`.
- The default base URL is `https://api.apimart.ai/v1` and authentication uses an API key in the
  `Authorization: Bearer` header.
- Model discovery calls `GET /v1/models?expand=parameters`. The returned catalog is account scoped
  and therefore remains the authority instead of a checked-in model list.
- `category`, `capability_tags`, `supported_endpoint_types`, and `parameters.endpoint` determine
  the DeepChat model type and transport route. Owner metadata remains available for capability
  identity resolution.
- The connection check fetches the authenticated model catalog; it does not spend tokens on a
  hard-coded model that might not be enabled for the account.

## Text And Audio Routing

APIMart exposes Chat Completions as a compatibility route, plus OpenAI Responses, Anthropic
Messages, and Gemini native transports. DeepChat resolves each chat model from the account catalog
instead of forcing every model through Chat Completions:

1. GPT-5 family models use Responses, including when the catalog reports only the generic `openai`
   endpoint type, matching APIMart's required Responses wire protocol for Codex and tool workflows;
2. an explicit `parameters.endpoint` wins for other models when APIMart publishes one;
3. Claude and Gemini families use their native transport when the corresponding value is present in
   `supported_endpoint_types`;
4. other chat models prefer `openai-response` whenever the catalog declares it, even when `openai`
   appears first;
5. models without a more specific supported route fall back to `openai` Chat Completions.

The transport decision is recalculated for every request from the active APIMart provider and model.
Effective model configuration carried by an existing session is not route authority, so an older
session or a model switch cannot pin a model to a stale endpoint.

The resulting routes are `/v1/responses`, `/v1/messages`, `/v1beta/models/...`, or
`/v1/chat/completions`. Anthropic uses its native API-key header. Gemini uses APIMart's documented
Bearer authentication rather than treating the APIMart key as a Google API key.

OpenAI-compatible embeddings, speech, and transcription continue through the shared AI SDK
runtime. Audio catalog entries are classified as TTS only when their model ID identifies a speech
synthesis model; transcription and unsupported audio-generation entries are not mislabeled as TTS.

## Asynchronous Media Routing

APIMart image and video generation differ from the synchronous OpenAI image response and the
OpenAI video task shape used by the shared runtime. The dedicated adapter therefore:

1. sends image models to `POST /v1/images/generations` and video models to
   `POST /v1/videos/generations`;
2. reads the returned `task_id`;
3. polls `GET /v1/tasks/{task_id}` until completion, failure, or cancellation;
4. reads image URLs from `data.result.images` and video URLs from `data.result.videos`;
5. caches expiring image output locally and downloads video output before returning the standard
   DeepChat media event.

The adapter forwards the shared image and video settings that have an APIMart counterpart. Pixel
image sizes are converted to aspect ratios, and video ratios are sent as `aspect_ratio`. Basic
text-to-image and text-to-video remain valid when no optional settings are selected. If the live
parameter schema is unavailable after a restart or failed refresh, the adapter sends only the
required model and prompt fields instead of guessing which optional parameters remain supported.

Caller cancellation and model timeouts cover task creation, polling, image caching, and media
download. Polling also has a 15-minute maximum deadline. Task failures surface the provider error
message. Image output must be cached locally before it is returned. Video downloads reject
private-network destinations, time out after two minutes, and are limited to 256 MiB. API
credentials are sent only to the APIMart API host and are never forwarded to generated-media URLs.

## Renderer

The provider uses the favicon served by `https://apimart.ai/favicon.ico`. The existing provider
configuration and media settings UI are reused; no APIMart-specific form or renderer-owned routing
logic is introduced.

## Non-goals

- Dynamic forms generated from APIMart's per-model JSON Schema.
- APIMart image upload, reference-media upload, webhooks, Midjourney actions, music generation, or
  moderation APIs.
- Selecting a native Anthropic, Gemini, or Responses route that the APIMart catalog does not declare.
- Persisting APIMart task IDs or resuming tasks after application restart.

## Acceptance Criteria

- A new installation and an upgraded installation receive the disabled APIMart profile without
  changing existing provider settings.
- An authenticated refresh classifies chat, embedding, image, video, and TTS models from APIMart
  metadata and preserves owner metadata.
- Chat models use the provider-specific Responses, Anthropic, Gemini, or Chat Completions transport;
  a model such as `gpt-5.6-luna` uses Responses even when the catalog reports generic `openai`.
- Existing sessions and model switches use the current provider-model route instead of a stale
  request endpoint.
- Image and video requests use APIMart task creation and polling routes and return standard
  DeepChat media events.
- Abort signals stop polling and output downloads; polling and downloads remain bounded without a
  caller signal.
- The APIMart favicon is rendered for the provider.
