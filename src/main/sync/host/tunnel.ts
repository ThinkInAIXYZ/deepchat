import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ChildProcessRegistry } from '@/agent/shared/process/childProcessRegistry'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import type { SyncTunnelConfig, SyncTunnelStatus } from '@shared/contracts/routes/syncHost.routes'

/** Owns only the connector launched by this profile. Tokens never enter arguments or logs. */
export class SyncTunnel {
  private child: ChildProcess | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly registry: ChildProcessRegistry
  private current: SyncTunnelStatus = { phase: 'stopped', publicUrl: '', error: null }

  constructor(
    private readonly directory: string,
    private readonly resolveBinary: () => string,
    private readonly changed?: () => void
  ) {
    this.registry = new ChildProcessRegistry({ rootDir: path.join(directory, 'processes') })
  }

  status(): SyncTunnelStatus {
    return { ...this.current }
  }

  async initialize(): Promise<void> {
    const reaped = await this.registry.reapStale('sync-tunnel')
    if (reaped.refused.length) throw new Error('sync.tunnel.error.tunnelStopFailed')
  }

  async start(config: SyncTunnelConfig, port: number, token?: string): Promise<void> {
    await this.stop()
    this.current = { phase: 'starting', publicUrl: config.publicUrl, error: null }
    try {
      await this.initialize()
      const executable = this.resolveBinary()
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const configPath = path.join(this.directory, 'connector.yml')
      // An explicit empty config prevents ~/.cloudflared settings leaking into this connector.
      await writeFile(configPath, '{}\n', { mode: 0o600 })
      const args = ['tunnel', '--config', configPath, '--no-autoupdate', '--protocol', 'auto']
      if (config.mode === 'named') {
        if (!token) throw new Error('missing token')
        args.push('run')
      } else {
        args.push('--url', `http://127.0.0.1:${port}`)
      }
      const env = { ...process.env }
      // Do not inherit a different tunnel identity from the launching shell.
      for (const key of Object.keys(env)) if (key.startsWith('TUNNEL_')) delete env[key]
      if (token) env.TUNNEL_TOKEN = token
      const child = spawn(executable, args, {
        env,
        cwd: this.directory,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child = child
      let buffer = ''
      const connections = new Set<string>()
      let syntheticEdgeIpAt = 0
      const consume = (chunk: Buffer) => {
        if (this.child !== child || this.current.phase === 'failed') return
        const previous = JSON.stringify(this.current)
        buffer = (buffer + chunk.toString()).slice(-8192)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (/\b198\.1[89]\.\d{1,3}\.\d{1,3}\b/.test(line)) syntheticEdgeIpAt = Date.now()
          if (config.mode === 'quick') {
            const url = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0]
            if (url) this.current.publicUrl = url
          }
          const index = line.match(/connIndex=(\d+)/)?.[1]
          if (index && line.includes('Registered tunnel connection')) {
            connections.add(index)
            syntheticEdgeIpAt = 0
          }
          if (
            index &&
            (line.includes('Unregistered tunnel connection') || line.includes('Serve tunnel error'))
          )
            connections.delete(index)
          const blocked =
            line.includes('TLS handshake with edge error') ||
            line.includes('HTTP/2 connection is blocked') ||
            line.includes('precheck complete hard_fail=true')
          if (blocked) {
            this.current.error =
              syntheticEdgeIpAt && Date.now() - syntheticEdgeIpAt < 60_000
                ? 'sync.tunnel.error.syntheticEdgeIp'
                : 'sync.tunnel.error.networkBlocked'
            syntheticEdgeIpAt = 0
          }
        }
        if (connections.size && this.current.publicUrl) {
          this.current.phase = 'connected'
          this.current.error = null
          this.clearTimer()
        } else {
          this.current.phase = 'starting'
        }
        if (previous !== JSON.stringify(this.current)) this.changed?.()
      }
      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)
      child.once('error', () => this.fail(child))
      child.once('close', () => {
        this.registry.clear('sync-tunnel', 'connector')
        this.fail(child)
      })
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      if (child.pid)
        await this.registry.record({
          subsystem: 'sync-tunnel',
          recordId: 'connector',
          pid: child.pid,
          commandLine: [executable, ...args],
          cwd: this.directory
        })
      if (this.child !== child) {
        this.registry.clear('sync-tunnel', 'connector')
        return
      }
      if (this.current.phase !== 'connected') {
        this.timer = setTimeout(() => {
          this.fail(child)
          void terminateProcessTree(child, { graceMs: 1000 })
        }, 60_000)
        this.timer.unref()
      }
    } catch {
      this.current.phase = 'failed'
      this.current.error = 'sync.tunnel.error.tunnelFailed'
      throw new Error(this.current.error)
    }
  }

  private fail(child: ChildProcess): void {
    if (this.child !== child) return
    this.clearTimer()
    this.current.phase = 'failed'
    this.current.error ??= 'sync.tunnel.error.tunnelFailed'
    this.changed?.()
    // Keep the handle until stop confirms termination, including a startup timeout.
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async stop(): Promise<void> {
    this.clearTimer()
    const child = this.child
    if (child) {
      const closed = await terminateProcessTree(child, { graceMs: 1000 })
      if (!closed) throw new Error('sync.tunnel.error.tunnelStopFailed')
      this.child = null
      this.registry.clear('sync-tunnel', 'connector')
    }
    this.current = { phase: 'stopped', publicUrl: '', error: null }
  }
}
