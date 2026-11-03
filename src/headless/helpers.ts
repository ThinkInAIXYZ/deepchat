import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { serialize } from 'node:v8'
import type { CoreHelperNative } from '@/harness/helpers'
import {
  CORE_HELPER_QUEUE,
  CORE_HELPER_QUEUE_BYTES,
  type CoreHelperKind
} from '@shared/harness/helpers'
import {
  ChildProcessRegistry,
  observeProcessIdentity
} from '@/agent/shared/process/childProcessRegistry'
import {
  terminateProcessTree,
  terminateProcessTreeByPid,
  waitForClose
} from '@/agent/shared/process/processTree'

type HelperFactories = ConstructorParameters<typeof CoreHelperNative>[0]

export interface HeadlessHelperOptions {
  profileDirectory: string
  directory?: string
  env?: NodeJS.ProcessEnv
  nodeExecutable?: string
}

export function createHeadlessHelperFactories(options: HeadlessHelperOptions): HelperFactories {
  const directory = options.directory ?? path.dirname(fileURLToPath(import.meta.url))
  if (!path.isAbsolute(directory) || !path.isAbsolute(options.profileDirectory))
    throw new Error('Headless helper directories must be absolute')
  const entry = path.join(directory, 'helper.mjs')
  const environment: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    DEEPCHAT_USER_DATA_DIR: options.profileDirectory
  }
  delete environment.DEEPCHAT_E2E_USER_DATA_DIR
  const registry = new ChildProcessRegistry({
    rootDir: path.join(options.profileDirectory, 'child-processes')
  })

  async function open(kind: CoreHelperKind, signal: AbortSignal) {
    signal.throwIfAborted()
    const env: NodeJS.ProcessEnv = {}
    if (kind === 'code') {
      for (const name of ['LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) {
        if (environment[name]) env[name] = environment[name]
      }
    } else Object.assign(env, environment)
    delete env.NODE_OPTIONS
    const child = fork(entry, [kind], {
      execPath: options.nodeExecutable ?? process.execPath,
      execArgv: kind === 'code' ? ['--max-old-space-size=64'] : [],
      env,
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: process.platform !== 'win32'
    })
    const events = new EventEmitter()
    const ready = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const pendingMessages: unknown[] = []
    const rss = new Map<string, ReturnType<typeof Promise.withResolvers<number | null>>>()
    let exitCode: number | undefined
    let ownerIdentity: string | undefined
    let retirement: Promise<void> | undefined
    let closing = false
    let listening = false
    let pendingBytes = 0
    let sending = 0
    let sendingBytes = 0
    const pid = child.pid

    child.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message) {
        if (message.type === 'deepchat-headless:ready') {
          ready.resolve()
          return
        }
        if (message.type === 'deepchat-headless:rss' && 'id' in message && 'bytes' in message) {
          if (typeof message.id === 'string') {
            const request = rss.get(message.id)
            if (request) {
              const bytes = message.bytes
              if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0)
                request.resolve(bytes)
              else request.reject(new Error('Invalid headless helper RSS reply'))
            }
          }
          return
        }
      }
      if (listening) events.emit('message', message)
      else {
        pendingBytes += serialize(message).length
        if (pendingMessages.length >= CORE_HELPER_QUEUE || pendingBytes > CORE_HELPER_QUEUE_BYTES) {
          fail(new Error('Headless helper startup message queue exceeded'))
        } else pendingMessages.push(message)
      }
    })
    child.once('close', (code) => {
      exitCode = code ?? 1
      closed.resolve()
      ready.reject(new Error(`Headless ${kind} helper exited during startup: ${exitCode}`))
      for (const request of rss.values()) request.resolve(null)
      events.emit('exit', exitCode)
    })
    child.on('error', (error) => {
      ready.reject(error)
      for (const request of rss.values()) request.reject(error)
      events.emit('helperError', error.name, error.message)
    })

    const fail = (error: Error) => {
      ready.reject(error)
      for (const request of rss.values()) request.reject(error)
      events.emit('helperError', error.name, error.message)
      void terminate().catch((retirementError) => {
        events.emit('helperError', 'HeadlessHelperRetirementError', String(retirementError))
      })
    }
    const send = (message: unknown) => {
      const bytes = serialize(message).length
      if (sending >= CORE_HELPER_QUEUE || sendingBytes + bytes > CORE_HELPER_QUEUE_BYTES)
        throw new Error('Headless helper send queue exceeded')
      sending++
      sendingBytes += bytes
      let released = false
      const release = () => {
        if (released) return
        released = true
        sending--
        sendingBytes -= bytes
      }
      try {
        child.send(message as Parameters<typeof child.send>[0], (error) => {
          release()
          if (error && !closing) fail(error)
        })
      } catch (error) {
        release()
        throw error
      }
    }
    const postMessage = (message: unknown) => {
      if (closing || !child.connected) throw new Error('Headless helper is stopping')
      try {
        send(message)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Headless helper send failed'))
        throw error
      }
    }
    const terminate = (): Promise<void> => {
      closing = true
      retirement ??= Promise.resolve().then(async () => {
        if (exitCode === undefined) {
          let requested = false
          if (child.connected) {
            try {
              send({ type: 'deepchat-headless:stop' })
              requested = true
            } catch {}
          }
          if (!requested || !(await waitForClose(child, 2000))) {
            if (!(await terminateProcessTree(child, { nativeIdentity: ownerIdentity })))
              throw new Error(`Headless ${kind} helper did not retire`)
          }
        }
        await closed.promise
        if (kind !== 'exec' || !pid) return
        if (
          ownerIdentity &&
          !(await terminateProcessTreeByPid(pid, {
            nativeIdentity: ownerIdentity,
            ownedGroup: false,
            graceMs: 2000
          }))
        )
          throw new Error('Headless exec helper descendants did not retire')
        const recovery = await registry.reapStale('background-exec', { ownerPid: pid })
        if (
          recovery.refused.length ||
          recovery.skipped.length ||
          registry.list('background-exec', pid).length
        )
          throw new Error('Owned headless background execution did not retire')
      })
      return retirement
    }
    const onAbort = () => ready.reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try {
      await ready.promise
      signal.throwIfAborted()
      if (kind === 'exec' && process.platform === 'darwin') {
        if (!pid) throw new Error('Headless exec helper has no owned PID')
        const observed = await observeProcessIdentity(pid)
        signal.throwIfAborted()
        if (!observed.alive || !observed.nativeIdentity || exitCode !== undefined)
          throw new Error('Headless exec helper has no native identity')
        ownerIdentity = observed.nativeIdentity
      }
      signal.throwIfAborted()
      if (exitCode !== undefined) throw new Error('Headless helper startup was retired')
    } catch (error) {
      await terminate()
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }

    const on: EventEmitter['on'] = (event, listener) => {
      events.on(event === 'error' ? 'helperError' : event, listener)
      if (event === 'message') {
        listening = true
        pendingBytes = 0
        for (const message of pendingMessages.splice(0)) events.emit('message', message)
      } else if (event === 'exit' && exitCode !== undefined) {
        const code = exitCode
        queueMicrotask(() => listener(code))
      }
      return events
    }
    return {
      pid,
      postMessage,
      onMessage: (listener: (message: unknown) => void) => void on('message', listener),
      onExit: (listener: (code: number) => void) => void on('exit', listener),
      onError: (listener: (kind: string, location: string) => void) => void on('error', listener),
      terminate,
      events,
      on,
      async getRssBytes(requestSignal: AbortSignal): Promise<number | null> {
        requestSignal.throwIfAborted()
        if (exitCode !== undefined) return null
        const id = randomUUID()
        const request = Promise.withResolvers<number | null>()
        const abort = () => request.reject(requestSignal.reason)
        rss.set(id, request)
        requestSignal.addEventListener('abort', abort, { once: true })
        try {
          requestSignal.throwIfAborted()
          postMessage({ type: 'deepchat-headless:rss', id })
          return await request.promise
        } finally {
          requestSignal.removeEventListener('abort', abort)
          rss.delete(id)
        }
      }
    }
  }

  return {
    async exec(signal) {
      const host = await open('exec', signal)
      return { ...host, kill: host.terminate }
    },
    async watcher(kind, signal) {
      return await open(kind, signal)
    },
    async scheduler(signal) {
      const host = await open('scheduler', signal)
      return { ...host, kill: host.terminate }
    },
    async code(signal) {
      const host = await open('code', signal)
      return {
        pid: host.pid,
        postMessage: host.postMessage,
        kill: host.terminate,
        on(event, listener) {
          host.on(event, listener)
        },
        off(event, listener) {
          host.events.off(event === 'error' ? 'helperError' : event, listener)
        },
        getRssBytes: host.getRssBytes
      }
    }
  }
}
