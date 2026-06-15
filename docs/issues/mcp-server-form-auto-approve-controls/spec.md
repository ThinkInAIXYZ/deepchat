# MCP Server Form Auto Approve Controls Spec

## Goal

Restore editable auto-approve controls in the MCP server add/edit form.

## Requirements

- The MCP add server form displays interactive controls for All, Read, and Write auto-approve options.
- The MCP edit server form displays the same controls and initializes them from `initialConfig.autoApprove`.
- Submitting the form persists the selected values through `MCPServerConfig.autoApprove`.
- Existing server fields, route contracts, and store behavior remain unchanged.

## Layout

Before:

```text
Auto Approve
  All
  Read
  Write
```

After:

```text
Auto Approve
  [ ] All
  [ ] Read
  [ ] Write
```

## Compatibility

MCP config keys and saved `autoApprove` values remain unchanged.
