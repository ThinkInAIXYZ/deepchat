import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { CoreRuntimeConnection, createCoreProfileNative } from '@/harness/core'
import { CoreDesktopNative } from '@/harness/desktop'
import { CoreBrowserNative } from '@/harness/browser'
import { CoreHelperNative } from '@/harness/helpers'
import { HarnessRuntime } from '@/harness/runtime'
import {
  DEFAULT_AGENT_INVOCATION_CAPACITY,
  DEFAULT_AGENT_INVOCATION_MAX_PENDING
} from '@shared/harness/admission'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import { createHeadlessHelperFactories } from './helpers'
import { createHeadlessNative } from './native'
import { loadLocalControlDescriptor } from '../cli/discovery'

declare const __DEEPCHAT_HOST_VERSION__: string

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(
      'Usage: node index.mjs --profile <directory>\n\n' +
        'Requires Node 24.22.1 or later in the Node 24 series.\n' +
        'DEEPCHAT_HOST_KEY: base64-encoded 32-byte credential master key (required).\n' +
        'DEEPCHAT_HOST_DATABASE_PASSWORD: manual database unlock password (optional).\n' +
        'Use DEEPCHAT_USER_DATA_DIR=<directory> node cli/deepchat.mjs <command>.\n' +
        'The host stays running after clients disconnect; SIGINT/SIGTERM drains and stops it.\n' +
        'Sensitive CLI mutations require confirmation on the host terminal.\n'
    )
    return
  }
  if (args.length !== 2 || args[0] !== '--profile' || !args[1]?.trim())
    throw new Error('Usage: node index.mjs --profile <directory>')
  const [major, minor, patch] = process.versions.node.split('.').map(Number)
  if (process.versions.electron || major !== 24 || minor < 22 || (minor === 22 && patch < 1))
    throw new Error('Headless requires Node >=24.22.1 <25')
  const encodedKey = process.env.DEEPCHAT_HOST_KEY
  const databasePassword = process.env.DEEPCHAT_HOST_DATABASE_PASSWORD
  delete process.env.DEEPCHAT_HOST_KEY
  delete process.env.DEEPCHAT_HOST_DATABASE_PASSWORD
  const masterKey = Buffer.from(encodedKey ?? '', 'base64')
  if (masterKey.length !== 32 || masterKey.toString('base64') !== encodedKey) {
    masterKey.fill(0)
    throw new Error('DEEPCHAT_HOST_KEY must be a canonical base64-encoded 32-byte key')
  }
  const directory = path.dirname(fileURLToPath(import.meta.url))
  const profileDirectory = path.resolve(args[1])
  process.env.DEEPCHAT_USER_DATA_DIR = profileDirectory
  delete process.env.DEEPCHAT_E2E_USER_DATA_DIR
  process.env.DEEPCHAT_HARNESS_EXECUTABLE = path.join(
    directory,
    'harness',
    `deepchat-harness-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
  )
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-host-'))
  const stopped = Promise.withResolvers<void>()
  let runtime: HarnessRuntime | undefined
  let connection: CoreRuntimeConnection | undefined
  let helpers: CoreHelperNative | undefined
  let desktop: CoreDesktopNative | undefined
  let browser: CoreBrowserNative | undefined
  let stopping: Promise<void> | undefined
  let stopRequested = false
  let promptActive = false
  const requestApproval = async (
    payload: DeepchatEventPayload<'approvals.requested'>,
    signal: AbortSignal
  ): Promise<'approved' | 'denied'> => {
    if (promptActive) throw new Error('The host terminal already has a pending approval')
    promptActive = true
    let terminal: ReturnType<typeof createInterface> | undefined
    try {
      terminal = createInterface({ input: process.stdin, output: process.stderr })
      const failure = new AbortController()
      terminal.on('error', (error) => failure.abort(error))
      const deadline = AbortSignal.timeout(Math.max(1, payload.expiresAt - Date.now()))
      const answer = await terminal.question(
        `${JSON.stringify(payload)}\nType approve ${payload.requestId} to allow: `,
        { signal: AbortSignal.any([signal, deadline, failure.signal]) }
      )
      return answer.trim() === `approve ${payload.requestId}` ? 'approved' : 'denied'
    } finally {
      terminal?.close()
      process.stdin.pause()
      promptActive = false
    }
  }
  const native = (() => {
    try {
      return createHeadlessNative({
        profileDirectory,
        temporaryDirectory,
        masterKey,
        databasePassword,
        publishEvent() {},
        requestApproval: process.stdin.isTTY && process.stderr.isTTY ? requestApproval : undefined,
        quit: async () => {
          throw new Error('Profile startup requires manual recovery; the profile was preserved')
        }
      })
    } finally {
      masterKey.fill(0)
    }
  })()
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopRequested = true
    stopping = (async () => {
      const errors: unknown[] = []
      const retire = async (action: () => unknown) => {
        try {
          await action()
        } catch (error) {
          errors.push(error)
        }
      }
      await retire(() => connection?.stop())
      await retire(() => helpers?.close())
      await retire(() => browser?.close())
      await retire(() => desktop?.close())
      await retire(() => runtime?.stop())
      await retire(() => connection?.closeAfterHostExit())
      await retire(() => native.close())
      await retire(() => rm(temporaryDirectory, { recursive: true, force: true }))
      if (errors.length) {
        process.exitCode = 1
        process.stderr.write('Headless shutdown encountered an owner retirement failure\n')
      }
      stopped.resolve()
    })()
    return stopping
  }
  const failed = (error: Error) => {
    if (stopRequested) return
    stopRequested = true
    process.exitCode = 1
    process.stderr.write(`Headless Core failed: ${error.message}\n`)
    void stop()
  }
  const onSignal = () => {
    stopRequested = true
    if (runtime) void stop()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    runtime = await HarnessRuntime.start({
      directory: path.join(directory, 'harness'),
      electronExecutable: process.execPath,
      capacity: DEFAULT_AGENT_INVOCATION_CAPACITY,
      maxPending: DEFAULT_AGENT_INVOCATION_MAX_PENDING,
      observe() {}
    })
    if (stopRequested) throw new Error('Headless startup was stopped')
    helpers = new CoreHelperNative(
      createHeadlessHelperFactories({ directory, profileDirectory }),
      async (events) => await connection!.deliverNativeEvents(events),
      failed
    )
    desktop = new CoreDesktopNative(
      native.kernel,
      async (event) => await connection!.deliverDesktopEvent(event),
      native.close,
      failed
    )
    browser = new CoreBrowserNative(
      {
        getToolDefinitions: () => [],
        callTool: async () => {
          throw new Error('Desktop browser capability is unavailable on a headless host')
        }
      },
      async (event) => await connection!.deliverBrowserEvent(event),
      async () => {},
      failed
    )
    const profileNative = createCoreProfileNative(native.crypto, native.profileHost)
    connection = await CoreRuntimeConnection.connect({
      runtime,
      temporaryDirectory,
      onFailure: failed,
      native: async (method, input) => {
        if (method === 'core.failure')
          throw new Error('Headless Core reported a capability failure')
        if (method === 'helpers') return await helpers!.invoke(input)
        if (method === 'desktop') return await desktop!.invoke(input)
        if (method === 'browser') return await browser!.invoke(input)
        if (method === 'configuration') return await native.configuration(method, input)
        return await profileNative(method, input)
      }
    })
    if (stopping) throw new Error('Headless startup was stopped')
    await connection.openProfile({
      userDataDirectory: profileDirectory,
      homeDirectory: os.homedir(),
      currentAppVersion: __DEEPCHAT_HOST_VERSION__,
      systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,
      appPath: directory,
      isPackaged: false
    })
    await connection.configure({ operation: 'initialize' })
    await connection.assembleKernel({
      temporaryDirectory,
      appDataDirectory: profileDirectory,
      documentsDirectory: null,
      projectHomeDirectory: os.homedir(),
      resourcesPath: path.join(directory, 'resources'),
      workingDirectory: process.cwd(),
      builtinSkillsDirectories: [path.join(directory, 'resources', 'skills')],
      providerCatalogPath: path.join(directory, 'resources', 'model-db', 'providers.json'),
      allowInsecureTls: false
    })
    const status = await connection.startKernel()
    const descriptor = await loadLocalControlDescriptor()
    if (descriptor.pid !== status.pid) throw new Error('Headless local control owner did not match')
    process.stdout.write(
      `${JSON.stringify({ ready: true, pid: process.pid, harnessPid: runtime.identity?.hostPid, profileDirectory })}\n`
    )
    await stopped.promise
  } finally {
    await stop()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

void main().catch((error: unknown) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.message : 'Headless startup failed'}\n`)
})
