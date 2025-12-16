import { BrowserWindow } from 'electron'

export interface ManagedWindow {
  id: number
  window: BrowserWindow
}

export interface BrowserWindowManagerOptions {
  showWindow?: boolean
}

/**
 * Lightweight wrapper for creating and tracking BrowserWindow instances for a session.
 */
export class BrowserWindowManager {
  private readonly showWindow: boolean
  private readonly windows = new Map<number, BrowserWindow>()

  constructor(options?: BrowserWindowManagerOptions) {
    this.showWindow = options?.showWindow ?? false
  }

  createWindow(): ManagedWindow {
    const window = new BrowserWindow({
      width: 1024,
      height: 768,
      show: this.showWindow,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })

    this.windows.set(window.id, window)

    window.on('closed', () => {
      this.windows.delete(window.id)
    })

    return {
      id: window.id,
      window
    }
  }

  getWindow(id: number): BrowserWindow | undefined {
    return this.windows.get(id)
  }

  listWindows(): ManagedWindow[] {
    return Array.from(this.windows.values()).map((window) => ({
      id: window.id,
      window
    }))
  }

  destroyAll(): void {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    }
    this.windows.clear()
  }
}
