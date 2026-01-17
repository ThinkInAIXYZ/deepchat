# Main Process Specifications

**Status**: Draft
**Created**: 2026-01-16
**Related**: [spec.md](./spec.md)

---

## Overview

This document specifies main process changes required for the Single WebContents Architecture, based on analysis of existing `WindowPresenter` and `TabPresenter` implementations.

**Key Files**:
- `src/main/presenter/windowPresenter/index.ts`
- `src/main/presenter/tabPresenter.ts`

---

## 1. WindowPresenter Changes

### 1.1 New Method: createChatWindow()

**Purpose**: Create a single-WebContents chat window (no Shell, no WebContentsView).

**Reference**: Based on existing `createSettingsWindow()` pattern.

```typescript
interface CreateChatWindowOptions {
  /** Initial conversation to load */
  initialConversationId?: string

  /** Window bounds */
  bounds?: { x: number; y: number; width: number; height: number }

  /** Restore previous window state */
  restoreState?: boolean
}

async createChatWindow(options?: CreateChatWindowOptions): Promise<BrowserWindow>
```

### 1.2 Implementation Specification

```typescript
async createChatWindow(options?: CreateChatWindowOptions): Promise<BrowserWindow> {
  // 1. Window state manager (reuse existing pattern)
  const windowStateManager = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    file: 'chat-window-state.json'
  })

  // 2. Create BrowserWindow
  const window = new BrowserWindow({
    x: options?.bounds?.x ?? windowStateManager.x,
    y: options?.bounds?.y ?? windowStateManager.y,
    width: options?.bounds?.width ?? windowStateManager.width,
    height: options?.bounds?.height ?? windowStateManager.height,
    minWidth: 800,
    minHeight: 600,

    // Key difference: No Shell, direct content
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#888888',
      height: 36
    },

    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },

    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
  })

  // 3. Register window
  this.windows.set(window.id, window)
  windowStateManager.manage(window)

  // 4. Load unified renderer (NOT shell)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 5. Setup event listeners
  this.setupChatWindowEventListeners(window, options)

  // 6. Send initial state after load
  window.webContents.once('did-finish-load', async () => {
    const initState = {
      conversationId: options?.initialConversationId,
      restoredState: options?.restoreState
        ? await this.loadChatWindowState()
        : null
    }
    window.webContents.send('chat-window:init-state', initState)
  })

  // 7. Show window
  window.once('ready-to-show', () => {
    window.show()
  })

  return window
}

### 1.3 Event Listeners Setup

```typescript
private setupChatWindowEventListeners(
  window: BrowserWindow,
  options?: CreateChatWindowOptions
): void {
  const windowId = window.id

  // Focus handling (reuse existing pattern)
  window.on('focus', () => {
    this.focusedWindowId = windowId
    window.webContents.send('window-focused')
  })

  window.on('blur', () => {
    if (this.focusedWindowId === windowId) {
      this.focusedWindowId = null
    }
    window.webContents.send('window-blurred')
  })

  // Close handling (reuse existing pattern)
  window.on('close', (e) => {
    if (!this.isQuitting) {
      const closeToQuit = presenter.configPresenter.getSettingSync('closeToQuit')
      if (!closeToQuit && windowId === this.mainWindowId) {
        e.preventDefault()
        window.hide()
        return
      }
    }
  })

  // Cleanup on closed
  window.on('closed', () => {
    this.windows.delete(windowId)
    if (this.mainWindowId === windowId) {
      this.mainWindowId = null
    }
  })
}
```

### 1.4 Comparison: createShellWindow vs createChatWindow

| Aspect | createShellWindow (existing) | createChatWindow (new) |
|--------|------------------------------|------------------------|
| HTML loaded | `shell/index.html` | `src/index.html` |
| WebContentsView | Creates multiple | None |
| TabPresenter | Integrated | Not used |
| Chrome height | 36px (chat) / 84px (browser) | 0px (titleBarOverlay) |
| Initial state | Via TabPresenter | Via IPC `init-state` |
| Window type | 'chat' or 'browser' | Always 'chat' |

---

## 2. TabPresenter Changes

### 2.1 Scope Reduction

**Current**: Manages both chat and browser window tabs.

**New**: Only manages browser window tabs.

### 2.2 Code to Remove (Chat Window Logic)

```typescript
// These methods no longer needed for chat windows:

// Tab creation for chat windows
createTab(windowId, 'local://chat', options)  // Remove chat-specific logic

// Tab switching for chat windows
switchTab(tabId)  // Keep only for browser windows

// Tab state for chat windows
tabState.get(tabId)  // Remove chat window entries
```

### 2.3 Code to Keep (Browser Window Logic)

```typescript
// Keep all browser window functionality:
- createTab() for browser windows (external URLs)
- switchTab() for browser tabs
- closeTab() for browser tabs
- reorderTabs() for browser tabs
- moveTab() for browser tabs
- moveTabToNewWindow() for browser tabs
- All WebContentsView management for browser windows
```

### 2.4 Window Type Check

```typescript
// Add guard to prevent chat window operations
createTab(windowId: number, url: string, options?: TabOptions) {
  const windowType = this.windowTypes.get(windowId)

  // New: Reject chat window tab creation
  if (windowType === 'chat-new') {
    console.warn('Cannot create tabs in new chat windows')
    return null
  }

  // Existing browser window logic continues...
}
```

---

## 3. IPC Migration

### 3.1 Current IPC Architecture

```
Renderer → IPC → Main Process
    │
    ▼
event.sender.id (WebContentsId)
    │
    ▼
webContentsToTabId Map lookup
    │
    ▼
tabWindowMap lookup
    │
    ▼
Execute with resolved context
```

### 3.2 New IPC Architecture (Chat Windows)

```
Renderer → IPC → Main Process
    │
    ▼
event.sender (WebContents)
    │
    ▼
BrowserWindow.fromWebContents()
    │
    ▼
Execute with window context
```

### 3.3 IPC Channel Changes

| Category | Channels | Action |
|----------|----------|--------|
| **Remove** (chat) | `tab:create`, `tab:switch`, `tab:close`, `tab:reorder` | Remove for chat windows |
| **Keep** (browser) | `browser-tab:*` | Keep for browser windows |
| **New** | `chat-window:init-state`, `chat-window:persist-state` | Add for chat windows |
| **Unchanged** | `thread:*`, `config:*`, `agent:*` | No changes needed |

### 3.4 New IPC Handlers

```typescript
// In WindowPresenter or dedicated handler

// Renderer requests state restoration
ipcMain.handle('chat-window:restore-state', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return null

  return await this.loadChatWindowState(window.id)
})

// Renderer persists state
ipcMain.handle('chat-window:persist-state', async (event, state) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false

  await this.saveChatWindowState(window.id, state)
  return true
})
```

---

## 4. Migration Strategy

### 4.1 Phase 1: Dual Support

```typescript
// Support both old and new chat windows during migration
createChatWindow(options) {
  // New architecture
}

createShellWindow({ windowType: 'chat' }) {
  // Old architecture (keep working)
}
```

### 4.2 Phase 2: Switch Default

```typescript
// Change default to new architecture
// Feature flag: USE_SINGLE_WEBCONTENTS = true
```

### 4.3 Phase 3: Remove Old Code

```typescript
// Remove chat window logic from:
// - TabPresenter
// - Shell renderer
// - Old IPC channels
```

---

## References

- Existing `windowPresenter`: `src/main/presenter/windowPresenter/index.ts`
- Existing `tabPresenter`: `src/main/presenter/tabPresenter.ts`
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
