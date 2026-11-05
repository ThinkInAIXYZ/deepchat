import type { ShellHost } from '../shellHost'

/**
 * Shell host for a Node sidecar.
 *
 * Opening a URL, a folder or a file manager is the shell's job; the sidecar has
 * no way to do it and must not pretend it did. These calls therefore report what
 * was dropped instead of failing the caller, because they are reached from user
 * actions (open the log folder, open an OAuth page) where a thrown error would
 * surface as a broken dialog rather than a missing capability.
 */
const warn = (action: string, target: string): void => {
  console.warn(`[sidecar] ${action} is not available without the shell: ${target}`)
}

export const nodeShellHost: ShellHost = {
  async openExternal(url: string): Promise<void> {
    warn('openExternal', url)
  },

  async openPath(target: string): Promise<string> {
    warn('openPath', target)
    return 'Opening files is handled by the desktop shell'
  },

  showItemInFolder(target: string): void {
    warn('showItemInFolder', target)
  }
}

/** Canonical name so the build can swap this module in for the electron one. */
export const shellHost = nodeShellHost
