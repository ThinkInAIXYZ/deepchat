import CuaDriverCore
import Foundation
import MCP

public enum CheckPermissionsTool {
    public static let handler = ToolHandler(
        tool: Tool(
            name: "check_permissions",
            description: """
                Report TCC permission status for Accessibility and Screen Recording.
                Pass {"prompt": true} to raise the system permission dialogs for any
                missing grants — otherwise the call is purely read-only.
                """,
            inputSchema: [
                "type": "object",
                "properties": [
                    "prompt": [
                        "type": "boolean",
                        "description":
                            "If true, raise the system permission prompts for missing grants.",
                    ]
                ],
                "additionalProperties": false,
            ],
            annotations: .init(
                // Not readOnly when prompt=true (it may raise a modal dialog).
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false
            )
        ),
        invoke: { arguments in
            if arguments?["prompt"]?.boolValue == true {
                _ = Permissions.requestAccessibility()
                _ = Permissions.requestScreenRecording()
            }
            let status = await Permissions.currentStatus()
            let accessibilityPrefix = status.accessibility ? "✅" : "❌"
            let screenRecordingPrefix = status.screenRecording ? "✅" : "❌"
            let summary =
                """
                \(accessibilityPrefix) Accessibility: \(status.accessibility ? "granted" : "NOT granted").
                \(screenRecordingPrefix) Screen Recording: \(status.screenRecording ? "granted" : "NOT granted").
                """
            return CallTool.Result(
                content: [.text(text: summary, annotations: nil, _meta: nil)]
            )
        }
    )
}
