# MCP Server Form Auto Approve Controls Plan

## Approach

Restore the existing checkbox component binding for the MCP server form auto-approve options.
Keep the submitted `MCPServerConfig.autoApprove` shape unchanged.

## Implementation

- Import the shared checkbox component used by the form template.
- Verify edit-mode initial values and submit behavior for read/write permissions.

## Verification

- `pnpm vitest --config vitest.config.renderer.ts test/renderer/components/McpServerForm.test.ts`
