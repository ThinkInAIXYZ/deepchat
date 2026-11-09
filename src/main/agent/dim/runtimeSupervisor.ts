import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { terminateProcessTree } from '../shared/process/processTree'
import { DimPluginClient, DimMethodError } from './pluginClient'

export interface DimRuntimeOptions {
  runtimeRoot: string
  profileRoot: string
  nodeExecutable: string
  // Explicit testing profile; production always uses its private product home.
  profile?: 'product' | 'mock'
  startupTimeoutMs?: number
  gatewayAddress?: string
  nativePlugins?: boolean
}

export class DimRuntimeSupervisor {
  private process: ChildProcess | null = null
  private connection: DimPluginClient | null = null
  private readonly scopedConnections = new Set<DimPluginClient>()
  private starting: Promise<DimPluginClient> | null = null
  private stopping: Promise<void> | null = null
  private socketDirectory: string | null = null
  private exited: Promise<void> | null = null
  private exitCode: number | null = null
  private address: string | null = null
  private identity: { version: string; protocolVersion: number; pluginApiVersion: number } | null =
    null

  constructor(private readonly options: DimRuntimeOptions) {}

  start(): Promise<DimPluginClient> {
    if (this.stopping) return this.stopping.then(() => this.start())
    if (this.starting) return this.starting
    if (this.connection) return Promise.resolve(this.connection)
    const starting =
      this.process && this.exitCode === null
        ? this.attach(this.address!, this.identity!)
        : this.terminate().then(() => this.launch())
    this.starting = starting
    void starting
      .finally(() => {
        if (this.starting === starting) this.starting = null
      })
      .catch(() => {})
    return starting
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    const stopping = this.shutdown()
    this.stopping = stopping
    void stopping
      .finally(() => {
        if (this.stopping === stopping) this.stopping = null
      })
      .catch(() => {})
    return stopping
  }

  /** A caller-owned connection: closing it cancels only its own auxiliary calls. */
  async openConnection(): Promise<DimPluginClient> {
    await this.start()
    const client = await DimPluginClient.connect(this.address!)
    try {
      const hello = await client.call<{
        serverVersion: string
        protocolVersion: number
        daemonProfile: { kind: string }
      }>('hello', { protocolVersion: 3, clientKind: 'other', clientName: 'DeepChat auxiliary' })
      if (
        hello.serverVersion !== this.identity?.version ||
        hello.protocolVersion !== 3 ||
        hello.daemonProfile.kind !== (this.options.profile ?? 'product')
      )
        throw new Error('dim auxiliary host identity mismatch')
      this.scopedConnections.add(client)
      client.once('disconnected', () => this.scopedConnections.delete(client))
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }

  private async launch(): Promise<DimPluginClient> {
    if (this.options.nativePlugins && this.options.profile === 'mock')
      throw new Error('Native product plugins require the product execution profile')
    const { runtimeRoot, profileRoot, nodeExecutable } = this.options
    const plugins = path.resolve(runtimeRoot, 'plugins')
    const lock = JSON.parse(await readFile(path.join(plugins, 'runtime-lock.json'), 'utf8'))
    if (lock.schemaVersion !== 1 || lock.protocolVersion !== 3 || lock.pluginApiVersion !== 1) {
      throw new Error('Unsupported dim runtime/plugin lock')
    }
    const target = `${process.platform}-${process.arch}`
    if (!lock.artifacts[target]) throw new Error(`Unsupported dim runtime target: ${target}`)
    let executable = path.resolve(
      runtimeRoot,
      'releases',
      `${lock.version}-${target}`,
      'bin',
      process.platform === 'win32' ? 'dimcode.exe' : 'dimcode'
    )
    let native: { serverVersion: string; sourceRevision: string; bridgeVersion: string } | null =
      null
    if (this.options.nativePlugins) {
      const directory = path.resolve(runtimeRoot, 'native', target)
      const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      const nativeLock = JSON.parse(
        await readFile(path.join(plugins, 'native-host-lock.json'), 'utf8')
      )
      const name = process.platform === 'win32' ? 'deepchat-dim-host.exe' : 'deepchat-dim-host'
      if (
        manifest.schemaVersion !== 1 ||
        manifest.target !== target ||
        manifest.executable !== name ||
        manifest.baseRelease !== lock.version ||
        manifest.sourceRevision !== lock.sourceCommit ||
        nativeLock.schemaVersion !== 1 ||
        nativeLock.baseRelease !== lock.version ||
        nativeLock.sourceRevision !== lock.sourceCommit ||
        manifest.serverVersion !== nativeLock.serverVersion ||
        manifest.bridgeVersion !== nativeLock.bridgeVersion ||
        manifest.cargoLockSha256 !== nativeLock.cargoLockSha256 ||
        manifest.assemblyPatch?.path !== nativeLock.assemblyPatch.path ||
        manifest.assemblyPatch?.sha256 !== nativeLock.assemblyPatch.sha256 ||
        manifest.apiVersion !== nativeLock.apiVersion ||
        manifest.apiVersion !== lock.pluginApiVersion
      )
        throw new Error('Invalid native dim plugin host manifest')
      executable = path.join(directory, name)
      const digest = createHash('sha256')
        .update(await readFile(executable))
        .digest('hex')
      if (digest !== manifest.sha256) throw new Error('Native dim plugin host checksum mismatch')
      native = manifest
    }
    const runtimeEntry = JSON.parse(
      await readFile(path.join(plugins, 'runtime-entry.json'), 'utf8')
    )
    const jsRuntime = path.resolve(plugins, runtimeEntry.relativePath)
    if (!jsRuntime.startsWith(plugins + path.sep))
      throw new Error('Invalid dim plugin runtime path')
    const home = path.resolve(profileRoot, 'dim')
    await mkdir(home, { recursive: true, mode: 0o700 })
    const rowsFile = path.join(home, 'deepchat-plugin-rows.json')
    let address: string
    if (process.platform === 'win32') address = `\\\\.\\pipe\\deepchat-dim-${randomUUID()}`
    else {
      this.socketDirectory = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-'))
      address = path.join(this.socketDirectory, 'host.sock')
    }
    await writeFile(
      rowsFile,
      JSON.stringify([
        {
          id: 'deepchat-host',
          name: path.join(plugins, 'modules/deepchat-host/index.mjs'),
          provides: {},
          config: {
            gatewayAddress: this.options.gatewayAddress,
            hostAddress: address,
            profile: this.options.profile ?? 'product'
          }
        },
        {
          id: 'deepchat-storage',
          name: path.join(plugins, 'modules/deepchat-storage/index.mjs'),
          provides: {},
          config: {
            hostAddress: address,
            profile: this.options.profile ?? 'product',
            rawHistory: native !== null
          }
        },
        ...(this.options.profile === 'mock'
          ? []
          : [
              {
                id: 'deepchat-model',
                name: path.join(plugins, 'modules/deepchat-host/model-calls.mjs'),
                provides: {},
                config: { hostAddress: address }
              }
            ])
      ]),
      { mode: 0o600 }
    )
    this.address = address
    const identity = native ? { ...lock, version: native.serverVersion, native } : lock
    this.identity = identity
    const args = [
      'app-server',
      '--home',
      path.join(home, 'rust'),
      '--no-ws',
      process.platform === 'win32' ? '--pipe' : '--unix',
      address,
      '--session-rows',
      rowsFile,
      '--node',
      path.resolve(nodeExecutable),
      '--js-runtime',
      jsRuntime
    ]
    if (this.options.profile === 'mock') args.push('--mock-model')
    else args.push('--product-home', home)
    if (native && this.options.gatewayAddress)
      args.push('--deepchat-gateway', this.options.gatewayAddress)
    const child = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true
    })
    this.process = child
    this.exitCode = null
    this.exited = new Promise((resolve) => {
      child.once('error', () => {
        this.exitCode = -1
        resolve()
      })
      child.once('exit', (code) => {
        this.exitCode = code ?? -1
        this.connection?.close()
        resolve()
      })
    })
    try {
      return await this.attach(address, identity)
    } catch (error) {
      await this.terminate()
      throw error
    }
  }

  private async attach(
    address: string,
    lock: {
      version: string
      protocolVersion: number
      pluginApiVersion: number
      native?: { sourceRevision: string; bridgeVersion: string }
    }
  ): Promise<DimPluginClient> {
    let client: DimPluginClient | null = null
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 30_000)
    try {
      while (!client) {
        if (this.exitCode !== null) throw new Error(`dim exited during startup (${this.exitCode})`)
        if (Date.now() >= deadline) throw new Error('dim startup timed out')
        try {
          client = await DimPluginClient.connect(address, 200)
        } catch {
          await delay(30)
        }
      }
      const hello = await client.call<{
        serverVersion: string
        protocolVersion: number
        daemonProfile: { kind: string }
      }>(
        'hello',
        {
          protocolVersion: 3,
          clientKind: 'other',
          clientName: 'DeepChat'
        },
        Math.max(1, deadline - Date.now())
      )
      if (
        hello.serverVersion !== lock.version ||
        hello.protocolVersion !== lock.protocolVersion ||
        hello.daemonProfile.kind !== (this.options.profile ?? 'product')
      ) {
        throw new Error('dim host version mismatch')
      }
      for (const plugin of [
        'host',
        'storage',
        ...(this.options.profile === 'mock' ? [] : ['model'])
      ]) {
        while (true) {
          if (Date.now() >= deadline) throw new Error(`dim ${plugin} plugin did not become ready`)
          try {
            const result = await client.call<{ apiVersion: number; plugin: string }>(
              `deepchat.${plugin}.capabilities`,
              {},
              Math.max(1, deadline - Date.now())
            )
            if (
              result.apiVersion !== lock.pluginApiVersion ||
              result.plugin !== `deepchat-${plugin}`
            ) {
              throw new Error(`Incompatible dim ${plugin} plugin`)
            }
            break
          } catch (error) {
            if (
              !(error instanceof DimMethodError) ||
              (error.code !== -32601 &&
                (error.data as { appError?: string } | undefined)?.appError !== 'service_reloading')
            )
              throw error
            await delay(30)
          }
        }
      }
      if (lock.native) {
        const capability = await client.call<{
          plugin: string
          apiVersion: number
          sourceRevision: string
          bridgeVersion: string
        }>('deepchat.native.capabilities')
        if (
          capability.plugin !== 'deepchat-native' ||
          capability.apiVersion !== lock.pluginApiVersion ||
          capability.sourceRevision !== lock.native.sourceRevision ||
          capability.bridgeVersion !== lock.native.bridgeVersion
        )
          throw new Error('Native dim plugin provenance mismatch')
      }
      this.connection = client
      client.once('disconnected', () => {
        if (this.connection === client) this.connection = null
      })
      return client
    } catch (error) {
      client?.close()
      throw error
    }
  }

  private async shutdown(): Promise<void> {
    if (this.starting) await this.starting.catch(() => {})
    for (const connection of this.scopedConnections) connection.close()
    let client = this.connection
    if (!client && this.process && this.exitCode === null && this.address && this.identity) {
      client = await this.attach(this.address, this.identity).catch(() => null)
    }
    const wasRunning = this.process !== null && this.exitCode === null
    this.connection = null
    let graceful = false
    try {
      if (client) {
        await client.call('daemon.shutdown', {}, 10_000)
        graceful = await Promise.race([
          this.exited!.then(() => this.exitCode === 0),
          delay(10_000, undefined, { ref: false }).then(() => false)
        ])
      }
    } finally {
      client?.close()
      await this.terminate()
    }
    if (!graceful && wasRunning) throw new Error('dim did not complete graceful shutdown')
  }

  private async terminate(): Promise<void> {
    const child = this.process
    if (child && this.exitCode === null) {
      if (!(await terminateProcessTree(child)))
        throw new Error('dim process tree did not terminate')
      await this.exited
    }
    this.process = null
    if (this.socketDirectory) await rm(this.socketDirectory, { recursive: true, force: true })
    this.socketDirectory = null
    this.address = null
    this.identity = null
  }
}
