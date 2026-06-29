# Plugin Remote Detail Consistency

## User Need

Remote-control plugins should keep the same icon and localized title treatment when moving between the plugin list and detail page.

## Goal

Make remote virtual plugins and the official Feishu/Lark plugin use the same icon, color, and localized title shown by remote channel metadata.

## Acceptance Criteria

- Feishu/Lark catalog and detail both show the message-circle icon with the blue remote color.
- Remote virtual plugin details keep their catalog icon color.
- In Chinese, Feishu/Lark keeps the localized `飞书 / Lark` title instead of flashing to the plugin manifest name.
- Non-remote official plugins still use the generic puzzle icon.

## Constraints

- Keep the fix in the renderer plugin detail page.
- Do not change plugin manifest data or remote-control settings behavior.

## Non-Goals

- Redesign the plugin hub layout.
- Add new icon configuration infrastructure.

## Open Questions

- None.
