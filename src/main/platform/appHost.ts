/**
 * Application boundary.
 *
 * The rest of main only needs *where things live* and *which version is
 * running*; process lifecycle (whenReady, quit, single-instance, protocol
 * registration) stays in `appMain.ts` because it is Electron's event loop, and a
 * mygo shell owns its own loop in Go.
 *
 * A mygo implementation maps these paths onto `mygo.App.Path(mygo.PathUserData)`
 * and friends, so the sidecar can keep resolving the same directories.
 */
export type AppPathName =
  | 'userData'
  | 'temp'
  | 'home'
  | 'appData'
  | 'documents'
  | 'logs'
  | 'desktop'
  | 'downloads'

export interface AppHost {
  /** Absolute path of a well-known directory, creating it when the platform does. */
  getPath(name: AppPathName): string
  /** Directory the app files live in; used to resolve bundled resources. */
  getAppPath(): string
  /** Marketing version such as `1.1.4-beta.9`. */
  getVersion(): string
  /** Application name. */
  getName(): string
  /** System locale tag such as `zh-Hans-CN`. */
  getLocale(): string
  /** Whether the app runs from a packaged bundle rather than a development build. */
  isPackaged(): boolean
  /** Bundled resources directory (`Contents/Resources` in a macOS app). */
  getResourcesPath(): string
}

export { electronAppHost as appHost } from './electron/appHost'
