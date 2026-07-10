import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRuntimePresenter } from '@/presenter/agentRuntimePresenter'
import { SkillRuntimeUpdatingError } from '@shared/types/skill'
import type { PublishedSkillEntry, SkillMetadata, SkillRuntimeSnapshot } from '@shared/types/skill'
import type { MCPToolDefinition } from '@shared/types/core/mcp'

vi.mock('fs', async () => await vi.importActual('fs'))
vi.mock('path', async () => await vi.importActual('path'))
vi.mock('@/eventbus', () => ({ eventBus: { on: vi.fn() } }))
vi.mock('@/routes/publishDeepchatEvent', () => ({ publishDeepchatEvent: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

function createSkillEntry(
  metadata: SkillMetadata,
  content: string,
  allowedTools: string[]
): PublishedSkillEntry {
  return Object.freeze({
    sourceVersion: `${metadata.name}:${content}:${allowedTools.join(',')}`,
    availability: 'ready' as const,
    metadata: Object.freeze({ ...metadata, allowedTools: [...allowedTools] }),
    renderedContent: content,
    allowedTools: Object.freeze([...allowedTools]),
    scripts: Object.freeze([])
  })
}

function createSkillSnapshot(epoch: number, entry?: PublishedSkillEntry): SkillRuntimeSnapshot {
  return Object.freeze({
    epoch,
    entries: new Map(entry ? [[entry.metadata.name, entry]] : [])
  })
}

function createSqlitePresenter() {
  return {
    deepchatMessagesTable: { getByStatus: vi.fn(() => []) },
    deepchatPendingInputsTable: { listClaimed: vi.fn(() => []) },
    deepchatSessionsTable: { get: vi.fn(() => null) },
    newSessionsTable: {
      get: vi.fn(() => null),
      getDisabledAgentTools: vi.fn(() => [])
    }
  } as any
}

function createConfigPresenter() {
  return {
    getSkillsEnabled: vi.fn(() => true),
    getSkillDraftSuggestionsEnabled: vi.fn(() => false),
    resolveDeepChatAgentConfig: vi.fn(async () => ({})),
    getSetting: vi.fn(() => false),
    getProviderModels: vi.fn(() => []),
    getCustomModels: vi.fn(() => [])
  } as any
}

function createSkillPresenter(initialSnapshot: SkillRuntimeSnapshot) {
  let snapshot = initialSnapshot
  const presenter = {
    getMetadataList: vi.fn(async () =>
      Array.from(snapshot.entries.values()).map((entry) => entry.metadata as SkillMetadata)
    ),
    getActiveSkills: vi.fn(async () => Array.from(snapshot.entries.keys())),
    getPublishedRuntimeSnapshot: vi.fn(() => snapshot),
    waitForStableRuntimeSnapshot: vi.fn(async () => snapshot),
    loadSkillContent: vi.fn(),
    viewDraftSkill: vi.fn(),
    installDraftSkill: vi.fn(),
    discardDraftSkill: vi.fn(),
    setSnapshot(next: SkillRuntimeSnapshot) {
      snapshot = next
    }
  }
  return presenter
}

function createToolPresenter(
  onBuild?: (context: {
    activeSkillNames?: string[]
    skillRuntimeSnapshot?: SkillRuntimeSnapshot
  }) => void | Promise<void>
) {
  return {
    getAllToolDefinitions: vi.fn(
      async (context: {
        activeSkillNames?: string[]
        skillRuntimeSnapshot?: SkillRuntimeSnapshot
      }): Promise<MCPToolDefinition[]> => {
        await onBuild?.(context)
        const allowedTools = (context.activeSkillNames ?? []).flatMap(
          (name) => context.skillRuntimeSnapshot?.entries.get(name)?.allowedTools ?? []
        )
        return ['skill_view', ...allowedTools].map((name) => ({
          type: 'function' as const,
          source: 'agent' as const,
          function: { name, description: name, parameters: { type: 'object', properties: {} } },
          server: { name: 'agent-skills', icons: '', description: '' }
        }))
      }
    ),
    buildToolSystemPrompt: vi.fn(() => ''),
    syncAgentToolContext: vi.fn()
  }
}

function createRuntime(options: {
  skillPresenter: ReturnType<typeof createSkillPresenter>
  toolPresenter?: ReturnType<typeof createToolPresenter>
}) {
  const runtime = new AgentRuntimePresenter(
    {} as any,
    createConfigPresenter(),
    createSqlitePresenter(),
    (options.toolPresenter ?? createToolPresenter()) as any,
    undefined,
    { skillPresenter: options.skillPresenter as any }
  )
  ;(runtime as any).runtimeState.set('session-1', {
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-4',
    permissionMode: 'full_access'
  })
  ;(runtime as any).sessionAgentIds.set('session-1', 'deepchat')
  return runtime
}

async function buildPair(
  runtime: AgentRuntimePresenter,
  workdir: string,
  activeSkillNames: string[] = ['review']
) {
  return await (runtime as any).buildRuntimePromptToolPair(
    'session-1',
    'BASE',
    workdir,
    activeSkillNames,
    new AbortController().signal
  )
}

describe('system prompt cache coherence orchestration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'deepchat-prm-002c-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('observes a late real AGENTS.md source result on the next outer-cache lookup', async () => {
    vi.useFakeTimers()
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const skillPresenter = createSkillPresenter(
      createSkillSnapshot(2, createSkillEntry(metadata, 'SKILL A', ['read']))
    )
    const runtime = createRuntime({ skillPresenter })
    const agentsRead = deferred<string>()
    const agentsReadStarted = deferred<void>()
    const originalReadFile = fs.promises.readFile.bind(fs.promises)
    let agentsReadCount = 0
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (sourcePath, ...args) => {
      if (path.resolve(String(sourcePath)) === path.join(tempDir, 'AGENTS.md')) {
        agentsReadCount += 1
        agentsReadStarted.resolve()
        return (await agentsRead.promise) as any
      }
      return await (originalReadFile as any)(sourcePath, ...args)
    })

    const firstPair = buildPair(runtime, tempDir)
    await agentsReadStarted.promise
    await vi.advanceTimersByTimeAsync(199)
    let settled = false
    void firstPair.then(() => {
      settled = true
    })
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await firstPair).systemPrompt).not.toContain('LATE INSTRUCTIONS')

    agentsRead.resolve('LATE INSTRUCTIONS')
    await vi.waitFor(() => expect(agentsReadCount).toBe(1))
    await Promise.resolve()

    const secondPair = await buildPair(runtime, tempDir)
    expect(secondPair.systemPrompt).toContain('LATE INSTRUCTIONS')
    expect(agentsReadCount).toBe(1)
  })

  it('invalidates the outer prompt when the real verification snapshot revision changes', async () => {
    vi.useFakeTimers()
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const skillPresenter = createSkillPresenter(
      createSkillSnapshot(2, createSkillEntry(metadata, 'BODY', ['read']))
    )
    const runtime = createRuntime({ skillPresenter })
    const first = await buildPair(runtime, tempDir)
    expect(first.systemPrompt).not.toContain('`project-check`')

    await fs.promises.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { 'project-check': 'vitest' } })
    )
    await vi.advanceTimersByTimeAsync(30_000)
    const staleTurn = await buildPair(runtime, tempDir)
    expect(staleTurn.systemPrompt).not.toContain('`project-check`')
    await vi.waitFor(async () => {
      const refreshed = await buildPair(runtime, tempDir)
      expect(refreshed.systemPrompt).toContain('`project-check`')
    })
  })

  it('uses one immutable skill snapshot for prompt content and skill-derived tools', async () => {
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review A',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const firstSnapshot = createSkillSnapshot(2, createSkillEntry(metadata, 'BODY A', ['read']))
    const skillPresenter = createSkillPresenter(firstSnapshot)
    const toolPresenter = createToolPresenter()
    const runtime = createRuntime({ skillPresenter, toolPresenter })

    const first = await buildPair(runtime, tempDir)
    expect(first.systemPrompt).toContain('BODY A')
    expect(first.tools.map((tool) => tool.function.name)).toEqual(['skill_view', 'read'])
    expect(toolPresenter.getAllToolDefinitions.mock.calls[0][0].skillRuntimeSnapshot).toBe(
      firstSnapshot
    )
    expect(skillPresenter.loadSkillContent).not.toHaveBeenCalled()

    const secondSnapshot = createSkillSnapshot(
      4,
      createSkillEntry({ ...metadata, description: 'Review B' }, 'BODY B', ['exec'])
    )
    skillPresenter.setSnapshot(secondSnapshot)
    const second = await buildPair(runtime, tempDir)

    expect(second.systemPrompt).toContain('BODY B')
    expect(second.systemPrompt).toContain('Review B')
    expect(second.tools.map((tool) => tool.function.name)).toEqual(['skill_view', 'exec'])
    expect(toolPresenter.getAllToolDefinitions.mock.calls[1][0].skillRuntimeSnapshot).toBe(
      secondSnapshot
    )
  })

  it('starts all three source chains together and keeps one absolute deadline through discovery', async () => {
    await fs.promises.writeFile(path.join(tempDir, 'AGENTS.md'), 'PROJECT RULE')
    await fs.promises.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } })
    )
    vi.useFakeTimers()
    const startedAt = Date.now()
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const snapshot = createSkillSnapshot(2, createSkillEntry(metadata, 'BODY', ['read']))
    const skillPresenter = createSkillPresenter(snapshot)
    const discovery = deferred<SkillMetadata[]>()
    const starts: Record<string, number> = {}
    skillPresenter.getMetadataList.mockImplementationOnce(() => {
      starts.skillDiscovery = Date.now()
      return discovery.promise
    })
    skillPresenter.waitForStableRuntimeSnapshot.mockImplementation(async (options) => {
      starts.skillStable ??= Date.now()
      expect(options.deadlineAt).toBe(startedAt + 200)
      return snapshot
    })
    const originalReadFile = fs.promises.readFile.bind(fs.promises)
    const envRead = deferred<string>()
    const verificationRead = deferred<string>()
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (sourcePath, ...args) => {
      const resolved = path.resolve(String(sourcePath))
      if (resolved === path.join(tempDir, 'AGENTS.md')) {
        starts.env = Date.now()
        return (await envRead.promise) as any
      }
      if (resolved === path.join(tempDir, 'package.json')) {
        starts.verification = Date.now()
        return (await verificationRead.promise) as any
      }
      return await (originalReadFile as any)(sourcePath, ...args)
    })
    const runtime = createRuntime({ skillPresenter })

    const pending = buildPair(runtime, tempDir)
    await Promise.resolve()
    await Promise.resolve()
    expect(starts).toMatchObject({
      env: startedAt,
      verification: startedAt,
      skillDiscovery: startedAt
    })
    await vi.advanceTimersByTimeAsync(50)
    envRead.resolve('PROJECT RULE')
    verificationRead.resolve(JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }))
    discovery.resolve([metadata])
    await pending

    expect(starts.skillStable).toBe(startedAt + 50)
    const allDeadlines = skillPresenter.waitForStableRuntimeSnapshot.mock.calls.map(
      ([options]) => options.deadlineAt
    )
    expect(new Set(allDeadlines)).toEqual(new Set([startedAt + 200]))
  })

  it('rebuilds once when publication changes during tool construction and returns only the new pair', async () => {
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const snapshotA = createSkillSnapshot(2, createSkillEntry(metadata, 'BODY A', ['read']))
    const snapshotB = createSkillSnapshot(4, createSkillEntry(metadata, 'BODY B', ['exec']))
    const skillPresenter = createSkillPresenter(snapshotA)
    let buildCount = 0
    const toolPresenter = createToolPresenter(() => {
      buildCount += 1
      if (buildCount === 1) {
        skillPresenter.setSnapshot(snapshotB)
      }
    })
    const runtime = createRuntime({ skillPresenter, toolPresenter })

    const pair = await buildPair(runtime, tempDir)

    expect(buildCount).toBe(2)
    expect(pair.systemPrompt).toContain('BODY B')
    expect(pair.systemPrompt).not.toContain('BODY A')
    expect(pair.tools.map((tool) => tool.function.name)).toEqual(['skill_view', 'exec'])
  })

  it('retries when discovery metadata is published between the two stable samples', async () => {
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const snapshotA = createSkillSnapshot(2, createSkillEntry(metadata, 'BODY A', ['read']))
    const snapshotB = createSkillSnapshot(4, createSkillEntry(metadata, 'BODY B', ['exec']))
    const skillPresenter = createSkillPresenter(snapshotA)
    let metadataReadCount = 0
    skillPresenter.getMetadataList.mockImplementation(async () => {
      metadataReadCount += 1
      if (metadataReadCount === 2) {
        skillPresenter.setSnapshot(snapshotB)
      }
      const current = skillPresenter.getPublishedRuntimeSnapshot()
      return Array.from(current.entries.values()).map((entry) => entry.metadata as SkillMetadata)
    })
    const runtime = createRuntime({ skillPresenter })

    const pair = await buildPair(runtime, tempDir)

    expect(metadataReadCount).toBeGreaterThanOrEqual(3)
    expect(pair.systemPrompt).toContain('BODY B')
    expect(pair.systemPrompt).not.toContain('BODY A')
    expect(pair.tools.map((tool) => tool.function.name)).toEqual(['skill_view', 'exec'])
  })

  it('rejects after one rebuild when publication changes twice without resetting the deadline', async () => {
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const snapshots = [
      createSkillSnapshot(2, createSkillEntry(metadata, 'BODY A', ['read'])),
      createSkillSnapshot(4, createSkillEntry(metadata, 'BODY B', ['exec'])),
      createSkillSnapshot(6, createSkillEntry(metadata, 'BODY C', ['process']))
    ]
    const skillPresenter = createSkillPresenter(snapshots[0])
    let buildCount = 0
    const toolPresenter = createToolPresenter(() => {
      buildCount += 1
      skillPresenter.setSnapshot(snapshots[buildCount])
    })
    const runtime = createRuntime({ skillPresenter, toolPresenter })

    await expect(buildPair(runtime, tempDir)).rejects.toBeInstanceOf(SkillRuntimeUpdatingError)
    expect(buildCount).toBe(2)
    const deadlines = skillPresenter.waitForStableRuntimeSnapshot.mock.calls.map(
      ([options]) => options.deadlineAt
    )
    expect(new Set(deadlines).size).toBe(1)
  })

  it('bounds discovery under the shared deadline and rejects an unmatched late snapshot', async () => {
    vi.useFakeTimers()
    const emptySnapshot = createSkillSnapshot(0)
    const skillPresenter = createSkillPresenter(emptySnapshot)
    const discovery = deferred<SkillMetadata[]>()
    skillPresenter.getMetadataList.mockImplementationOnce(() => discovery.promise)
    const runtime = createRuntime({ skillPresenter })

    const pending = buildPair(runtime, tempDir)
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    const pendingRejection = expect(pending).rejects.toBeInstanceOf(SkillRuntimeUpdatingError)
    await vi.advanceTimersByTimeAsync(199)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pendingRejection

    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Late review',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const lateSnapshot = createSkillSnapshot(2, createSkillEntry(metadata, 'LATE BODY', ['read']))
    skillPresenter.setSnapshot(lateSnapshot)
    discovery.resolve([metadata])
    await Promise.resolve()

    const recovered = await buildPair(runtime, tempDir)
    expect(recovered.systemPrompt).toContain('LATE BODY')
  })

  it('aborts runtime preparation both before registration and inside the listener window', async () => {
    const skillPresenter = createSkillPresenter(createSkillSnapshot(0))
    const runtime = createRuntime({ skillPresenter }) as any
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(new DOMException('already aborted', 'AbortError'))
    await expect(
      runtime.waitForRuntimePreparation(
        new Promise(() => undefined),
        alreadyAborted.signal,
        Date.now() + 10_000
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    const windowAbort = new AbortController()
    const originalAddEventListener = windowAbort.signal.addEventListener.bind(windowAbort.signal)
    vi.spyOn(windowAbort.signal, 'addEventListener').mockImplementation(((
      ...args: Parameters<AbortSignal['addEventListener']>
    ) => {
      windowAbort.abort(new DOMException('window abort', 'AbortError'))
      return originalAddEventListener(...args)
    }) as AbortSignal['addEventListener'])
    await expect(
      runtime.waitForRuntimePreparation(
        new Promise(() => undefined),
        windowAbort.signal,
        Date.now() + 10_000
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('falls back only when both cached halves match every source revision and skill epoch', async () => {
    const metadata: SkillMetadata = {
      name: 'review',
      description: 'Review changes',
      path: path.join(tempDir, 'review', 'SKILL.md'),
      skillRoot: path.join(tempDir, 'review')
    }
    const stableSnapshot = createSkillSnapshot(
      2,
      createSkillEntry(metadata, 'STABLE BODY', ['read'])
    )
    const skillPresenter = createSkillPresenter(stableSnapshot)
    const runtime = createRuntime({ skillPresenter })
    const stablePair = await buildPair(runtime, tempDir)

    vi.useFakeTimers()
    skillPresenter.waitForStableRuntimeSnapshot.mockImplementation(
      (options: { deadlineAt: number }) =>
        new Promise<SkillRuntimeSnapshot>((_resolve, reject) => {
          setTimeout(
            () => reject(new SkillRuntimeUpdatingError()),
            Math.max(0, options.deadlineAt - Date.now())
          )
        })
    )
    const fallback = buildPair(runtime, tempDir)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(200)
    await expect(fallback).resolves.toEqual(stablePair)

    const promptCache = (runtime as any).systemPromptCache.get('session-1')
    promptCache.envRevision = 'mismatched-env-revision'
    const rejected = buildPair(runtime, tempDir)
    const rejection = expect(rejected).rejects.toBeInstanceOf(SkillRuntimeUpdatingError)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(200)
    await rejection
  })
})
