# File Attachment Token Bloat Spec

> Status: Implemented
> Date: 2026-07-02
> Related: https://github.com/ThinkInAIXYZ/deepchat/issues/1864

## Problem

DeepChat currently treats chat input files as both UI attachments and model-ready context. For
non-image files, `file.prepareFile` returns LLM-friendly `content`, the user message can store that
content, and the agent runtime context builder can replay it into every later request while the
message remains inside history. For images, uploaded/pasted files are represented with image data
URLs so vision models can see them, but historical image turns can also keep resending large inline
image payloads. Audio is different from document files: when the selected model supports native
audio input, keeping audio as structured base64 input is intentional model behavior, not a text
attachment fallback.

Issue #1864 reports the visible failure mode: attaching an image, PDF, or document makes later API
calls resend the old file data, increasing request size, cache misses, token use, and latency.

## User Need

Users need file attachments to remain visually correct in the conversation while keeping later model
requests lean. The model should still receive enough path and metadata context to read local files
through tools instead of embedding their contents into chat history.

## Goals

- Keep image attachments as message media for the submitted turn so vision behavior remains correct.
- Avoid resending historical file bytes or extracted document text on unrelated follow-up turns.
- Route non-image file understanding through existing filesystem tooling when the agent needs the
  content.
- Preserve native audio input for models that support audio attachments.
- Keep message rendering stable: existing attachment chips, thumbnails, names, paths, and metadata
  stay visible in the transcript.

## Acceptance Criteria

- A newly submitted image attachment is sent as an image part when the active model supports vision.
- Historical image attachments are not resent as inline image data by default on later unrelated
  turns; history includes enough metadata/path context for the model to request a read when tools are
  available.
- Non-image attachments are replayed as path plus metadata by default, not full extracted content.
- Existing `agent-filesystem.read` remains the primary path for reading text, PDF, Office, and other
  supported non-image files during an agent turn.
- PDF, Word, Excel, PowerPoint, text, and code files continue to rely on the existing
  `FilePresenter.prepareFileCompletely(..., 'llm-friendly')` pipeline behind
  `agent-filesystem.read`.
- Audio attachments still become structured `input_audio` parts when the model supports audio input.
- Attachment chips do not need a separate path insertion action; path/metadata is included
  automatically in the model-visible attachment context.
- Existing sessions with stored attachment content do not require a database migration; request
  construction strips or ignores stale inline content where needed.

## Non-Goals

- Redesigning the full attachment data model in one step.
- Replacing `agent-filesystem.read` with a new file reading tool.
- Automatically invoking file reads before every provider call.
- Deleting attachment content from existing user databases during this change.
- Removing structured audio input for audio-capable models.
- Solving provider-specific cache-key behavior beyond stopping repeated inline payloads.

## Constraints

- Reuse existing main-process tools and permission flow for file reads.
- Keep privileged filesystem access behind preload/typed route clients.
- Keep UI copy in i18n keys when implementation starts.
- Keep the first implementation small enough to review as a focused issue fix.

## Open Questions

None.
