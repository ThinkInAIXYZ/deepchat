#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

assert.equal(process.versions.electron, undefined, 'Run this smoke with ordinary Node')
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-headless-smoke-'))
const distribution = path.join(directory, 'distribution')
const profile = path.join(directory, 'profile')
const descriptorPath = path.join(profile, 'local-control', 'local-control.json')
const home = path.join(directory, 'home')
const temporary = path.join(directory, 'tmp')
const children = []
const held = new Set()
const requests = new Map()
const key = randomBytes(32).toString('base64')
const env = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
)
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, 'roaming'),
  LOCALAPPDATA: path.join(home, 'local'),
  XDG_CONFIG_HOME: path.join(home, 'config'),
  XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_DATA_HOME: path.join(home, 'data'),
  XDG_RUNTIME_DIR: temporary,
  TMPDIR: temporary,
  TEMP: temporary,
  TMP: temporary,
  DEEPCHAT_USER_DATA_DIR: profile,
  NODE_OPTIONS: '',
  NODE_PATH: '',
  NO_PROXY: '127.0.0.1'
})

async function within(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 45_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function until(read, label) {
  const deadline = Date.now() + 45_000
  do {
    const value = await read()
    if (value) return value
    await delay(50)
  } while (Date.now() < deadline)
  throw new Error(label)
}
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
function launch() {
  const child = spawn(
    process.execPath,
    [path.join(distribution, 'index.mjs'), '--profile', profile],
    {
      cwd: directory,
      env: { ...env, DEEPCHAT_HOST_KEY: key },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  )
  const owner = { child, stdout: '', stderr: '', ready: null }
  child.stdout.on('data', (chunk) => {
    owner.stdout = (owner.stdout + chunk).slice(-65536)
    for (const line of owner.stdout.split('\n')) {
      try {
        const value = JSON.parse(line)
        if (value.ready === true) owner.ready = value
      } catch {}
    }
  })
  child.stderr.on('data', (chunk) => {
    owner.stderr = (owner.stderr + chunk).slice(-65536)
  })
  owner.exit = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  children.push(owner)
  return owner
}
async function boot() {
  const owner = launch()
  await until(() => {
    if (owner.child.exitCode !== null || owner.child.signalCode !== null)
      throw new Error(`Headless startup failed: ${owner.stderr}`)
    return owner.ready
  }, 'Headless did not become ready')
  assert.equal(owner.ready.pid, owner.child.pid)
  assert.equal(owner.ready.profileDirectory, profile)
  assert(Number.isSafeInteger(owner.ready.harnessPid))
  await access(descriptorPath)
  owner.corePid = (await cli('system', 'status')).pid
  assert.notEqual(owner.corePid, owner.child.pid)
  return owner
}
async function cli(...args) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(distribution, 'cli', 'deepchat.mjs'), ...args, '--json', '--timeout', '15000'],
    { cwd: directory, env, timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true }
  )
  const response = JSON.parse(stdout)
  assert.equal(response.ok, true, JSON.stringify(response))
  return response.result
}
async function submit(prompt) {
  const run = await cli(
    'agent',
    'run',
    '--agent',
    'deepchat',
    '--provider',
    'custom-headless-smoke',
    '--model',
    'headless-smoke',
    '--prompt',
    prompt,
    '--max-turns',
    '1'
  )
  assert.equal(typeof run.runId, 'string')
  return run.runId
}
async function snapshot(runId, predicate) {
  return await until(async () => {
    const value = await cli('run', 'get', '--run', runId)
    assert.equal(value.runId, runId)
    return predicate(value) && value
  }, `Run ${runId} did not reach its expected state`)
}
async function stop(owner, signal) {
  owner.child.kill(signal)
  const result = await within(owner.exit, 'Headless owner did not exit')
  assert.equal(result.error, undefined)
  if (signal !== 'SIGKILL' && process.platform !== 'win32') {
    assert.equal(result.code, 0, owner.stderr)
    assert.equal(result.signal, null)
  }
  for (const pid of [owner.child.pid, owner.ready.harnessPid, owner.corePid]) {
    await until(() => !alive(pid), `Owned process ${pid} survived shutdown`)
  }
}

const server = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  let body = ''
  try {
    for await (const chunk of request) body += chunk
  } catch {
    response.destroy()
    return
  }
  const input = JSON.parse(body)
  const prompt = JSON.stringify(input.messages)
  const marker = ['HEADLESS_CANCEL', 'HEADLESS_RESTART'].find((value) => prompt.includes(value))
  const common = { id: 'headless-fixture', created: 1, model: 'headless-smoke' }
  if (!input.stream)
    return response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(
        JSON.stringify({
          ...common,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'Headless smoke' }
            }
          ]
        })
      )
  const chunk = (content, finish_reason) =>
    `data: ${JSON.stringify({
      ...common,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason }]
    })}\n\n`
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(chunk(marker ? 'HEADLESS_PARTIAL' : 'HEADLESS_OK', null))
  if (!marker) return response.end(chunk('', 'stop') + 'data: [DONE]\n\n')
  held.add(marker)
  requests.set(marker, (requests.get(marker) ?? 0) + 1)
  response.once('close', () => held.delete(marker))
})

try {
  for (const target of [profile, home, temporary]) await mkdir(target, { recursive: true })
  await cp(path.join(repository, 'out', 'headless'), distribution, {
    recursive: true,
    dereference: true
  })
  await promisify(execFile)(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      "if(process.versions.electron)throw Error('Electron runtime');try{require.resolve('electron');throw Error('Electron resolved')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}"
    ],
    { cwd: distribution, env }
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  await writeFile(
    path.join(profile, 'app-settings.json'),
    JSON.stringify({
      init_complete: true,
      privacyModeEnabled: true,
      loggingEnabled: false,
      providers: [
        {
          id: 'custom-headless-smoke',
          name: 'Headless fixture',
          custom: true,
          apiType: 'openai-completions',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          apiKey: 'fixture-key',
          enable: true
        }
      ]
    })
  )
  await mkdir(path.join(profile, 'provider_models'))
  await writeFile(
    path.join(profile, 'provider_models', 'models_custom-headless-smoke.json'),
    JSON.stringify({
      models: [],
      custom_models: [
        {
          id: 'headless-smoke',
          name: 'Headless smoke',
          providerId: 'custom-headless-smoke',
          enabled: true,
          vision: false,
          functionCall: false,
          reasoning: false,
          contextLength: 32000,
          maxTokens: 1000
        }
      ]
    })
  )
  const first = await boot()
  const metadata = JSON.parse(await readFile(path.join(distribution, 'package.json'), 'utf8'))
  assert.equal((await cli('system', 'version')).appVersion, metadata.version)
  const contender = launch()
  const rejected = await within(contender.exit, 'A second profile owner was not rejected')
  assert.notEqual(rejected.code, 0)
  assert.equal(contender.ready, null)
  assert.match(contender.stderr, /already has an owner|CoreProfileOwnershipUnavailable/)
  const cancelled = await submit('HEADLESS_CANCEL')
  await until(() => held.has('HEADLESS_CANCEL'), 'Cancelled Run never entered the Provider')
  await snapshot(cancelled, (value) => value.phase === 'running')
  assert.equal((await cli('run', 'cancel', '--run', cancelled)).cancelRequested, true)
  await snapshot(cancelled, (value) => value.phase === 'terminal')
  assert.equal((await cli('run', 'cancel', '--run', cancelled)).cancelRequested, false)
  const interrupted = await submit('HEADLESS_RESTART')
  await until(() => held.has('HEADLESS_RESTART'), 'Interrupted Run never entered the Provider')
  await snapshot(interrupted, (value) =>
    value.messages.some((message) => message.role === 'assistant' && message.status === 'pending')
  )
  await stop(first, 'SIGKILL')
  const restarted = await boot()
  const recovered = await snapshot(interrupted, (value) => value.phase === 'terminal')
  assert(
    recovered.messages.some((message) => message.role === 'assistant' && message.status === 'error')
  )
  assert(
    recovered.messages.some(
      (message) => message.role === 'user' && message.text === 'HEADLESS_RESTART'
    )
  )
  assert.equal(requests.get('HEADLESS_RESTART'), 1, 'Recovery must not replay a Provider request')
  const completed = await submit('HEADLESS_COMPLETE')
  const result = await snapshot(
    completed,
    (value) =>
      value.phase === 'terminal' &&
      value.messages.some(
        (message) => message.role === 'assistant' && message.text === 'HEADLESS_OK'
      )
  )
  assert(
    result.messages.some(
      (message) => message.role === 'assistant' && message.text === 'HEADLESS_OK'
    )
  )
  await stop(restarted, 'SIGTERM')
  if (process.platform !== 'win32') {
    await assert.rejects(access(descriptorPath), { code: 'ENOENT' })
  } else {
    let staleDescriptor = false
    try {
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
      assert.equal(descriptor.pid, restarted.corePid)
      assert.equal(alive(descriptor.pid), false)
      staleDescriptor = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await assert.rejects(cli('system', 'status'), (error) => {
      const response = JSON.parse(error.stdout)
      assert.equal(response.error.code, 'unavailable')
      if (staleDescriptor) assert.match(response.error.message, /stopped process/)
      return true
    })
  }
  console.log(
    JSON.stringify({
      ok: true,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      gracefulSignal: process.platform !== 'win32',
      checks: [
        'outside-checkout',
        'no-electron',
        'ready',
        'version',
        'profile-exclusion',
        'run-query-cancel',
        'owner-death-recovery',
        'no-replay',
        'completed-run',
        'owned-process-cleanup'
      ]
    })
  )
} finally {
  server.closeAllConnections()
  for (const owner of children) {
    if (owner.child.exitCode === null && owner.child.signalCode === null)
      owner.child.kill('SIGKILL')
  }
  await Promise.allSettled(
    children.map((owner) => within(owner.exit, 'Smoke owner cleanup timed out'))
  )
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
