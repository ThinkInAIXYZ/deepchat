import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
}

export class DimRuntimeSupervisor {
  private process: ChildProcess | null = null
  private connection: DimPluginClient | null = null
  private starting: Promise<DimPluginClient> | null = null
  private stopping: Promise<void> | null = null
  private socketDirectory: string | null = null
  private exited: Promise<void> | null = null
  private exitCode: number | null = null

  constructor(private readonly options: DimRuntimeOptions) {}

  start(): Promise<DimPluginClient> {
    if (this.stopping) return this.stopping.then(() => this.start())
    if (this.starting) return this.starting
    if (this.connection) return Promise.resolve(this.connection)
    if (this.process && this.exitCode === null)
      return Promise.reject(new Error('dim connection was lost; stop the host before restarting'))
    const starting = this.terminate().then(() => this.launch())
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

  private async launch(): Promise<DimPluginClient> {
    const { runtimeRoot, profileRoot, nodeExecutable } = this.options
    const plugins = path.resolve(runtimeRoot, 'plugins')
    const lock = JSON.parse(await readFile(path.join(plugins, 'runtime-lock.json'), 'utf8'))
    if (lock.schemaVersion !== 1 || lock.protocolVersion !== 3 || lock.pluginApiVersion !== 1) {
      throw new Error('Unsupported dim runtime/plugin lock')
    }
    const target = `${process.platform}-${process.arch}`
    if (!lock.artifacts[target]) throw new Error(`Unsupported dim runtime target: ${target}`)
    const executable = path.resolve(
      runtimeRoot,
      'releases',
      `${lock.version}-${target}`,
      'bin',
      process.platform === 'win32' ? 'dimcode.exe' : 'dimcode'
    )
    const runtimeEntry = JSON.parse(
      await readFile(path.join(plugins, 'runtime-entry.json'), 'utf8')
    )
    const jsRuntime = path.resolve(plugins, runtimeEntry.relativePath)
    if (!jsRuntime.startsWith(plugins + path.sep))
      throw new Error('Invalid dim plugin runtime path')
    const home = path.resolve(profileRoot, 'dim')
    await mkdir(home, { recursive: true, mode: 0o700 })
    const rowsFile = path.join(home, 'deepchat-plugin-rows.json')
    await writeFile(
      rowsFile,
      JSON.stringify([
        {
          id: 'deepchat-host',
          name: path.join(plugins, 'modules/deepchat-host/index.mjs'),
          provides: {},
          config: {}
        },
        {
          id: 'deepchat-storage',
          name: path.join(plugins, 'modules/deepchat-storage/index.mjs'),
          provides: {},
          config: {}
        }
      ]),
      { mode: 0o600 }
    )
    let address: string
    if (process.platform === 'win32') address = `\\\\.\\pipe\\deepchat-dim-${randomUUID()}`
    else {
      this.socketDirectory = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-'))
      address = path.join(this.socketDirectory, 'host.sock')
    }
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
      for (const plugin of ['host', 'storage']) {
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
      this.connection = client
      client.once('disconnected', () => {
        if (this.connection === client) this.connection = null
      })
      return client
    } catch (error) {
      client?.close()
      await this.terminate()
      throw error
    }
  }

  private async shutdown(): Promise<void> {
    if (this.starting) await this.starting.catch(() => {})
    const client = this.connection
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
    if (!graceful && client) throw new Error('dim did not complete graceful shutdown')
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
  }
}
