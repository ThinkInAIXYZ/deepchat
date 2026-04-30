# Chat Attachment File Support

## User Story

Users can attach common office, document, text, image, and audio files from the chat input. If a file cannot be processed, DeepChat reports the failure instead of silently ignoring it.

## Acceptance Criteria

- Word OOXML documents such as `.docx`, `.docm`, `.dotx`, and `.dotm` route to the document adapter.
- Spreadsheet files such as `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.xltx`, `.xltm`, `.ods`, `.csv`, and `.tsv` route to spreadsheet or delimited text adapters.
- Presentation OOXML files such as `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.potx`, and `.potm` route to the presentation adapter.
- Common text formats such as `.txt`, `.md`, `.markdown`, `.json`, `.yaml`, `.yml`, `.xml`, `.html`, `.css`, and source files remain supported.
- Common media formats such as `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`, `.heic`, `.heif`, `.mp3`, `.wav`, and `.m4a` remain supported where the existing adapters can process them.
- Chat input selection, paste, and drop flows show a localized destructive toast when one or more files fail processing.

## Non-Goals

- Full parsing support for legacy binary `.doc` and `.ppt` files is not introduced in this increment.
- The file picker is not restricted to only known extensions; unsupported files should still fail with visible feedback.

