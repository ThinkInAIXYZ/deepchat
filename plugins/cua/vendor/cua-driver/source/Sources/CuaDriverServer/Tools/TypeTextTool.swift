import CuaDriverCore
import Foundation
import MCP

/// Unified text-insertion primitive — always targets a specific pid.
/// Previously there were two tools (`type_text` which wrote to whatever
/// was system-focused, and `type_text_in` which targeted a pid + element).
/// The system-focused variant was a footgun because any driver-backgrounded
/// app that triggered it would write characters into the user's real
/// foreground app. Merging them under a mandatory-pid shape removes the
/// footgun; the old `type_text_in` is gone.
///
/// `element_index` is optional. When present, the element is looked up
/// from the last `get_window_state` snapshot and focused before the write —
/// the canonical path for "fill this specific text field." When absent,
/// the write targets whatever element currently has focus within the
/// target pid's AX tree (`AXUIElementCreateApplication(pid)` +
/// `AXFocusedUIElement`), which is the cheaper path when focus was
/// already established by a prior click.
public enum TypeTextTool {
    public static let handler = ToolHandler(
        tool: Tool(
            name: "type_text",
            description: """
                Insert text into the target pid via
                `AXSetAttribute(kAXSelectedText)`. Works for standard Cocoa
                text fields and text views. No keystrokes are synthesized —
                special keys (Return / Escape / arrows) go through
                `press_key` / `hotkey`. For Chromium / Electron inputs that
                don't implement `kAXSelectedText`, use `type_text_chars`.

                Optional `element_index` + `window_id` (from the last
                `get_window_state` snapshot of that window) pre-focuses
                that element before the write; useful for "fill this
                specific field." Without `element_index`, the write
                targets the pid's currently-focused element — useful
                after a prior click already set focus.

                Requires Accessibility. Returns isError=true when the
                target element has no focus / rejects the attribute write.
                """,
            inputSchema: [
                "type": "object",
                "required": ["pid", "text"],
                "properties": [
                    "pid": [
                        "type": "integer",
                        "description": "Target process ID.",
                    ],
                    "text": [
                        "type": "string",
                        "description": "Text to insert at the target's cursor.",
                    ],
                    "element_index": [
                        "type": "integer",
                        "description":
                            "Optional element_index from the last get_window_state for the same (pid, window_id). When present, the element is focused before the write. Requires window_id.",
                    ],
                    "window_id": [
                        "type": "integer",
                        "description":
                            "CGWindowID for the window whose get_window_state produced the element_index. Required when element_index is used.",
                    ],
                ],
                "additionalProperties": false,
            ],
            annotations: .init(
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true
            )
        ),
        invoke: { arguments in
            guard let rawPid = arguments?["pid"]?.intValue else {
                return errorResult("Missing required integer field pid.")
            }
            guard let text = arguments?["text"]?.stringValue else {
                return errorResult("Missing required string field text.")
            }
            let elementIndex = arguments?["element_index"]?.intValue
            let rawWindowId = arguments?["window_id"]?.intValue
            guard let pid = Int32(exactly: rawPid) else {
                return errorResult(
                    "pid \(rawPid) is outside the supported Int32 range.")
            }
            if elementIndex != nil && rawWindowId == nil {
                return errorResult(
                    "window_id is required when element_index is used — the "
                    + "element_index cache is scoped per (pid, window_id). Pass "
                    + "the same window_id you used in `get_window_state`.")
            }

            do {
                if let index = elementIndex, let rawWindowId {
                    guard let windowId = UInt32(exactly: rawWindowId) else {
                        return errorResult(
                            "window_id \(rawWindowId) is outside the supported UInt32 range.")
                    }
                    let element = try await AppStateRegistry.engine.lookup(
                        pid: pid,
                        windowId: windowId,
                        elementIndex: index)
                    try await AppStateRegistry.focusGuard.withFocusSuppressed(
                        pid: pid, element: element
                    ) {
                        try AXInput.setAttribute(
                            "AXSelectedText",
                            on: element,
                            value: text as CFTypeRef
                        )
                    }
                    let target = AXInput.describe(element)
                    let summary =
                        "✅ Inserted \(text.count) char(s) into [\(index)] \(target.role ?? "?") \"\(target.title ?? "")\" on pid \(rawPid)."
                    return CallTool.Result(
                        content: [.text(text: summary, annotations: nil, _meta: nil)]
                    )
                } else {
                    let element = try AXInput.focusedElement(pid: pid)
                    try AXInput.setAttribute(
                        "AXSelectedText",
                        on: element,
                        value: text as CFTypeRef
                    )
                    let target = AXInput.describe(element)
                    let summary =
                        "✅ Inserted \(text.count) char(s) into focused \(target.role ?? "?") \"\(target.title ?? "")\" on pid \(rawPid)."
                    return CallTool.Result(
                        content: [.text(text: summary, annotations: nil, _meta: nil)]
                    )
                }
            } catch let error as AppStateError {
                return errorResult(error.description)
            } catch let error as AXInputError {
                return errorResult(error.description)
            } catch {
                return errorResult("Unexpected error: \(error)")
            }
        }
    )

    private static func errorResult(_ message: String) -> CallTool.Result {
        CallTool.Result(
            content: [.text(text: message, annotations: nil, _meta: nil)],
            isError: true
        )
    }
}
