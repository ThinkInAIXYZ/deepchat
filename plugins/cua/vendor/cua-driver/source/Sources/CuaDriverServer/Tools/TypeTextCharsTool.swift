import CuaDriverCore
import Foundation
import MCP

/// Character-by-character CGEvent typing, always targeting a specific pid.
/// Previously this posted to the system HID tap (frontmost-routed), which
/// was a footgun when a driver-backgrounded app typed characters into the
/// user's real foreground app. Making pid mandatory and routing via
/// `CGEvent.postToPid` removes the footgun.
public enum TypeTextCharsTool {
    public static let handler = ToolHandler(
        tool: Tool(
            name: "type_text_chars",
            description: """
                Type `text` one character at a time, delivered directly to
                the target pid's event queue via `CGEvent.postToPid`. Each
                character is posted as a synthesized key-down/key-up pair
                whose Unicode payload is set via
                `CGEventKeyboardSetUnicodeString`, bypassing virtual-key
                mapping so accents, symbols, and emoji transmit verbatim.

                Use this when the AX-based `type_text` silently drops
                characters — typical for Chromium / Electron text inputs
                that don't expose `kAXSelectedText`. The target does NOT
                need to be frontmost; keyboard focus within the target pid
                determines where characters land, so focus the receiving
                element first (e.g. via `click` on the input).

                `delay_ms` (0-200) spaces successive characters so
                autocomplete and IME paths can keep up. Default 30.
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
                        "description": "Text to type into the target's focused element.",
                    ],
                    "delay_ms": [
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 200,
                        "description":
                            "Milliseconds between successive characters. Default 30.",
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
            let delayMs = arguments?["delay_ms"]?.intValue ?? 30
            guard let pid = Int32(exactly: rawPid) else {
                return errorResult(
                    "pid \(rawPid) is outside the supported Int32 range.")
            }

            do {
                try KeyboardInput.typeCharacters(
                    text,
                    delayMilliseconds: delayMs,
                    toPid: pid
                )
                let summary =
                    "✅ Typed \(text.count) character(s) on pid \(rawPid) with \(delayMs)ms delay."
                return CallTool.Result(
                    content: [.text(text: summary, annotations: nil, _meta: nil)]
                )
            } catch let error as KeyboardError {
                return errorResult(error.description)
            } catch {
                return errorResult("Unexpected error: \(error)")
            }
        }
    )

    struct Result: Codable, Sendable {
        let pid: Int
        let characterCount: Int
        let delayMilliseconds: Int

        private enum CodingKeys: String, CodingKey {
            case pid
            case characterCount = "character_count"
            case delayMilliseconds = "delay_ms"
        }
    }

    private static func errorResult(_ message: String) -> CallTool.Result {
        CallTool.Result(
            content: [.text(text: message, annotations: nil, _meta: nil)],
            isError: true
        )
    }
}
