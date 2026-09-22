# Retire built-in artifacts

## Context and scope

DeepChat removes the legacy artifact generation and preview feature. Agents create workspace files
and use the existing browser tools for interactive web content. No replacement tool is introduced.

## Ownership and design

- MCP settings stop registering Artifacts and remove persisted in-memory artifact servers during
  normal settings normalization. External user-configured servers are preserved.
- MessageBlockContent owns compatibility: legacy antArtifact markup and structured artifact metadata
  display their title and literal, copyable source. HTML, SVG, React and Mermaid are never executed
  by this compatibility view. Unclosed historical blocks remain readable.
- The workspace panel owns files, Git and live delegations only. Remove artifact collection,
  selection, auto-opening, preview runtimes, export helpers and obsolete settings.
- Ordinary Markdown code blocks no longer offer artifact previews. Ordinary workspace file previews
  and browser tooling retain their existing behavior.
- Remove the bundled web-artifacts-builder skill that instructs agents to produce Claude artifacts.

## Compatibility and invariants

No conversation database migration or rewriting of historical messages is required. Retain legacy
message types, conversation columns, parsing and export support. Existing stored feature preferences
have no effect. CLI output spooling, OCR artifacts, MCP Apps and generated media are separate systems
and remain available. This change does not automatically execute or migrate old artifacts to files.

## UI

```text
BEFORE  Message [Artifact card] -> Workspace [Preview | Code]
AFTER   Message [Title / Copy / Literal source]
        Workspace [Files | Git | Subagents]
```

## Acceptance criteria

- New and upgraded installations do not expose the built-in artifact instruction tool.
- Historical closed, unclosed and structured artifact content remains readable and copyable,
  including React source, unsupported MIME types and embedded HTML/script text.
- Reading old messages cannot launch an artifact runtime or open the workspace panel.
- File selection, file previews, Git diffs, Markdown rendering and browser access remain functional.

## Open questions

None.
