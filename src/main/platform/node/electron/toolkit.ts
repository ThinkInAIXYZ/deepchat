/**
 * The parts of `@electron-toolkit/utils` the app uses, for the Node sidecar.
 *
 * The package imports Electron at module load, so it cannot be required in a
 * plain Node process. Nothing here needs Electron: `is` is a computed flag and
 * `optimizer` only hooks Chromium keyboard shortcuts, which the shell owns.
 */
export const is = {
  dev: false,
  macOS: process.platform === 'darwin',
  windows: process.platform === 'win32',
  linux: process.platform === 'linux',
  main: true,
  renderer: false,
  usingAsar: false,
  mas: false
}

export const optimizer = {
  watchWindowShortcuts: (): void => undefined
}

export const electronApp = {
  setAppUserModelId: (): void => undefined,
  setAutoLaunch: (): void => undefined
}

export const platform = {
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
}
