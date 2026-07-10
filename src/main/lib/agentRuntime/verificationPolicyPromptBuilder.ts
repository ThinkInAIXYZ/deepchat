import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import logger from '@shared/logger'

export interface BuildVerificationPolicySnapshotOptions {
  workdir?: string | null
  signal?: AbortSignal
  deadlineAt?: number
}

export interface VerificationPolicySnapshot {
  readonly prompt: string
  readonly revision: string
}

type PackageJsonManifest = {
  name?: unknown
  scripts?: Record<string, unknown>
}

type PackageSourceEntry = {
  hasLastKnownGood: boolean
  lastKnownGood?: VerificationPolicySnapshot
  pending?: Promise<void>
  settledAt: number
  nextAttemptAt: number
}

const SOURCE_READ_BUDGET_MS = 200
const SOURCE_REFRESH_INTERVAL_MS = 30_000
const packageSourceCache = new Map<string, PackageSourceEntry>()

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    signal.throwIfAborted()
  }
}

async function waitForPending(
  pending: Promise<void>,
  signal: AbortSignal | undefined,
  deadlineAt: number
): Promise<boolean> {
  throwIfAborted(signal)
  const remainingMs = Math.max(0, deadlineAt - Date.now())
  if (remainingMs === 0) {
    return false
  }

  return new Promise<boolean>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined
    let finished = false
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (settled: boolean) => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      resolve(settled)
    }
    const onAbort = () => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      reject(signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    timeout = setTimeout(() => finish(false), remainingMs)
    pending.then(
      () => finish(true),
      () => finish(true)
    )
  })
}

async function readPackageJsonManifest(
  packageJsonPath: string
): Promise<PackageJsonManifest | null> {
  let content: string
  try {
    content = await fs.promises.readFile(packageJsonPath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT' || nodeError.code === 'ENOTDIR') {
      return null
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    throw Object.assign(new Error('package.json contains invalid JSON'), {
      code: 'INVALID_PACKAGE_JSON'
    })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('package.json must contain a JSON object'), {
      code: 'INVALID_PACKAGE_JSON'
    })
  }
  return parsed as PackageJsonManifest
}

function startPackageRefresh(packageJsonPath: string, entry: PackageSourceEntry): Promise<void> {
  const pending = (async () => {
    try {
      const manifest = await readPackageJsonManifest(packageJsonPath)
      entry.lastKnownGood = createVerificationPolicySnapshot(manifest)
      entry.hasLastKnownGood = true
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      logger.warn('[VerificationPolicyPromptBuilder] Failed to read package.json', {
        packageJsonPath,
        code: nodeError.code,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      entry.settledAt = Date.now()
      entry.nextAttemptAt = entry.settledAt + SOURCE_REFRESH_INTERVAL_MS
      entry.pending = undefined
    }
  })()
  entry.pending = pending
  return pending
}

async function getPackageVerificationPolicySnapshot(
  packageJsonPath: string,
  signal: AbortSignal | undefined,
  deadlineAt: number
): Promise<VerificationPolicySnapshot> {
  throwIfAborted(signal)
  let entry = packageSourceCache.get(packageJsonPath)
  if (!entry) {
    entry = {
      hasLastKnownGood: false,
      settledAt: 0,
      nextAttemptAt: 0
    }
    packageSourceCache.set(packageJsonPath, entry)
  }

  const now = Date.now()
  if (!entry.pending && now >= entry.nextAttemptAt) {
    startPackageRefresh(packageJsonPath, entry)
  }

  if (entry.hasLastKnownGood) {
    return entry.lastKnownGood ?? BASE_VERIFICATION_POLICY_SNAPSHOT
  }

  if (entry.pending) {
    await waitForPending(entry.pending, signal, deadlineAt)
  }

  return entry.hasLastKnownGood
    ? (entry.lastKnownGood ?? BASE_VERIFICATION_POLICY_SNAPSHOT)
    : BASE_VERIFICATION_POLICY_SNAPSHOT
}

function getVerificationScriptNames(manifest: PackageJsonManifest | null): string[] {
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return []
  }

  return Object.entries(scripts)
    .filter(
      ([name, value]) => typeof name === 'string' && typeof value === 'string' && value.trim()
    )
    .map(([name]) => name)
}

function renderVerificationPolicyPrompt(manifest: PackageJsonManifest | null): string {
  const lines = [
    '## Verification Policy',
    'After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.',
    'If verification was not run, state the reason explicitly in the final response.'
  ]
  const verificationScripts = getVerificationScriptNames(manifest)
  const isDeepChatWorkspace =
    String(manifest?.name ?? '').toLowerCase() === 'deepchat' ||
    ['format', 'i18n', 'lint'].every((scriptName) => verificationScripts.includes(scriptName))

  if (isDeepChatWorkspace) {
    lines.push(
      'In the DeepChat repository, prioritize `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after feature work.'
    )
  } else if (verificationScripts.length > 0) {
    const suggestedScripts = verificationScripts
      .slice(0, 4)
      .map((scriptName) => `\`${scriptName}\``)
    lines.push(
      `When relevant, prefer project-local verification scripts such as ${suggestedScripts.join(', ')}.`
    )
  }

  return lines.join('\n')
}

function createVerificationPolicySnapshot(
  manifest: PackageJsonManifest | null
): VerificationPolicySnapshot {
  const prompt = renderVerificationPolicyPrompt(manifest)
  return {
    prompt,
    revision: createHash('sha256').update(prompt, 'utf8').digest('hex')
  }
}

const BASE_VERIFICATION_POLICY_SNAPSHOT = createVerificationPolicySnapshot(null)

export async function buildVerificationPolicySnapshot(
  options: BuildVerificationPolicySnapshotOptions = {}
): Promise<VerificationPolicySnapshot> {
  throwIfAborted(options.signal)
  const normalizedWorkdir = options.workdir?.trim()
  if (!normalizedWorkdir) {
    return BASE_VERIFICATION_POLICY_SNAPSHOT
  }

  const lookupStartedAt = Date.now()
  const deadlineAt = Math.min(
    options.deadlineAt ?? lookupStartedAt + SOURCE_READ_BUDGET_MS,
    lookupStartedAt + SOURCE_READ_BUDGET_MS
  )
  const packageJsonPath = path.join(path.resolve(normalizedWorkdir), 'package.json')
  const snapshot = await getPackageVerificationPolicySnapshot(
    packageJsonPath,
    options.signal,
    deadlineAt
  )
  throwIfAborted(options.signal)
  return snapshot
}

export async function buildVerificationPolicyPrompt(
  workdir: string | null,
  options: Omit<BuildVerificationPolicySnapshotOptions, 'workdir'> = {}
): Promise<string> {
  return (await buildVerificationPolicySnapshot({ ...options, workdir })).prompt
}
