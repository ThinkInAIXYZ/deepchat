export type SettingsLeaveRisk = 'clean' | 'dirty' | 'busy'

export type SettingsLeaveGuardSnapshot = Readonly<{
  risk: SettingsLeaveRisk
  promptOpen: boolean
  version: number
}>

export type SettingsLeaveGuardLease = Readonly<{
  setRisk(risk: SettingsLeaveRisk): void
  release(): void
}>

export type SettingsLeaveGuardRegistration = Readonly<{
  id: string
  onDiscard: () => void
}>

type SettingsLeaveGuardListener = (snapshot: SettingsLeaveGuardSnapshot) => void

type GuardEntry = {
  id: string
  risk: SettingsLeaveRisk
  onDiscard: () => void
}

type PendingLeaveRequest = {
  promise: Promise<boolean>
  resolve: (allowed: boolean) => void
}

export class SettingsLeaveGuard {
  private readonly entries = new Map<number, GuardEntry>()
  private readonly listeners = new Set<SettingsLeaveGuardListener>()
  private snapshot: SettingsLeaveGuardSnapshot = Object.freeze({
    risk: 'clean',
    promptOpen: false,
    version: 0
  })
  private entrySequence = 0
  private pendingRequest?: PendingLeaveRequest
  private discardInProgress = false

  getSnapshot(): SettingsLeaveGuardSnapshot {
    return this.snapshot
  }

  isBlocking(): boolean {
    return this.snapshot.risk !== 'clean'
  }

  subscribe(listener: SettingsLeaveGuardListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  register(registration: SettingsLeaveGuardRegistration): SettingsLeaveGuardLease {
    const id = registration.id.trim()
    if (!id) throw new TypeError('Settings leave guard ID must not be empty')

    const entryId = ++this.entrySequence
    const entry: GuardEntry = {
      id,
      risk: 'clean',
      onDiscard: registration.onDiscard
    }
    this.entries.set(entryId, entry)
    let released = false

    return Object.freeze({
      setRisk: (risk: SettingsLeaveRisk) => {
        if (released || entry.risk === risk) return
        if (risk !== 'clean' && risk !== 'dirty' && risk !== 'busy') {
          throw new TypeError('Settings leave risk is invalid')
        }
        entry.risk = risk
        this.reconcile()
      },
      release: () => {
        if (released) return
        released = true
        this.entries.delete(entryId)
        this.reconcile()
      }
    })
  }

  requestLeave(): Promise<boolean> {
    if (!this.isBlocking()) return Promise.resolve(true)

    let resolveRequest: (allowed: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
      resolveRequest = resolve
    })
    const supersededRequest = this.pendingRequest
    this.pendingRequest = { promise, resolve: resolveRequest }
    supersededRequest?.resolve(false)
    this.updateSnapshot(this.resolveRisk(), true)
    return promise
  }

  cancelLeave(): void {
    this.finishRequest(false)
  }

  discardAndLeave(): boolean {
    if (!this.pendingRequest || this.snapshot.risk !== 'dirty') return false

    const dirtyEntries = Array.from(this.entries.values()).filter((entry) => entry.risk === 'dirty')
    this.discardInProgress = true
    let failedEntry: GuardEntry | undefined
    try {
      for (const entry of dirtyEntries) {
        try {
          entry.onDiscard()
          entry.risk = 'clean'
        } catch (error) {
          failedEntry = entry
          console.error(`[SettingsLeaveGuard] discard failed for "${entry.id}"`, error)
          break
        }
      }
    } finally {
      this.discardInProgress = false
    }

    if (failedEntry) {
      failedEntry.risk = 'dirty'
      this.reconcile()
      return false
    }

    this.reconcile()
    return !this.pendingRequest
  }

  private reconcile(): void {
    const risk = this.resolveRisk()
    if (this.pendingRequest && risk === 'clean' && !this.discardInProgress) {
      this.finishRequest(true)
      return
    }
    this.updateSnapshot(risk, Boolean(this.pendingRequest))
  }

  private resolveRisk(): SettingsLeaveRisk {
    let hasDirtyEntry = false
    for (const entry of this.entries.values()) {
      if (entry.risk === 'busy') return 'busy'
      if (entry.risk === 'dirty') hasDirtyEntry = true
    }
    return hasDirtyEntry ? 'dirty' : 'clean'
  }

  private finishRequest(allowed: boolean): void {
    const pendingRequest = this.pendingRequest
    if (!pendingRequest) return
    this.pendingRequest = undefined
    this.updateSnapshot(this.resolveRisk(), false)
    pendingRequest.resolve(allowed)
  }

  private updateSnapshot(risk: SettingsLeaveRisk, promptOpen: boolean): void {
    if (this.snapshot.risk === risk && this.snapshot.promptOpen === promptOpen) return
    this.snapshot = Object.freeze({
      risk,
      promptOpen,
      version: this.snapshot.version + 1
    })
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(this.snapshot)
      } catch (error) {
        console.error('[SettingsLeaveGuard] listener failed', error)
      }
    }
  }
}

export const settingsLeaveGuard = new SettingsLeaveGuard()
