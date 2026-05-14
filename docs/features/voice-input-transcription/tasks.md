# Voice Input Transcription Tasks

- [x] Update the existing voice-input SDD docs to reflect local recording plus model transcription.
- [x] Add a provider-agnostic `models.transcribeAudio` typed route and renderer client method.
- [x] Add `LLMProviderPresenter.transcribeAudioStandalone` with OpenAI-style multipart transcription as the primary path and `input_audio` + standalone completion fallback.
- [x] Add automatic fallback when third-party OpenAI-compatible `/audio/transcriptions` endpoints are unsupported.
- [x] Convert local recordings to wav before transcription and update the speech-recognition composable.
- [x] Keep existing mic gate logic, but only insert text after transcription succeeds in chat/new-thread pages.
- [x] Update button/error copy for local recording where needed.
- [x] Make the recording state visually obvious on the mic button with an active background/motion cue.
- [x] Replace the recording-state icon with a waveform-style SVG animation.
- [x] Make standalone transcription surface provider/runtime errors instead of silently returning an empty transcript.
- [x] Add renderer-side abort/timeout cleanup so stalled transcription requests do not leave the mic button loading forever.
- [x] Apply PR review hardening for MIME fallback consistency, recorder cleanup, timeout classification, payload limits, ACP draft attachment filtering, and locale copy.
- [x] Add focused regression tests for the review hardening items.
- [x] Run focused tests, then format/i18n/lint.
