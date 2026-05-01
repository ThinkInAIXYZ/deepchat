import CuaDriverCore
import Foundation
import MCP

public enum GetAccessibilityTreeTool {
    public static let handler = ToolHandler(
        tool: Tool(
            name: "get_accessibility_tree",
            description: """
                Return a lightweight snapshot of the desktop: running regular apps and
                on-screen visible windows with their bounds, z-order, and owner pid.

                For the full AX subtree of a single window (with interactive element
                indices you can click by), use `get_window_state` instead — that's the
                heavy per-window tool. This one is a fast discovery read that needs no
                TCC grants.
                """,
            inputSchema: [
                "type": "object",
                "properties": [:],
                "additionalProperties": false,
            ],
            annotations: .init(
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false
            )
        ),
        invoke: { _ in
            let apps = AppEnumerator.runningApps()
            let windows = WindowEnumerator.visibleWindows()
            var lines = ["✅ \(apps.count) running app(s), \(windows.count) visible window(s)"]
            for app in apps {
                lines.append("- \(app.name) (pid \(app.pid))")
            }
            let summary = lines.joined(separator: "\n")
            return CallTool.Result(
                content: [.text(text: summary, annotations: nil, _meta: nil)]
            )
        }
    )

    struct Output: Codable, Sendable {
        let applications: [AppInfo]
        let windows: [WindowInfo]
    }
}
