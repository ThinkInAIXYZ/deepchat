import type { DeepchatRouteName } from '@shared/contracts/routes'

const PRESENTATION_ROUTES = new Set<string>([
  'window.getCurrentState',
  'window.getRuntimeIdentity',
  'window.minimizeCurrent',
  'window.toggleMaximizeCurrent',
  'window.closeCurrent',
  'window.closeFloatingCurrent',
  'window.closeSettings',
  'device.getInfo',
  'device.getAppVersion',
  'databaseSecurity.getStatus',
  'approvals.resolve',
  'cli.status',
  'cli.version',
  'cli.capabilities'
] satisfies DeepchatRouteName[])

const MAINTENANCE_ROUTES = new Set<string>([
  'sync.import',
  'sync.pullFromCloud',
  'databaseSecurity.enable',
  'databaseSecurity.changePassword',
  'databaseSecurity.disable',
  'databaseSecurity.repairSchema'
] satisfies DeepchatRouteName[])

const SHUTDOWN_ROUTES = new Set<string>([
  'device.restartApp',
  'device.resetDataByType'
] satisfies DeepchatRouteName[])

export class DatabaseRequestGate {
  private currentState: 'running' | 'maintenance' | 'failed' | 'stopping' = 'running'
  private activeRequests = 0
  private drainPromise: Promise<void> | null = null
  private onDrained: (() => void) | null = null
  private maintenanceCompletion: Promise<void> | null = null

  constructor(private readonly assertActive: () => void) {}

  get state(): 'running' | 'maintenance' | 'failed' | 'stopping' {
    return this.currentState
  }

  assertRouteAllowed(method: string): void {
    this.assertActive()
    if (this.currentState === 'stopping') throw new Error('App database owner is stopping')
    if (this.currentState === 'running' || PRESENTATION_ROUTES.has(method)) return
    if (method === 'sync.startBackup') throw new Error('sync.tunnel.error.busy')
    throw new Error(`App database maintenance is ${this.currentState}`)
  }

  async runRequest<T>(method: string, run: () => Promise<T>): Promise<T> {
    this.assertRouteAllowed(method)
    if (
      PRESENTATION_ROUTES.has(method) ||
      MAINTENANCE_ROUTES.has(method) ||
      SHUTDOWN_ROUTES.has(method)
    )
      return await run()
    return await this.trackRequest(run)
  }

  async runAuthorization<T>(method: string, run: () => Promise<T>): Promise<T> {
    this.assertRouteAllowed(method)
    if (PRESENTATION_ROUTES.has(method)) return await run()
    return await this.trackRequest(run)
  }

  private async trackRequest<T>(run: () => Promise<T>): Promise<T> {
    this.activeRequests++
    try {
      return await run()
    } finally {
      if (--this.activeRequests === 0) {
        const onDrained = this.onDrained
        this.onDrained = null
        onDrained?.()
      }
    }
  }

  beginMaintenance(): void {
    this.assertActive()
    if (this.currentState !== 'running')
      throw new Error(`App database maintenance is ${this.currentState}`)
    this.currentState = 'maintenance'
  }

  async runMaintenance<T>(run: () => Promise<T>): Promise<T> {
    if (this.maintenanceCompletion) throw new Error('Database maintenance is still completing')
    this.beginMaintenance()
    const pending = Promise.resolve().then(run)
    const finished = pending.then(
      () => undefined,
      () => undefined
    )
    this.maintenanceCompletion = finished
    try {
      return await pending
    } finally {
      if (this.maintenanceCompletion === finished) this.maintenanceCompletion = null
    }
  }

  beginShutdown(): void {
    this.currentState = 'stopping'
  }

  async drain(): Promise<void> {
    if (this.currentState !== 'maintenance') throw new Error('Database maintenance is not active')
    await this.drainRequests()
  }

  async drainForShutdown(): Promise<void> {
    if (this.currentState !== 'stopping') throw new Error('Database shutdown is not active')
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.all([this.drainRequests(), this.maintenanceCompletion]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for database shutdown (30000ms)')),
            30_000
          )
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  private async drainRequests(): Promise<void> {
    if (this.activeRequests === 0) return
    if (!this.drainPromise) {
      const pending = new Promise<void>((resolve, reject) => {
        const onDrained = () => {
          clearTimeout(timeout)
          resolve()
        }
        const timeout = setTimeout(() => {
          if (this.onDrained === onDrained) this.onDrained = null
          reject(new Error('Timed out waiting for database requests to drain (30000ms)'))
        }, 30_000)
        this.onDrained = onDrained
      }).finally(() => {
        if (this.drainPromise === pending) this.drainPromise = null
      })
      this.drainPromise = pending
    }
    await this.drainPromise
  }

  resume(): void {
    if (this.currentState !== 'maintenance' || this.drainPromise)
      throw new Error('Database maintenance cannot resume')
    this.currentState = 'running'
  }

  fail(): void {
    this.currentState = 'failed'
  }
}
