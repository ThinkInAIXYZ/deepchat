# Composer references and attachments

## Decision

Adopt the hybrid composer: lightweight inline references preserve sentence meaning, while uploaded
materials have a separate attachment shelf. The composer, queue editor, sent message, and message
editor preserve the same reference identity and position. Keep Tiptap and the existing message JSON
storage; do not introduce a second editor, history store, or a configurable layout mode.

## Content contract

Workspace references are structured inline atoms backed by the original `@relativePath` text. Their
metadata records the full file path, relative path, and text offset. The atom replaces exactly that
text span when displayed or restored. Native and ACP model input retain the existing text semantics:
selecting a reference neither uploads the file nor grants additional filesystem permissions. Plain
text containing `@` is never heuristically promoted to a reference.

Session references remain zero-width inline items with canonical source identity and incarnation.
They authorize bounded, on-demand reads, never automatic transcript injection. Structured message
edits may retain, reposition, or remove existing session references, but cannot manufacture new
source grants. Legacy text-only edits retain their existing re-anchoring behavior.

Uploaded files remain owned by the message's files array. New uploads appear in a separate shelf,
not automatically in the sentence. Existing inline attachment references remain readable and can be
restored without losing material. Removing a sentence reference does not remove its material from
the shelf; removing a shelf item also prunes its legacy inline references. Attachment presentation
retains representation choices, explicit
failures, and partial OCR coverage. A sentence reference must not duplicate uploaded material.

## Interaction

The @ picker identifies files by basename plus distinguishing path and groups files and sessions.
It exposes loading, empty, workspace-unavailable, and search-failure states. Keyboard selection uses
arrows and Enter/Tab; Escape closes; IME confirmation never selects or submits. Suggestions take
precedence over send/queue shortcuts. The picker stays within the available viewport.

References share restrained baseline-aligned styling, readable labels, keyboard-accessible details,
and explicit source-opening actions. Clicking a session reference first opens details, not another
conversation. Full identities remain available without relying on hover-only tooltips.

The attachment shelf is absent when empty, bounded when crowded, and expandable in place. Sent
attachments are read-only. Model, permission, workspace, and persistent skills remain session
configuration, not ordinary reference candidates.

Message text wraps naturally. Long-message disclosure is based on measured rendered height rather
than character count, with a stable scroll anchor. Editing references does not move them to the end
of the message. Draft restoration and submission races preserve edits made after submission.
Keyboard focus entering collapsed message content expands it before the referenced control is used.
Chat search indexes the same distinguishing labels that messages display; reference and inline
attachment labels opt into highlighting without making action buttons or draft editors searchable.

## Ownership and compatibility

Shared types/contracts own persisted reference metadata and edit payload validation. Renderer
composer document helpers own projection between text/inline items and Tiptap. Session transcript
mutations validate edited grants against the original message before writing and reject edits if
that message changed or disappeared while cancellation was pending. Model providers and
attachment preparation retain their existing responsibilities.
Path labels are calculated together and reused across node views of the same immutable document.
Grant validation indexes canonical identities once; repeated occurrences of an already granted
source remain allowed at different sentence positions without granting access to another source.

Old messages and drafts remain supported without a database migration. A workspace reference whose
metadata no longer matches its text degrades to the original text, not a different linked object.
Existing source reset/deletion validation remains authoritative. No dependencies, services, public
settings, or external accounts are added.

## Acceptance

- Same-named files are distinguishable in the picker, composer, and sent message.
- References preserve identity, order, and position through draft reload, queue edits, send, retry,
  copy, and message edits, including reference-only messages and non-ASCII paths.
- Uploading and removing material does not unexpectedly modify the sentence or revoke references.
- Session editing cannot add an unselected source grant; an explicit removal revokes that message's
  reference without deleting the source conversation.
- IME, keyboard selection, undo, and queue shortcuts retain predictable ownership.
- Narrow/light/dark views, long mixed-language messages, and multiple attachments remain readable.
- Attachment failures and partial extraction remain visible, and source inspection preserves the
  current writing/reading location until the user chooses to navigate.

## Non-goals

No sidebar redesign, provider behavior change, automatic context expansion, new search backend,
cross-workspace search widening, or rewrite of assistant/tool rendering.
