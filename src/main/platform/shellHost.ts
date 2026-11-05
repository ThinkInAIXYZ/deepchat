/**
 * Desktop shell boundary: handing work to the operating system.
 *
 * DeepChat opens links in the system browser, reveals files in the file manager,
 * hands documents to their default app, and opens log folders. Electron does
 * this through `shell`; a mygo shell maps the same calls to its own desktop
 * APIs, so no Electron type crosses this boundary.
 */
export interface ShellHost {
  /** Opens a URL in the user's browser. */
  openExternal(url: string): Promise<void>
  /** Opens a path with the user's default application, resolving to an error message on failure. */
  openPath(path: string): Promise<string>
  /** Shows the path in the file manager. */
  showItemInFolder(path: string): void
}

export { electronShellHost as shellHost } from './electron/shellHost'
