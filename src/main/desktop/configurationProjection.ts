import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'

export class DesktopConfigurationProjection {
  private snapshot: NativeConfigurationSnapshot
  private acceptingWrites = true
  private readonly pendingWrites = new Set<Promise<void>>()

  constructor(
    initial: NativeConfigurationSnapshot,
    private readonly readNativeDarkMode: () => boolean,
    private readonly writeBounds: (bounds: FloatingButtonBounds) => Promise<void>
  ) {
    this.snapshot = structuredClone(initial)
  }

  apply(snapshot: NativeConfigurationSnapshot): void {
    if (
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.ownerId !== this.snapshot.ownerId ||
      snapshot.version <= this.snapshot.version
    )
      return
    this.snapshot = structuredClone(snapshot)
  }

  getLanguage() {
    return this.snapshot.language
  }
  getNotificationsEnabled() {
    return this.snapshot.notificationsEnabled
  }
  getCloseToQuit() {
    return this.snapshot.closeToQuit
  }
  getContentProtectionEnabled() {
    return this.snapshot.contentProtectionEnabled
  }
  getShortcutKeys() {
    return structuredClone(this.snapshot.shortcutKeys)
  }
  getFloatingButtonEnabled() {
    return this.snapshot.floatingButtonEnabled
  }
  getFloatingButtonBounds() {
    return structuredClone(this.snapshot.floatingButtonBounds)
  }
  getLoggingEnabled() {
    return this.snapshot.loggingEnabled
  }
  isPrivacyModeEnabled() {
    return this.snapshot.privacyModeEnabled
  }
  getChannel() {
    return this.snapshot.updateChannel
  }
  async getCurrentThemeIsDark(): Promise<boolean> {
    return this.readNativeDarkMode()
  }

  async setFloatingButtonBounds(bounds: FloatingButtonBounds): Promise<void> {
    if (!this.acceptingWrites) throw new Error('Native configuration writes are stopped')
    const pending = this.writeBounds(structuredClone(bounds))
    this.pendingWrites.add(pending)
    try {
      await pending
    } finally {
      this.pendingWrites.delete(pending)
    }
  }

  stopWrites(): void {
    this.acceptingWrites = false
  }
  startWrites(): void {
    if (this.pendingWrites.size) throw new Error('Native configuration writes are still draining')
    this.acceptingWrites = true
  }
  async drainWrites(): Promise<void> {
    await Promise.allSettled(this.pendingWrites)
  }
}
