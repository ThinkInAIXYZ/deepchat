---
name: yo-browser-cdp
description: DeepChat's built-in YoBrowser capability, controlled via Chrome DevTools Protocol (CDP). Prefer this skill whenever the model needs web browsing, navigation, extraction, or interaction.
allowedTools:
  - yo_browser_tab_list
  - yo_browser_tab_new
  - yo_browser_tab_activate
  - yo_browser_tab_close
  - yo_browser_cdp_send
---

# YoBrowser CDP Skill

## Overview

YoBrowser is DeepChat's built-in browser. This skill exposes browser capabilities by controlling YoBrowser through Chrome DevTools Protocol (CDP).

Use this skill as the default choice when you need any web browsing or page-level interaction (navigate, read, extract, click, fill forms, verify UI behavior). It is especially suitable for tasks that require real browser behavior rather than simple HTTP fetching.

## Mental Model

The browser automation workflow follows this pattern:
1. **Tab Management**: Tabs are isolated browser instances. You can list, create, activate, and close tabs.
2. **Active Tab**: Each browser has one active tab that receives commands by default.
3. **CDP Session**: Each tab has a CDP session attached that accepts protocol commands.
4. **CDP Commands**: Send `{ method, params }` to the active tab's CDP session to perform operations.

## Security Constraints

**IMPORTANT**: Browser tabs with URLs starting with `local://` are **NOT** allowed to attach CDP sessions. This is a security boundary to prevent automation of DeepChat's internal UI pages.

If you attempt to use CDP commands on a `local://` tab, the operation will fail with an error.

## Recommended Workflow

### Basic Navigation and Content Reading

1. List current tabs:
   ```
   yo_browser_tab_list()
   ```

2. If no suitable tab exists, create a new one:
   ```
   yo_browser_tab_new({ url: "https://example.com" })
   ```

3. Navigate to a target URL using CDP:
   ```
   yo_browser_cdp_send({
     method: "Page.navigate",
     params: { url: "https://example.com" }
   })
   ```

4. Wait for page load (check navigation result):
   - The `Page.navigate` response includes `result: { success: boolean }`
   - If navigation is successful, proceed to content extraction

5. Extract page content using CDP:
   ```
   yo_browser_cdp_send({
     method: "Runtime.evaluate",
     params: {
       expression: "document.body.innerText",
       returnByValue: true
     }
   })
   ```

### Advanced: DOM Interaction

1. Find elements:
   ```
   yo_browser_cdp_send({
     method: "Runtime.evaluate",
     params: {
       expression: "document.querySelector('.button').click()",
       returnByValue: false
     }
   })
   ```

2. Wait for state changes:
   ```
   yo_browser_cdp_send({
     method: "Runtime.evaluate",
     params: {
       expression: `
         new Promise(resolve => {
           const check = () => {
             if (document.querySelector('.loaded')) resolve(true);
             else setTimeout(check, 100);
           };
           check();
         })
       `,
       awaitPromise: true
     }
   })
   ```

## Available Tools

### `yo_browser_tab_list`
List all browser tabs and identify the active tab.

**Returns**: JSON object with `activeTabId` and `tabs` (each tab has `id`, `url`, `title`, `isActive`).

### `yo_browser_tab_new`
Create a new browser tab with an optional URL.

**Parameters**:
- `url` (optional): Initial URL to navigate to

**Returns**: New tab object with `id`, `url`, and `title`.

### `yo_browser_tab_activate`
Make a specific tab the active tab.

**Parameters**:
- `tabId`: ID of the tab to activate

### `yo_browser_tab_close`
Close a specific browser tab.

**Parameters**:
- `tabId`: ID of the tab to close

### `yo_browser_cdp_send`
Send a CDP command to a tab.

**Parameters**:
- `tabId` (optional): Target tab ID. If omitted, uses the active tab.
- `method`: CDP method name (e.g., `Page.navigate`, `Runtime.evaluate`)
- `params` (optional): Method parameters as an object

**Returns**: CDP command response as JSON.

## Common CDP Commands

### Page Navigation
- `Page.navigate` - Navigate to a URL
  - `params: { url: string }`

### DOM Inspection
- `Runtime.evaluate` - Execute JavaScript in page context
  - `params: { expression: string, returnByValue: boolean, awaitPromise: boolean }`
- `DOM.getDocument` - Get DOM tree
- `DOM.querySelector` - Find a DOM node

### Page Interaction
- `Input.dispatchMouseEvent` - Simulate mouse events
- `Input.dispatchKeyEvent` - Simulate keyboard events
- `Runtime.evaluate` with `expression` containing `.click()` - Click elements

## Error Handling

Common errors and how to handle them:

1. **Tab not found**: The specified `tabId` doesn't exist. Use `yo_browser_tab_list` to get valid tabs.

2. **No active tab**: You tried to send a CDP command without specifying a tab ID, and no tab is active. Create or activate a tab first.

3. **CDP attach rejected**: You attempted to attach CDP to a `local://` URL. This is a security restriction and cannot be bypassed.

4. **Navigation failed**: `Page.navigate` returned `success: false`. The URL may be invalid or unreachable. Check the URL and try again.

5. **Element not found**: Your DOM query returned null. Verify the selector is correct and the page has loaded completely.

6. **Navigation timeout**: The page took too long to load. Consider adding retry logic or increasing timeout tolerance.

7. **Tab destroyed**: The tab was closed during operations. List tabs again and recreate if needed.

## Best Practices

1. **Always list tabs first** to understand the current state before making assumptions.

2. **Check navigation success** before proceeding with content extraction.

3. **Use `awaitPromise: true`** when evaluating JavaScript that returns Promises.

4. **Handle `local://` restrictions** by checking tab URLs before attempting CDP operations.

5. **Close tabs when done** to free resources, especially if many tabs were created.

6. **Use `returnByValue: true`** when you need the actual value from `Runtime.evaluate`, not a remote object reference.

## Example Session

```json
// 1. List tabs
{ "tool": "yo_browser_tab_list", "args": {} }

// Response: { "activeTabId": "tab-1", "tabs": [{ "id": "tab-1", "url": "about:blank", "title": "", "isActive": true }] }

// 2. Navigate to a page
{ "tool": "yo_browser_cdp_send", "args": {
  "method": "Page.navigate",
  "params": { "url": "https://example.com" }
}}

// Response: { "result": { "success": true } }

// 3. Extract page content
{ "tool": "yo_browser_cdp_send", "args": {
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.title",
    "returnByValue": true
  }
}}

// Response: { "result": { "type": "string", "value": "Example Domain" } }
```

## Deactivation

When you're finished with browser operations, explicitly deactivate this skill to keep the tool set focused on the current task.
