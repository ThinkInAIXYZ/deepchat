# Plan

## Implementation

Update `allServerList` in `src/renderer/src/stores/mcp.ts` to rank servers by:

1. enabled built-in/deepchat
2. enabled custom
3. disabled built-in/deepchat
4. disabled custom

Keep JavaScript's stable sort preserving original config order inside the same rank.

## Test Strategy

Add a store test proving an enabled custom server sorts before disabled built-in/custom servers.
