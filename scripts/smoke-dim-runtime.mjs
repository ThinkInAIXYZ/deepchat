#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { verifyDimRuntime } from './package-dim-runtime.mjs'

const options = {}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]
  if (key === '--development') options.development = true
  else if (['--resources-path', '--runtime-root', '--report-path'].includes(key)) {
    const value = process.argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing ${key} value`)
    options[key.slice(2)] = path.resolve(value)
  } else throw new Error(`Unknown dim smoke option: ${key}`)
}
if (
  !!options['resources-path'] === !!options['runtime-root'] ||
  (options.development && options['resources-path'])
)
  throw new Error('Choose a packaged resources path or a development runtime root')
const runtimeRoot =
  options['runtime-root'] ?? path.join(options['resources-path'], 'app.asar.unpacked/runtime')
const runtime = await verifyDimRuntime({ runtimeRoot, development: options.development === true })
const { withNativeClient } = await import(
  pathToFileURL(path.join(runtime.plugins, 'modules/deepchat-host/native-client.mjs')).href
)
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-offline-'))
const home = path.join(temporary, 'home')
const address =
  process.platform === 'win32'
    ? `\\.\pipe\deepchat-dim-offline-${path.basename(temporary)}`
    : path.join(temporary, 'host.sock')
await mkdir(home)
const rowsFile = path.join(temporary, 'plugins.json')
await writeFile(
  rowsFile,
  JSON.stringify([
    {
      id: 'deepchat-host',
      name: path.join(runtime.plugins, 'modules/deepchat-host/index.mjs'),
      provides: {},
      config: { hostAddress: address, profile: 'product' }
    },
    {
      id: 'deepchat-storage',
      name: path.join(runtime.plugins, 'modules/deepchat-storage/index.mjs'),
      provides: {},
      config: { hostAddress: address, profile: 'product', rawHistory: true }
    }
  ]),
  { mode: 0o600 }
)
const child = spawn(
  runtime.native,
  [
    'app-server',
    '--home',
    home,
    '--no-ws',
    process.platform === 'win32' ? '--pipe' : '--unix',
    address,
    '--session-rows',
    rowsFile,
    '--node',
    runtime.node,
    '--js-runtime',
    runtime.jsRuntime,
    '--product-home',
    home
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: temporary }
)
let startupError
let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-65536)
})
const exited = new Promise((resolve) => {
  child.once('exit', resolve)
  child.once('error', (error) => {
    startupError = error
    resolve()
  })
})
const capabilities = [
  'deepchat.native.capabilities',
  'deepchat.host.capabilities',
  'deepchat.storage.capabilities'
]
let verified = false
try {
  const deadline = Date.now() + 60_000
  let result
  while (Date.now() < deadline) {
    if (startupError || child.exitCode !== null)
      throw new Error(
        `Packaged dim exited before startup: ${startupError?.message ?? child.exitCode}\n${stderr}`
      )
    try {
      result = await withNativeClient(
        address,
        { profile: 'product', methods: capabilities, timeoutMs: 2000 },
        (call) => Promise.all(capabilities.map((method) => call(method, {})))
      )
      break
    } catch {
      await delay(100)
    }
  }
  if (!result) throw new Error(`Packaged dim plugins did not become ready\n${stderr}`)
  if (
    result[0].bridgeVersion !== runtime.manifest.bridgeVersion ||
    result[0].sourceRevision !== runtime.manifest.sourceRevision ||
    result.some((entry) => entry.apiVersion !== 1)
  )
    throw new Error('Packaged dim capability identity mismatch')
  const agent = await withNativeClient(
    address,
    { profile: 'product', methods: ['deepchat.agent.ensure'] },
    (call) =>
      call('deepchat.agent.ensure', {
        name: 'Offline package verification',
        description: '',
        systemPrompt: 'Offline verification.',
        tools: []
      })
  )
  if (typeof agent.agentId !== 'string' || !agent.agentId)
    throw new Error('Packaged native Agent owner is unavailable')
  const report = {
    target: `${process.platform}-${process.arch}`,
    bridgeVersion: runtime.manifest.bridgeVersion,
    profile: runtime.manifest.profile,
    sha256: runtime.manifest.sha256,
    nodeSha256: runtime.nodeSha256,
    sourceRevision: runtime.manifest.sourceRevision,
    native: true,
    hostPlugin: true,
    storagePlugin: true,
    agentOwner: true
  }
  if (options['report-path']) {
    await mkdir(path.dirname(options['report-path']), { recursive: true })
    await writeFile(options['report-path'], JSON.stringify(report, null, 2) + '\n')
  }
  console.info(JSON.stringify(report))
  verified = true
} finally {
  let forced = false
  if (!startupError && child.exitCode === null) {
    await withNativeClient(
      address,
      { profile: 'product', methods: ['daemon.shutdown'], timeoutMs: 5000 },
      (call) => call('daemon.shutdown', {})
    ).catch(() => {})
    let timer
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 10_000)
      })
    ])
    clearTimeout(timer)
    if (child.exitCode === null) {
      forced = true
      child.kill('SIGKILL')
      await exited
    }
  }
  await rm(temporary, { recursive: true, force: true })
  if (verified && (forced || child.exitCode !== 0))
    throw new Error('Packaged native dim did not complete graceful shutdown')
}
