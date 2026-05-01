# Permissions and UX Plan

## Permission Model

Computer Use needs two macOS TCC grants:

- Accessibility: required for input control and accessibility tree access.
- Screen Recording: required for screenshots, screen/window inspection, and ScreenCaptureKit probes.

The app must not imply these permissions can be bypassed. Missing permissions should be treated as normal
setup state, not as a generic error.

## Permission Identity

System Settings must show:

```text
DeepChat Computer Use
```

This requires the helper bundle identity to be stable:

```text
CFBundleIdentifier: com.wefonk.deepchat.computeruse
CFBundleDisplayName: DeepChat Computer Use
```

Do not keep upstream `com.trycua.driver` for the integrated helper, because users would see `CuaDriver`
instead of DeepChat in System Settings.

## Permission Guide Behavior

Use the permiso interaction model:

- Open the target System Settings privacy pane via `x-apple.systempreferences`.
- Locate the visible System Settings window.
- Display a passive, non-activating overlay near the relevant settings content.
- Poll permission status until granted.
- Advance from Accessibility to Screen Recording automatically when possible.
- Close the overlay after both grants are detected.

Recommended panels:

```text
Accessibility:
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility

Screen Recording:
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture
```

## Settings Card

Initial macOS disabled state:

```text
Settings > MCP
+--------------------------------------------------+
| Computer Use (macOS)                       [Off] |
| Let DeepChat operate local apps after approval.  |
| Helper: Not running                              |
| Accessibility: Not requested                     |
| Screen Recording: Not requested                  |
|                                                  |
| [Open Permission Guide] [Check Again]            |
+--------------------------------------------------+
```

Enabled but missing permissions:

```text
Settings > MCP
+--------------------------------------------------+
| Computer Use (macOS)                        [On] |
| Helper: Ready                                    |
| Accessibility: Missing                           |
| Screen Recording: Granted                        |
| MCP: Waiting for permissions                     |
|                                                  |
| [Open Permission Guide] [Check Again]            |
+--------------------------------------------------+
```

Enabled and ready:

```text
Settings > MCP
+--------------------------------------------------+
| Computer Use (macOS)                        [On] |
| Helper: Ready                                    |
| Accessibility: Granted                           |
| Screen Recording: Granted                        |
| MCP: Running                                     |
|                                                  |
| [Restart Service] [Check Again]                  |
+--------------------------------------------------+
```

Unsupported platform:

```text
Settings > MCP
+--------------------------------------------------+
| Computer Use                                     |
| Available on macOS only.                         |
+--------------------------------------------------+
```

## Permission Overlay Sketch

```text
System Settings > Privacy & Security > Accessibility
+--------------------------------------------------------------+
| Accessibility                                                |
|                                                              |
|  [ ] DeepChat Computer Use                                   |
|                                                              |
|          +---------------------------------------------+     |
|          | Enable DeepChat Computer Use in this list.  |     |
|          | DeepChat will continue when permission is on.|     |
|          +---------------------------------------------+     |
+--------------------------------------------------------------+
```

For Screen Recording, use the same shape and text adapted to screen capture.

## Copy Guidelines

User-facing copy should be short and direct:

- "Computer Use lets DeepChat inspect and operate local apps after you approve tool calls."
- "Accessibility is required for clicks, typing, shortcuts, and accessibility tree access."
- "Screen Recording is required for screenshots and screen state."
- "DeepChat cannot use Computer Use until both permissions are granted."

Avoid claiming the feature is always safe. Instead, make the permission boundaries visible.

## Interaction Rules

- Opening the guide should not auto-enable action tools.
- Toggling Computer Use off should stop/restart the MCP server so tools disappear from active sessions.
- If global MCP is disabled, the card should say Computer Use is configured but MCP is off.
- If the helper exits because permissions are missing, show the permission guide action rather than a raw stderr block.
- If System Settings cannot be found for overlay positioning, fall back to opening the pane and showing an in-app checklist.

## Accessibility of the UI

- Status labels must not rely only on color.
- Buttons must have clear labels and keyboard focus states.
- The overlay should be passive and should not intercept System Settings interaction.
- Renderer strings must use i18n keys.

