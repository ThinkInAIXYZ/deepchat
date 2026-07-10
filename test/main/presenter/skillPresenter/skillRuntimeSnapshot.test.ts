import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IConfigPresenter } from '../../../../src/shared/presenter'
import type { IFileWatcherService } from '../../../../src/main/lib/fileWatcher'
import {
  SkillRuntimeUpdatingError,
  type SkillManagementState
} from '../../../../src/shared/types/skill'

const discoveryWorkerMock = vi.hoisted(() => ({
  discoverSkillMetadataInWorker: vi.fn(),
  logSkillDiscoveryWorkerWarnings: vi.fn()
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, default: actual }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, default: actual }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'home' ? os.homedir() : os.tmpdir())),
    getAppPath: vi.fn(() => process.cwd()),
    isPackaged: false
  },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

vi.mock('../../../../src/main/presenter/skillPresenter/discoveryWorker', () => discoveryWorkerMock)

import { SkillPresenter } from '../../../../src/main/presenter/skillPresenter'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createSessionStatePort() {
  return {
    hasNewSession: vi.fn().mockResolvedValue(true),
    getPersistedNewSessionSkills: vi.fn().mockReturnValue([]),
    setPersistedNewSessionSkills: vi.fn(),
    repairImportedLegacySessionSkills: vi.fn().mockResolvedValue([])
  }
}

function writeSkill(
  root: string,
  name: string,
  input: { description: string; body: string; allowedTools?: string[]; script?: string }
) {
  const skillRoot = path.join(root, name)
  fs.mkdirSync(skillRoot, { recursive: true })
  const allowedTools = input.allowedTools?.length
    ? `allowedTools:\n${input.allowedTools.map((tool) => `  - ${tool}`).join('\n')}\n`
    : ''
  fs.writeFileSync(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${input.description}\n${allowedTools}---\n\n${input.body}`,
    'utf-8'
  )
  if (input.script) {
    const scriptsDir = path.join(skillRoot, 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.writeFileSync(path.join(scriptsDir, input.script), 'print("ok")', 'utf-8')
  }
}

describe('SkillPresenter runtime snapshots', () => {
  let root: string
  let presenter: SkillPresenter
  let settings: Map<string, unknown>

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-skill-runtime-'))
    settings = new Map()
    discoveryWorkerMock.discoverSkillMetadataInWorker.mockRejectedValue(new Error('test fallback'))
    const config = {
      getSkillsPath: vi.fn(() => root),
      getSetting: vi.fn((key: string) => settings.get(key)),
      setSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
    } as unknown as IConfigPresenter
    presenter = new SkillPresenter(config, createSessionStatePort(), {
      watch: vi.fn()
    } as unknown as IFileWatcherService)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await presenter.destroy()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('publishes metadata, body, scripts and allowed tools from one staged source version', async () => {
    writeSkill(root, 'review', {
      description: 'Version A',
      body: '# Body A',
      allowedTools: ['read_file'],
      script: 'run.py'
    })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const previous = presenter.getPublishedRuntimeSnapshot()
    const previousEntry = previous.entries.get('review')
    expect(previousEntry).toMatchObject({
      availability: 'ready',
      metadata: { description: 'Version A' },
      allowedTools: ['read_file']
    })
    expect(previousEntry?.renderedContent).toContain('# Body A')
    expect(previousEntry?.scripts?.map((script) => script.relativePath)).toEqual(['scripts/run.py'])

    writeSkill(root, 'review', {
      description: 'Version B',
      body: '# Body B',
      allowedTools: ['write_file'],
      script: 'check.js'
    })
    fs.rmSync(path.join(root, 'review', 'scripts', 'run.py'))

    const deferredRead = createDeferred<string>()
    const originalReadFile = fs.promises.readFile.bind(fs.promises)
    let deferManifestRead = true
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (target, options) => {
      if (deferManifestRead && target === path.join(root, 'review', 'SKILL.md')) {
        deferManifestRead = false
        return await deferredRead.promise
      }
      return await originalReadFile(target, options as BufferEncoding)
    })

    const watcherUpdate = (presenter as any).handleSkillFileChanged(
      path.join(root, 'review', 'SKILL.md')
    ) as Promise<void>
    await Promise.resolve()

    const duringStage = presenter.getPublishedRuntimeSnapshot()
    expect(duringStage.epoch).toBe(previous.epoch)
    expect(duringStage.entries.get('review')).toBe(previousEntry)
    expect((await presenter.loadSkillContent('review'))?.content).toContain('# Body A')

    deferredRead.resolve(fs.readFileSync(path.join(root, 'review', 'SKILL.md'), 'utf-8'))
    await watcherUpdate

    const published = presenter.getPublishedRuntimeSnapshot()
    const publishedEntry = published.entries.get('review')
    expect(published.epoch).toBeGreaterThan(previous.epoch)
    expect(published.epoch % 2).toBe(0)
    expect(publishedEntry?.sourceVersion).not.toBe(previousEntry?.sourceVersion)
    expect(publishedEntry).toMatchObject({
      availability: 'ready',
      metadata: { description: 'Version B' },
      allowedTools: ['write_file']
    })
    expect(publishedEntry?.renderedContent).toContain('# Body B')
    expect(publishedEntry?.renderedContent).not.toContain('# Body A')
    expect(publishedEntry?.scripts?.map((script) => script.relativePath)).toEqual([
      'scripts/check.js'
    ])
    expect(Object.isFrozen(publishedEntry)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.metadata)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.allowedTools)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.extension)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.extension?.runtimePolicy)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.scripts)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.scripts?.[0])).toBe(true)
    expect(Object.isFrozen(publishedEntry?.linkedFiles)).toBe(true)
    expect(Object.isFrozen(publishedEntry?.linkedFiles?.[0])).toBe(true)

    const mutableEntries = published.entries as Map<string, unknown>
    expect(() => mutableEntries.set('injected', {})).toThrow(TypeError)
    expect(() => mutableEntries.delete('review')).toThrow(TypeError)
    expect(presenter.getPublishedRuntimeSnapshot().entries.has('injected')).toBe(false)
    expect(presenter.getPublishedRuntimeSnapshot().entries.has('review')).toBe(true)
  })

  it('keeps the complete LKG on an invalid watcher update and ignores an invalid new skill', async () => {
    writeSkill(root, 'review', {
      description: 'Valid',
      body: '# Valid body',
      allowedTools: ['read_file']
    })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const previousEntry = presenter.getPublishedRuntimeSnapshot().entries.get('review')

    fs.writeFileSync(path.join(root, 'review', 'SKILL.md'), '---\nname: review\n---\nBroken')
    await (presenter as any).handleSkillFileChanged(path.join(root, 'review', 'SKILL.md'))

    const retained = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    expect(retained?.metadata).toBe(previousEntry?.metadata)
    expect(retained?.renderedContent).toBe(previousEntry?.renderedContent)
    expect(retained?.allowedTools).toBe(previousEntry?.allowedTools)
    expect(retained?.sourceVersion).toBe(previousEntry?.sourceVersion)
    expect(retained?.sourceError).toEqual({
      code: 'INVALID_SOURCE',
      message: 'Skill source is invalid'
    })
    expect(JSON.stringify(retained?.sourceError)).not.toContain('Broken')

    fs.mkdirSync(path.join(root, 'invalid-new'), { recursive: true })
    fs.writeFileSync(path.join(root, 'invalid-new', 'SKILL.md'), '---\nname: invalid-new\n---')
    await (presenter as any).handleSkillFileAdded(path.join(root, 'invalid-new', 'SKILL.md'))

    expect(presenter.getPublishedRuntimeSnapshot().entries.has('invalid-new')).toBe(false)
  })

  it('serves root skill views from one captured snapshot while linked-file views stay explicit', async () => {
    writeSkill(root, 'review', { description: 'Version A', body: '# Body A' })
    const referencesDir = path.join(root, 'review', 'references')
    fs.mkdirSync(referencesDir, { recursive: true })
    fs.writeFileSync(path.join(referencesDir, 'guide.md'), '# Guide A', 'utf-8')
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')

    writeSkill(root, 'review', { description: 'Version B', body: '# Body B' })
    fs.writeFileSync(path.join(referencesDir, 'guide.md'), '# Guide B', 'utf-8')
    const readFile = vi.spyOn(fs.promises, 'readFile')
    const stat = vi.spyOn(fs.promises, 'stat')
    const readdir = vi.spyOn(fs.promises, 'readdir')

    const rootView = await presenter.viewSkill('review', { filePath: 'SKILL.md' })

    expect(rootView).toMatchObject({
      success: true,
      name: 'review',
      filePath: null,
      content: expect.stringContaining('# Body A'),
      linkedFiles: [{ kind: 'reference', path: 'references/guide.md' }]
    })
    expect(rootView.content).not.toContain('# Body B')
    expect(readFile).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(readdir).not.toHaveBeenCalled()

    const linkedView = await presenter.viewSkill('review', {
      filePath: 'references/guide.md'
    })
    expect(linkedView).toMatchObject({
      success: true,
      filePath: 'references/guide.md',
      content: '# Guide B'
    })
    expect(readFile).toHaveBeenCalledWith(path.join(referencesDir, 'guide.md'), 'utf-8')

    const newReferencePath = path.join(referencesDir, 'new.md')
    fs.writeFileSync(newReferencePath, '# New reference', 'utf-8')
    await (presenter as any).handlePublishedSkillAuxiliarySourceChanged(newReferencePath, 'create')
    await expect(presenter.viewSkill('review')).resolves.toMatchObject({
      success: true,
      content: expect.stringContaining('# Body B'),
      linkedFiles: [
        { kind: 'reference', path: 'references/guide.md' },
        { kind: 'reference', path: 'references/new.md' }
      ]
    })
  })

  it('publishes a plugin registration after a watcher invalidates catalog discovery', async () => {
    writeSkill(root, 'regular', { description: 'Regular A', body: '# Regular A' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('regular')
    const pluginBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-plugin-runtime-'))
    const pluginSkillRoot = path.join(pluginBase, 'plugin-skill')
    writeSkill(pluginBase, 'plugin-skill', {
      description: 'Plugin',
      body: '# Plugin body'
    })
    const pluginPath = path.join(pluginSkillRoot, 'SKILL.md')
    const parseStarted = createDeferred<void>()
    const releaseParse = createDeferred<void>()
    const originalParse = (presenter as any).parseSkillMetadata.bind(presenter)
    let heldPluginParse = false
    vi.spyOn(presenter as any, 'parseSkillMetadata').mockImplementation(
      async (skillPath: string, ...args: unknown[]) => {
        if (skillPath === pluginPath && !heldPluginParse) {
          heldPluginParse = true
          parseStarted.resolve()
          await releaseParse.promise
        }
        return await originalParse(skillPath, ...args)
      }
    )

    try {
      const registration = presenter.registerPluginSkill({
        ownerPluginId: 'plugin.fixture',
        id: 'plugin-skill',
        skillRoot: pluginSkillRoot,
        pluginRoot: pluginBase
      })
      await parseStarted.promise
      writeSkill(root, 'regular', { description: 'Regular B', body: '# Regular B' })
      await (presenter as any).handleSkillFileChanged(path.join(root, 'regular', 'SKILL.md'))
      releaseParse.resolve()
      await registration

      expect(presenter.getPublishedRuntimeSnapshot().entries.get('plugin-skill')).toMatchObject({
        availability: 'ready',
        metadata: {
          path: pluginPath,
          ownerPluginId: 'plugin.fixture'
        },
        renderedContent: expect.stringContaining('# Plugin body')
      })
    } finally {
      fs.rmSync(pluginBase, { recursive: true, force: true })
    }
  })

  it('publishes the current plugin revision when re-registration loses catalog CAS', async () => {
    writeSkill(root, 'regular', { description: 'Regular A', body: '# Regular A' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('regular')
    const pluginBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-plugin-runtime-'))
    const pluginSkillRoot = path.join(pluginBase, 'plugin-skill')
    const firstPluginRoot = path.join(pluginBase, 'runtime-a')
    const secondPluginRoot = path.join(pluginBase, 'runtime-b')
    writeSkill(pluginBase, 'plugin-skill', {
      description: 'Plugin A',
      body: '# Plugin A\n\nPlugin root: `${PLUGIN_ROOT}`.'
    })
    const pluginPath = path.join(pluginSkillRoot, 'SKILL.md')

    try {
      await presenter.registerPluginSkill({
        ownerPluginId: 'plugin.fixture',
        id: 'plugin-skill',
        skillRoot: pluginSkillRoot,
        pluginRoot: firstPluginRoot
      })
      await presenter.loadSkillContent('plugin-skill')
      const previousVersion = presenter
        .getPublishedRuntimeSnapshot()
        .entries.get('plugin-skill')!.sourceVersion

      writeSkill(pluginBase, 'plugin-skill', {
        description: 'Plugin B',
        body: '# Plugin B\n\nPlugin root: `${PLUGIN_ROOT}`.'
      })
      const parseStarted = createDeferred<void>()
      const releaseParse = createDeferred<void>()
      const originalParse = (presenter as any).parseSkillMetadata.bind(presenter)
      let heldPluginParse = false
      vi.spyOn(presenter as any, 'parseSkillMetadata').mockImplementation(
        async (skillPath: string, ...args: unknown[]) => {
          if (skillPath === pluginPath && !heldPluginParse) {
            heldPluginParse = true
            parseStarted.resolve()
            await releaseParse.promise
          }
          return await originalParse(skillPath, ...args)
        }
      )

      const registration = presenter.registerPluginSkill({
        ownerPluginId: 'plugin.fixture',
        id: 'plugin-skill',
        skillRoot: pluginSkillRoot,
        pluginRoot: secondPluginRoot
      })
      await parseStarted.promise
      writeSkill(root, 'regular', { description: 'Regular B', body: '# Regular B' })
      await (presenter as any).handleSkillFileChanged(path.join(root, 'regular', 'SKILL.md'))
      releaseParse.resolve()
      await registration

      const current = presenter.getPublishedRuntimeSnapshot().entries.get('plugin-skill')
      expect(current).toMatchObject({
        availability: 'ready',
        metadata: {
          description: 'Plugin B',
          path: pluginPath,
          ownerPluginId: 'plugin.fixture'
        },
        renderedContent: expect.stringContaining('# Plugin B')
      })
      expect(current?.renderedContent).toContain(`Plugin root: \`${secondPluginRoot}\`.`)
      expect(current?.sourceVersion).not.toBe(previousVersion)
    } finally {
      fs.rmSync(pluginBase, { recursive: true, force: true })
    }
  })

  it('removes plugin snapshots after a watcher invalidates unregister discovery', async () => {
    const pluginBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-plugin-runtime-'))
    const pluginSkillRoot = path.join(pluginBase, 'plugin-skill')
    writeSkill(pluginBase, 'plugin-skill', {
      description: 'Plugin',
      body: '# Plugin body'
    })
    const pluginPath = path.join(pluginSkillRoot, 'SKILL.md')

    try {
      await presenter.registerPluginSkill({
        ownerPluginId: 'plugin.fixture',
        id: 'plugin-skill',
        skillRoot: pluginSkillRoot,
        pluginRoot: pluginBase
      })
      await presenter.loadSkillContent('plugin-skill')
      const discoveryStarted = createDeferred<void>()
      const releaseDiscovery = createDeferred<void>()
      discoveryWorkerMock.discoverSkillMetadataInWorker.mockImplementationOnce(async () => {
        discoveryStarted.resolve()
        await releaseDiscovery.promise
        return { skills: [], warnings: [] }
      })

      const unregister = presenter.unregisterPluginSkillsByOwner('plugin.fixture')
      await discoveryStarted.promise
      await (presenter as any).handleSkillFileChanged(pluginPath)
      releaseDiscovery.resolve()
      await unregister

      expect(presenter.getPublishedRuntimeSnapshot().entries.has('plugin-skill')).toBe(false)
      expect(await presenter.getMetadataList()).toEqual([])
    } finally {
      fs.rmSync(pluginBase, { recursive: true, force: true })
    }
  })

  it('rejects repo-owned parse-null before writing the source file', async () => {
    writeSkill(root, 'review', { description: 'Valid', body: '# Original' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const skillPath = path.join(root, 'review', 'SKILL.md')
    const original = fs.readFileSync(skillPath, 'utf-8')
    const atomicWrite = vi.spyOn(presenter as any, 'atomicWriteFile')

    const result = await presenter.updateSkillFile('review', '---\nname: review\n---\nInvalid')

    expect(result.success).toBe(false)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(fs.readFileSync(skillPath, 'utf-8')).toBe(original)
    expect(
      presenter.getPublishedRuntimeSnapshot().entries.get('review')?.renderedContent
    ).toContain('# Original')
  })

  it('does not let an update overwrite a newer watcher observation after an awaited read', async () => {
    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const skillPath = path.join(root, 'review', 'SKILL.md')
    const oldContent = fs.readFileSync(skillPath, 'utf-8')
    const readStarted = createDeferred<void>()
    const previousRead = createDeferred<string>()
    vi.spyOn(presenter, 'readSkillFile').mockImplementationOnce(async () => {
      readStarted.resolve()
      return await previousRead.promise
    })

    const staleUpdate = presenter.updateSkillFile(
      'review',
      '---\nname: review\ndescription: Update A\n---\n\n# Update A'
    )
    await readStarted.promise

    writeSkill(root, 'review', { description: 'Watcher B', body: '# Watcher B' })
    await (presenter as any).handleSkillFileChanged(skillPath)
    previousRead.resolve(oldContent)

    await expect(staleUpdate).resolves.toMatchObject({ success: false })
    const published = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    expect(published?.metadata.description).toBe('Watcher B')
    expect(published?.renderedContent).toContain('# Watcher B')
    expect(fs.readFileSync(skillPath, 'utf-8')).toContain('# Watcher B')
  })

  it('does not let a stale watcher stage overwrite a newer watcher publication', async () => {
    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const skillPath = path.join(root, 'review', 'SKILL.md')
    const metadata = presenter.getPublishedRuntimeSnapshot().entries.get('review')!.metadata as any

    writeSkill(root, 'review', { description: 'Watcher A', body: '# Watcher A' })
    const watcherCandidateA = await (presenter as any).stagePublishedSkillEntry(metadata)
    const stageStarted = createDeferred<void>()
    const deferredStage = createDeferred<typeof watcherCandidateA>()
    const originalStage = (presenter as any).stagePublishedSkillEntry.bind(presenter)
    vi.spyOn(presenter as any, 'stagePublishedSkillEntry')
      .mockImplementationOnce(async () => {
        stageStarted.resolve()
        return await deferredStage.promise
      })
      .mockImplementation(originalStage)

    const staleWatcher = (presenter as any).handleSkillFileChanged(skillPath) as Promise<void>
    await stageStarted.promise
    writeSkill(root, 'review', { description: 'Watcher B', body: '# Watcher B' })
    await (presenter as any).handleSkillFileChanged(skillPath)
    deferredStage.resolve(watcherCandidateA)
    await staleWatcher

    const published = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    expect(published?.metadata.description).toBe('Watcher B')
    expect(published?.renderedContent).toContain('# Watcher B')
  })

  it('does not let a stale whole-catalog discovery replace a newer watcher publication', async () => {
    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const skillPath = path.join(root, 'review', 'SKILL.md')

    writeSkill(root, 'review', { description: 'Discovery A', body: '# Discovery A' })
    await (presenter as any).handleSkillFileChanged(skillPath)
    const discoveryCandidate = presenter.getPublishedRuntimeSnapshot().entries.get('review')!

    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await (presenter as any).handleSkillFileChanged(skillPath)
    const metadata = presenter.getPublishedRuntimeSnapshot().entries.get('review')!.metadata as any
    discoveryWorkerMock.discoverSkillMetadataInWorker.mockResolvedValue({
      skills: [metadata],
      warnings: []
    })

    const stageStarted = createDeferred<void>()
    const deferredStage = createDeferred<typeof discoveryCandidate>()
    const originalStage = (presenter as any).stagePublishedSkillEntry.bind(presenter)
    vi.spyOn(presenter as any, 'stagePublishedSkillEntry')
      .mockImplementationOnce(async () => {
        stageStarted.resolve()
        return await deferredStage.promise
      })
      .mockImplementation(originalStage)

    const discovery = presenter.discoverSkills()
    await stageStarted.promise
    writeSkill(root, 'review', { description: 'Watcher B', body: '# Watcher B' })
    await (presenter as any).handleSkillFileChanged(skillPath)
    deferredStage.resolve(discoveryCandidate)
    await discovery

    const published = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    expect(published?.metadata.description).toBe('Watcher B')
    expect(published?.renderedContent).toContain('# Watcher B')
  })

  it('keeps repo-owned writes behind the shared odd publish barrier', async () => {
    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const previous = presenter.getPublishedRuntimeSnapshot()
    const originalAtomicWrite = (presenter as any).atomicWriteFile.bind(presenter)
    let waitingForPublish: Promise<unknown> | undefined
    vi.spyOn(presenter as any, 'atomicWriteFile').mockImplementation(
      (target: string, content: string) => {
        expect(presenter.getPublishedRuntimeSnapshot()).toBe(previous)
        waitingForPublish = presenter.waitForStableRuntimeSnapshot({
          requiredSkillNames: ['review'],
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 1_000
        })
        return originalAtomicWrite(target, content)
      }
    )

    const result = await presenter.updateSkillFile(
      'review',
      '---\nname: review\ndescription: New\n---\n\n# New'
    )

    expect(result).toEqual({ success: true, skillName: 'review' })
    const published = await waitingForPublish
    expect(published).toBe(presenter.getPublishedRuntimeSnapshot())
    expect(presenter.getPublishedRuntimeSnapshot().epoch).toBe(previous.epoch + 2)
    expect(
      presenter.getPublishedRuntimeSnapshot().entries.get('review')?.renderedContent
    ).toContain('# New')
  })

  it('bounds a hung readiness stage and aborts each waiter independently', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'))
    writeSkill(root, 'review', { description: 'Valid', body: '# Body' })
    await presenter.discoverSkills()
    const never = createDeferred<never>()
    vi.spyOn(presenter as any, 'stagePublishedSkillEntry').mockReturnValue(never.promise)
    const sharedStage = presenter.waitForStableRuntimeSnapshot({
      requiredSkillNames: ['review'],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 200
    })
    const abortController = new AbortController()
    const abortedWaiter = presenter.waitForStableRuntimeSnapshot({
      requiredSkillNames: ['review'],
      signal: abortController.signal,
      deadlineAt: Date.now() + 200
    })

    abortController.abort()
    await expect(abortedWaiter).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(199)
    let settled = false
    void sharedStage.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(sharedStage).rejects.toBeInstanceOf(SkillRuntimeUpdatingError)
  })

  it('bounds a hung odd publish window without exposing its pending entries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'))
    writeSkill(root, 'review', { description: 'Valid', body: '# Body' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const previous = presenter.getPublishedRuntimeSnapshot()
    const endPublish = (presenter as any).beginRuntimePublish() as () => void
    const wait = presenter.waitForStableRuntimeSnapshot({
      requiredSkillNames: ['review'],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 200
    })
    const waitRejection = expect(wait).rejects.toBeInstanceOf(SkillRuntimeUpdatingError)

    expect(presenter.getPublishedRuntimeSnapshot()).toBe(previous)
    await vi.advanceTimersByTimeAsync(199)
    expect(presenter.getPublishedRuntimeSnapshot()).toBe(previous)
    await vi.advanceTimersByTimeAsync(1)
    await waitRejection
    endPublish()
    expect(presenter.getPublishedRuntimeSnapshot().epoch).toBe(previous.epoch + 2)
  })

  it('rejects destroy without partially resetting an active publication', async () => {
    writeSkill(root, 'review', { description: 'Valid', body: '# Body' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const previousEntry = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    const sourcePath = previousEntry!.metadata.path
    const observation = (presenter as any).runtimeSnapshots.nextObservation(sourcePath)
    const endPublish = (presenter as any).beginRuntimePublish() as () => void

    await expect(presenter.destroy()).rejects.toThrow(
      'Cannot reset skill runtime snapshot during publication'
    )
    expect((presenter as any).runtimeSnapshots.currentObservation(sourcePath)).toBe(observation)
    expect(presenter.getPublishedRuntimeSnapshot().entries.get('review')).toBe(previousEntry)

    endPublish()
    await presenter.destroy()
    expect(presenter.getPublishedRuntimeSnapshot().entries.size).toBe(0)
  })

  it('does not let a late watcher revive a missing skill after uninstall cleanup', async () => {
    writeSkill(root, 'review', { description: 'Version A', body: '# Body A' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const skillPath = path.join(root, 'review', 'SKILL.md')
    const metadata = presenter.getPublishedRuntimeSnapshot().entries.get('review')!.metadata as any
    const watcherCandidate = await (presenter as any).stagePublishedSkillEntry(metadata)
    const stageStarted = createDeferred<void>()
    const deferredStage = createDeferred<typeof watcherCandidate>()
    vi.spyOn(presenter as any, 'stagePublishedSkillEntry').mockImplementationOnce(async () => {
      stageStarted.resolve()
      return await deferredStage.promise
    })

    const staleWatcher = (presenter as any).handleSkillFileChanged(skillPath) as Promise<void>
    await stageStarted.promise
    fs.rmSync(path.join(root, 'review'), { recursive: true, force: true })
    await expect(presenter.uninstallSkill('review')).resolves.toMatchObject({
      success: false,
      errorCode: 'not_found'
    })
    deferredStage.resolve(watcherCandidate)
    await staleWatcher

    expect(presenter.getPublishedRuntimeSnapshot().entries.has('review')).toBe(false)
  })

  it('keeps the runtime epoch stable while invalidating a pure missing late stage', async () => {
    writeSkill(root, 'missing', { description: 'Missing', body: '# Missing' })
    const skillPath = path.join(root, 'missing', 'SKILL.md')
    const hint = (presenter as any).createStageMetadataHint(skillPath, 'missing')
    const candidate = await (presenter as any).stagePublishedSkillEntry(hint)
    fs.rmSync(path.join(root, 'missing'), { recursive: true, force: true })
    const stageStarted = createDeferred<void>()
    const deferredStage = createDeferred<typeof candidate>()
    vi.spyOn(presenter as any, 'stagePublishedSkillEntry').mockImplementationOnce(async () => {
      stageStarted.resolve()
      return await deferredStage.promise
    })

    const staleAddition = (presenter as any).handleSkillFileAdded(skillPath) as Promise<void>
    await stageStarted.promise
    const before = presenter.getPublishedRuntimeSnapshot()

    await expect(presenter.uninstallSkill('missing')).resolves.toMatchObject({
      success: false,
      errorCode: 'not_found'
    })
    deferredStage.resolve(candidate)
    await staleAddition

    expect(presenter.getPublishedRuntimeSnapshot()).toBe(before)
    expect(presenter.getPublishedRuntimeSnapshot().entries.has('missing')).toBe(false)
    expect(settings.has('skills.managementState')).toBe(false)
  })

  it('cleans management-only missing state without publishing a runtime epoch', async () => {
    settings.set('skills.managementState', {
      version: 1,
      skills: {
        missing: {
          name: 'missing',
          canonicalPath: path.join(root, 'missing'),
          deepchat: { disabled: true },
          extension: {
            version: 1,
            env: {},
            runtimePolicy: { python: 'auto', node: 'auto' },
            scriptOverrides: {}
          },
          source: { type: 'created' }
        }
      }
    })
    const before = presenter.getPublishedRuntimeSnapshot()

    await expect(presenter.uninstallSkill('missing')).resolves.toMatchObject({
      success: false,
      errorCode: 'not_found'
    })

    expect(presenter.getPublishedRuntimeSnapshot()).toBe(before)
    expect((settings.get('skills.managementState') as any).skills.missing).toBeUndefined()
  })

  it('serves compatibility runtime APIs from a captured ready snapshot without source disk reads', async () => {
    writeSkill(root, 'review', {
      description: 'Valid',
      body: '# Body',
      allowedTools: ['read_file'],
      script: 'run.py'
    })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const readSpy = vi.spyOn(fs.promises, 'readFile')
    const statSpy = vi.spyOn(fs.promises, 'stat')
    const readdirSpy = vi.spyOn(fs.promises, 'readdir')

    expect((await presenter.getMetadataList()).map((skill) => skill.name)).toEqual(['review'])
    expect((await presenter.loadSkillContent('review'))?.content).toContain('# Body')
    expect((await presenter.listSkillScripts('review')).map((script) => script.name)).toEqual([
      'run.py'
    ])
    expect(await presenter.getActiveSkillsAllowedTools('conversation', ['review'])).toEqual([
      'read'
    ])
    expect(readSpy).not.toHaveBeenCalled()
    expect(statSpy).not.toHaveBeenCalled()
    expect(readdirSpy).not.toHaveBeenCalled()
  })

  it('publishes reconciled disk state after rollback leaves the disk outcome unknown', async () => {
    writeSkill(root, 'review', { description: 'Old', body: '# Old' })
    await presenter.discoverSkills()
    await presenter.loadSkillContent('review')
    const state = (settings.get('skills.managementState') as SkillManagementState | undefined) ?? {
      version: 1,
      skills: {}
    }
    settings.set('skills.managementState', state)
    const config = (presenter as any).configPresenter as IConfigPresenter
    vi.spyOn(config, 'setSetting')
      .mockImplementationOnce(() => {
        throw new Error('extension write failed')
      })
      .mockImplementationOnce(() => {
        throw new Error('extension rollback failed')
      })
    const originalAtomicWrite = (presenter as any).atomicWriteFile.bind(presenter)
    vi.spyOn(presenter as any, 'atomicWriteFile').mockImplementation(
      (target: string, content: string) => {
        if (content.includes('# Old')) {
          throw new Error('source rollback failed')
        }
        return originalAtomicWrite(target, content)
      }
    )

    const result = await presenter.saveSkillWithExtension(
      'review',
      '---\nname: review\ndescription: New\nallowedTools:\n  - write_file\n---\n\n# New',
      {
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      }
    )

    expect(result.success).toBe(false)
    const reconciled = presenter.getPublishedRuntimeSnapshot().entries.get('review')
    expect(reconciled?.availability).toBe('ready')
    expect(reconciled?.metadata.description).toBe('New')
    expect(reconciled?.renderedContent).toContain('# New')
    expect(reconciled?.allowedTools).toEqual(['write_file'])
    expect(reconciled?.sourceError).toBeUndefined()
  })

  it('quarantines an unknown source outcome when no LKG can be reconciled', async () => {
    vi.useFakeTimers()
    const metadata = {
      name: 'new-skill',
      description: 'New',
      path: path.join(root, 'new-skill', 'SKILL.md'),
      skillRoot: path.join(root, 'new-skill')
    }
    const stage = vi.spyOn(presenter as any, 'stagePublishedSkillEntry').mockResolvedValue(null)

    await (presenter as any).reconcileUnknownSkillSource('new-skill', metadata, undefined)

    const quarantined = presenter.getPublishedRuntimeSnapshot().entries.get('new-skill')
    expect(quarantined).toMatchObject({
      availability: 'quarantined',
      allowedTools: [],
      sourceError: { code: 'RECONCILE_REQUIRED' }
    })
    expect(await presenter.getMetadataList()).toEqual([])
    expect(await presenter.loadSkillContent('new-skill')).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(stage).toHaveBeenCalledTimes(1)
  })
})
