import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import logger from '@shared/logger'
import {
  buildSystemEnvPromptSnapshot,
  type BuildSystemEnvPromptOptions
} from '@/lib/agentRuntime/systemEnvPromptBuilder'
import {
  buildVerificationPolicyPrompt,
  buildVerificationPolicySnapshot
} from '@/lib/agentRuntime/verificationPolicyPromptBuilder'

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} mock error`), { code })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function settleRefresh(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function envOptions(workdir: string): BuildSystemEnvPromptOptions {
  return {
    workdir,
    providerId: 'provider',
    modelId: 'model',
    now: new Date('2026-06-22T00:00:00Z'),
    platform: 'linux'
  }
}

describe('system prompt source snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
    vi.mocked(fs.promises.access).mockReset()
    vi.mocked(fs.promises.access).mockRejectedValue(fileError('ENOENT'))
    vi.mocked(fs.promises.readFile).mockReset()
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('caps the first env wait at 200ms and exposes the shared late result', async () => {
    const read = deferred<string>()
    vi.mocked(fs.promises.readFile).mockReturnValue(
      read.promise as ReturnType<typeof fs.promises.readFile>
    )
    const options = envOptions('/tmp/prm-002a-env-timeout')
    const deadlineAt = Date.now() + 1_000

    const first = buildSystemEnvPromptSnapshot({ ...options, deadlineAt })
    const second = buildSystemEnvPromptSnapshot({ ...options, deadlineAt })

    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect((await first).prompt).not.toContain('Instructions from:')
    expect((await second).prompt).not.toContain('Instructions from:')

    read.resolve('Late instructions.\n')
    await settleRefresh()

    const late = await buildSystemEnvPromptSnapshot(options)
    expect(late.prompt).toContain('Late instructions.')
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
  })

  it('retries a transient env failure at 30,000ms, not 29,999ms', async () => {
    vi.mocked(fs.promises.readFile)
      .mockRejectedValueOnce(fileError('EIO'))
      .mockResolvedValueOnce('Recovered instructions.\n')
    const options = envOptions('/tmp/prm-002a-env-retry')

    expect((await buildSystemEnvPromptSnapshot(options)).prompt).not.toContain('Instructions from:')
    await vi.advanceTimersByTimeAsync(29_999)
    await buildSystemEnvPromptSnapshot(options)
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const callers = await Promise.all([
      buildSystemEnvPromptSnapshot(options),
      buildSystemEnvPromptSnapshot(options)
    ])
    expect(callers[0].prompt).toContain('Recovered instructions.')
    expect(callers[1].prompt).toContain('Recovered instructions.')
    expect(fs.promises.readFile).toHaveBeenCalledTimes(2)
  })

  it('keeps AGENTS.md last-known-good until a later refresh succeeds', async () => {
    vi.mocked(fs.promises.readFile)
      .mockResolvedValueOnce('Instructions A.\n')
      .mockRejectedValueOnce(fileError('EIO'))
      .mockResolvedValueOnce('Instructions B.\n')
    const options = envOptions('/tmp/prm-002a-env-lkg')

    const initial = await buildSystemEnvPromptSnapshot(options)
    expect(initial.prompt).toContain('Instructions A.')

    await vi.advanceTimersByTimeAsync(30_000)
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toBe(initial.prompt)
    await settleRefresh()
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toBe(initial.prompt)

    await vi.advanceTimersByTimeAsync(30_000)
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toBe(initial.prompt)
    await settleRefresh()
    const refreshed = await buildSystemEnvPromptSnapshot(options)
    expect(refreshed.prompt).toContain('Instructions B.')
    expect(refreshed.revision).not.toBe(initial.revision)
  })

  it('digests rendered bytes and treats missing, empty, and whitespace instructions alike', async () => {
    vi.mocked(fs.promises.readFile)
      .mockRejectedValueOnce(fileError('ENOENT'))
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('  \n')
      .mockResolvedValueOnce('Use the source truth.\n')
    const options = envOptions('/tmp/prm-002a-env-rendered-revision')

    const missing = await buildSystemEnvPromptSnapshot(options)
    expect(missing.revision).toBe(createHash('sha256').update(missing.prompt, 'utf8').digest('hex'))

    await vi.advanceTimersByTimeAsync(30_000)
    await buildSystemEnvPromptSnapshot(options)
    await settleRefresh()
    const empty = await buildSystemEnvPromptSnapshot(options)

    await vi.advanceTimersByTimeAsync(30_000)
    await buildSystemEnvPromptSnapshot(options)
    await settleRefresh()
    const whitespace = await buildSystemEnvPromptSnapshot(options)

    expect(empty.prompt).toBe(missing.prompt)
    expect(whitespace.prompt).toBe(missing.prompt)
    expect(empty.revision).toBe(missing.revision)
    expect(whitespace.revision).toBe(missing.revision)

    await vi.advanceTimersByTimeAsync(30_000)
    await buildSystemEnvPromptSnapshot(options)
    await settleRefresh()
    const changed = await buildSystemEnvPromptSnapshot(options)
    expect(changed.prompt).toContain('Use the source truth.')
    expect(changed.revision).not.toBe(missing.revision)
  })

  it('does not repeat fresh AGENTS.md reads or git marker scans', async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue('Cached instructions.\n')
    vi.mocked(fs.promises.access).mockImplementation(async (candidate) => {
      if (String(candidate) === '/tmp/prm-002a-env-fresh/.git') {
        return
      }
      throw fileError('ENOENT')
    })
    const options = envOptions('/tmp/prm-002a-env-fresh')

    const first = await buildSystemEnvPromptSnapshot(options)
    const accessCount = vi.mocked(fs.promises.access).mock.calls.length
    const second = await buildSystemEnvPromptSnapshot(options)

    expect(first.prompt).toContain('Is directory a git repo: yes')
    expect(second).toEqual(first)
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
    expect(fs.promises.access).toHaveBeenCalledTimes(accessCount)
  })

  it('shares an in-flight git marker scan across callers', async () => {
    const marker = deferred<void>()
    vi.mocked(fs.promises.readFile).mockRejectedValue(fileError('ENOENT'))
    vi.mocked(fs.promises.access).mockReturnValue(
      marker.promise as ReturnType<typeof fs.promises.access>
    )
    const options = envOptions('/tmp/prm-002a-git-pending')
    const deadlineAt = Date.now() + 200

    const first = buildSystemEnvPromptSnapshot({ ...options, deadlineAt })
    const second = buildSystemEnvPromptSnapshot({ ...options, deadlineAt })
    expect(fs.promises.access).toHaveBeenCalledTimes(1)

    marker.resolve()
    expect((await first).prompt).toContain('Is directory a git repo: yes')
    expect((await second).prompt).toContain('Is directory a git repo: yes')
    expect(fs.promises.access).toHaveBeenCalledTimes(1)
  })

  it('keeps the git marker last-known-good through a transient scan failure', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(fileError('ENOENT'))
    let markerState: 'present' | 'error' | 'missing' = 'present'
    vi.mocked(fs.promises.access).mockImplementation(async (candidate) => {
      if (markerState === 'error') {
        throw fileError('EIO')
      }
      if (markerState === 'present' && String(candidate) === '/tmp/prm-002a-git-lkg/.git') {
        return
      }
      throw fileError('ENOENT')
    })
    const options = envOptions('/tmp/prm-002a-git-lkg')

    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toContain(
      'Is directory a git repo: yes'
    )

    markerState = 'error'
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toContain(
      'Is directory a git repo: yes'
    )
    await settleRefresh()
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toContain(
      'Is directory a git repo: yes'
    )

    markerState = 'missing'
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toContain(
      'Is directory a git repo: yes'
    )
    await settleRefresh()
    expect((await buildSystemEnvPromptSnapshot(options)).prompt).toContain(
      'Is directory a git repo: no'
    )
  })

  it('aborts one env waiter without cancelling the shared source read', async () => {
    const read = deferred<string>()
    vi.mocked(fs.promises.readFile).mockReturnValue(
      read.promise as ReturnType<typeof fs.promises.readFile>
    )
    const options = envOptions('/tmp/prm-002a-env-abort')
    const controller = new AbortController()
    const deadlineAt = Date.now() + 200

    const aborted = buildSystemEnvPromptSnapshot({
      ...options,
      signal: controller.signal,
      deadlineAt
    })
    const surviving = buildSystemEnvPromptSnapshot({ ...options, deadlineAt })
    controller.abort()

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    read.resolve('Shared instructions.\n')
    await expect(surviving).resolves.toMatchObject({
      prompt: expect.stringContaining('Shared instructions.')
    })
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
  })

  it('keeps package last-known-good through parse failure and retries on its boundary', async () => {
    vi.mocked(fs.promises.readFile)
      .mockResolvedValueOnce('{"name":"DeepChat","scripts":{}}')
      .mockResolvedValueOnce('{broken')
      .mockResolvedValueOnce('{"name":"other","scripts":{"test":"vitest"}}')
    const options = { workdir: '/tmp/prm-002a-package-parse' }

    const initial = await buildVerificationPolicySnapshot(options)
    expect(initial.prompt).toContain('In the DeepChat repository')

    await vi.advanceTimersByTimeAsync(30_000)
    expect((await buildVerificationPolicySnapshot(options)).prompt).toBe(initial.prompt)
    await settleRefresh()
    expect((await buildVerificationPolicySnapshot(options)).prompt).toBe(initial.prompt)
    expect(logger.warn).toHaveBeenCalledWith(
      '[VerificationPolicyPromptBuilder] Failed to read package.json',
      expect.objectContaining({
        code: 'INVALID_PACKAGE_JSON',
        message: 'package.json contains invalid JSON'
      })
    )
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('{broken')

    await vi.advanceTimersByTimeAsync(29_999)
    await buildVerificationPolicySnapshot(options)
    expect(fs.promises.readFile).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect((await buildVerificationPolicySnapshot(options)).prompt).toBe(initial.prompt)
    await settleRefresh()
    expect((await buildVerificationPolicySnapshot(options)).prompt).toContain('`test`')
    expect(fs.promises.readFile).toHaveBeenCalledTimes(3)
  })

  it('changes package revision only when the rendered verification policy changes', async () => {
    vi.mocked(fs.promises.readFile)
      .mockResolvedValueOnce('{"name":"other","scripts":{"test":"vitest"}}')
      .mockResolvedValueOnce('{"name":"other","description":"no-op","scripts":{"test":"vitest"}}')
      .mockResolvedValueOnce(
        '{"name":"other","description":"changed","scripts":{"test":"vitest","lint":"oxlint"}}'
      )
    const options = { workdir: '/tmp/prm-002a-package-revision' }

    const initial = await buildVerificationPolicySnapshot(options)
    expect(initial.revision).toBe(createHash('sha256').update(initial.prompt, 'utf8').digest('hex'))

    await vi.advanceTimersByTimeAsync(30_000)
    await buildVerificationPolicySnapshot(options)
    await settleRefresh()
    const noOp = await buildVerificationPolicySnapshot(options)
    expect(noOp.prompt).toBe(initial.prompt)
    expect(noOp.revision).toBe(initial.revision)

    await vi.advanceTimersByTimeAsync(30_000)
    await buildVerificationPolicySnapshot(options)
    await settleRefresh()
    const relevant = await buildVerificationPolicySnapshot(options)
    expect(relevant.prompt).toContain('`test`, `lint`')
    expect(relevant.revision).not.toBe(initial.revision)
  })

  it('treats package missing as a successful observation and preserves the string wrapper', async () => {
    vi.mocked(fs.promises.readFile)
      .mockRejectedValueOnce(fileError('ENOENT'))
      .mockResolvedValueOnce('{"name":"DeepChat","scripts":{}}')
      .mockRejectedValueOnce(fileError('ENOTDIR'))
    const workdir = '/tmp/prm-002a-package-missing'

    const missing = await buildVerificationPolicySnapshot({ workdir })
    expect(missing.prompt).not.toContain('In the DeepChat repository')
    expect(await buildVerificationPolicyPrompt(workdir)).toBe(missing.prompt)

    await vi.advanceTimersByTimeAsync(30_000)
    await buildVerificationPolicySnapshot({ workdir })
    await settleRefresh()
    const present = await buildVerificationPolicySnapshot({ workdir })
    expect(present.prompt).toContain('In the DeepChat repository')

    await vi.advanceTimersByTimeAsync(30_000)
    await buildVerificationPolicySnapshot({ workdir })
    await settleRefresh()
    const missingAgain = await buildVerificationPolicySnapshot({ workdir })
    expect(missingAgain.prompt).toBe(missing.prompt)
    expect(missingAgain.revision).toBe(missing.revision)
  })

  it('shares package pending reads and lets one waiter abort independently', async () => {
    const read = deferred<string>()
    vi.mocked(fs.promises.readFile).mockReturnValue(
      read.promise as ReturnType<typeof fs.promises.readFile>
    )
    const workdir = '/tmp/prm-002a-package-abort'
    const controller = new AbortController()
    const deadlineAt = Date.now() + 200

    const aborted = buildVerificationPolicySnapshot({
      workdir,
      signal: controller.signal,
      deadlineAt
    })
    const surviving = buildVerificationPolicySnapshot({ workdir, deadlineAt })
    controller.abort()

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    read.resolve('{"name":"DeepChat","scripts":{}}')
    await expect(surviving).resolves.toMatchObject({
      prompt: expect.stringContaining('In the DeepChat repository')
    })
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
  })

  it('bounds parallel env and verification lookups by one absolute deadline', async () => {
    const envRead = deferred<string>()
    const packageRead = deferred<string>()
    vi.mocked(fs.promises.readFile).mockImplementation((candidate) => {
      return (String(candidate).endsWith('AGENTS.md') ? envRead.promise : packageRead.promise) as
        | ReturnType<typeof fs.promises.readFile>
        | never
    })
    const deadlineAt = Date.now() + 200

    const snapshots = Promise.all([
      buildSystemEnvPromptSnapshot({
        ...envOptions('/tmp/prm-002a-shared-deadline'),
        deadlineAt
      }),
      buildVerificationPolicySnapshot({
        workdir: '/tmp/prm-002a-shared-deadline',
        deadlineAt
      })
    ])

    await vi.advanceTimersByTimeAsync(199)
    let settled = false
    void snapshots.then(() => {
      settled = true
    })
    await settleRefresh()
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const [env, verification] = await snapshots
    expect(Date.now()).toBe(new Date('2026-07-10T00:00:00Z').getTime() + 200)
    expect(env.prompt).not.toContain('Instructions from:')
    expect(verification.prompt).not.toContain('In the DeepChat repository')

    envRead.resolve('Late env.\n')
    packageRead.resolve('{"name":"DeepChat","scripts":{}}')
    await settleRefresh()
    expect(
      (await buildSystemEnvPromptSnapshot(envOptions('/tmp/prm-002a-shared-deadline'))).prompt
    ).toContain('Late env.')
    expect(
      (
        await buildVerificationPolicySnapshot({
          workdir: '/tmp/prm-002a-shared-deadline'
        })
      ).prompt
    ).toContain('In the DeepChat repository')
    expect(fs.promises.readFile).toHaveBeenCalledTimes(2)
  })

  it('does not read package.json when workdir is absent or while a source entry is fresh', async () => {
    const staticSnapshot = await buildVerificationPolicySnapshot({ workdir: null })
    expect(staticSnapshot.prompt).toContain('## Verification Policy')
    expect(fs.promises.readFile).not.toHaveBeenCalled()

    vi.mocked(fs.promises.readFile).mockResolvedValue('{"scripts":{"test":"vitest"}}')
    const options = { workdir: '/tmp/prm-002a-package-fresh' }
    const first = await buildVerificationPolicySnapshot(options)
    const second = await buildVerificationPolicySnapshot(options)
    expect(second).toEqual(first)
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1)
  })
})
