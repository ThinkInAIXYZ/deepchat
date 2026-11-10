import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimAgentProfiles } from '@/agent/dim/agentProfiles'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { createServer } from 'node:http'

interface ArchivePage {
  storeFormat: number
  totalSessions: number
  sessions: Array<{
    sessionId: string
    agentId: string
    protocolVersion: number
    config: { cwd: string }
    title: { text: string; source: 'auto' | 'manual' } | null
    titleRevision: string
    ownedPaths: string[]
    grants: unknown[]
  }>
  agents: Record<string, { profile: { systemPrompt: string }; ownerSessionId: string | null }>
  next: string | null
}

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'reads closed foreign profile ownership through the storage plugin without loading or changing it',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-archive-'))
    const options = (name: string) => ({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: path.join(root, name),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true
    })
    const source = new DimRuntimeSupervisor(options('source'))
    const target = new DimRuntimeSupervisor(options('target'))
    let requests = 0
    const fixture = createServer((_request, response) => {
      requests++
      response.writeHead(400).end()
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    try {
      const client = await source.start()
      const model = await new DimModelBridge(source).configure({
        key: 'archive-only',
        displayName: 'Archive fixture',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
          auth: { type: 'anonymous' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            toolCalling: false,
            streaming: true,
            structuredOutput: true,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 8192,
            maxOutputTokens: 1024
          }
        }
      })
      const agentId = await new DimAgentProfiles(source).ensure({
        name: 'Archive owner',
        description: '',
        systemPrompt: 'ARCHIVE_ONLY_PROFILE',
        tools: []
      })
      const ids: string[] = []
      for (let index = 0; index < 3; index++) {
        const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          agent: agentId,
          model: { ...model },
          cwd: root,
          tools: []
        })
        ids.push(created.sessionId)
        await client.call('deepchat.storage.rename_title', {
          sessionId: created.sessionId,
          title: `归档会话 ${index}`
        })
      }
      await client.call('deepchat.host.input', {
        sessionId: ids[0],
        branchId: 'main',
        mode: 'append',
        submissionId: 'archive-append',
        content: [{ type: 'text', text: '归档输入：保持事件身份与批次' }],
        rawBlocks: []
      })
      await client.call('deepchat.host.idle', { sessionId: ids[0], branchId: 'main' })
      await source.stop()
      const closedReader = await source.start()
      const originalHistory = await closedReader.call('deepchat.storage.history', {
        sessionId: ids[0],
        branchId: 'main',
        after: '0',
        limit: 100
      })
      await source.stop()
      const archive = path.join(root, 'archive')
      await cp(path.join(root, 'source/dim'), archive, { recursive: true })
      const database = path.join(archive, 'rust/dimcode.sqlite')
      const digest = async () =>
        createHash('sha256')
          .update(await readFile(database))
          .digest('hex')
      const before = await digest()
      let reader = await target.start()
      let after: string | null = null
      const found: string[] = []
      do {
        const page: ArchivePage = await reader.call('deepchat.storage.archive_catalog', {
          directory: archive,
          after,
          limit: 1
        })
        expect(page.storeFormat).toBe(36)
        expect(page.totalSessions).toBe(3)
        expect(page.sessions).toHaveLength(1)
        const session = page.sessions[0]
        expect(session.agentId).toBe(agentId)
        expect(session.protocolVersion).toBe(3)
        expect(await realpath(session.config.cwd)).toBe(await realpath(root))
        expect(session.title).toMatchObject({ source: 'manual' })
        expect(session.title?.text).toMatch(/^归档会话 [0-2]$/)
        expect(session.titleRevision).toBe('1')
        expect(session.ownedPaths).toEqual([])
        expect(session.grants).toEqual([])
        expect(page.agents[agentId].profile.systemPrompt).toBe('ARCHIVE_ONLY_PROFILE')
        found.push(session.sessionId)
        after = page.next
      } while (after)
      expect(found).toEqual([...ids].sort())
      expect(await digest()).toBe(before)
      await expect(reader.call('deepchat.storage.scope', { sessionId: ids[0] })).rejects.toThrow()
      await expect(
        reader.call('deepchat.storage.archive_catalog', { directory: archive, limit: 0 })
      ).rejects.toThrow('limit')
      expect(await digest()).toBe(before)
      await target.stop()
      expect(await digest()).toBe(before)
      const staging = path.join(root, 'staging')
      await cp(path.join(root, 'target/dim'), staging, { recursive: true })
      reader = await target.start()
      const transferred = await reader.call<{
        imported: string[]
        skipped: string[]
        events: string
      }>('deepchat.storage.archive_transfer', {
        sourceDirectory: archive,
        targetDirectory: staging
      })
      expect(transferred.imported.sort()).toEqual([...ids].sort())
      expect(transferred.skipped).toEqual([])
      expect(BigInt(transferred.events)).toBeGreaterThan(0n)
      const imported = await reader.call<ArchivePage>('deepchat.storage.archive_catalog', {
        directory: staging,
        limit: 64
      })
      expect(imported.sessions.map((session) => session.sessionId)).toEqual([...ids].sort())
      expect(imported.sessions.every((session) => session.title?.source === 'manual')).toBe(true)
      await expect(
        reader.call('deepchat.storage.archive_transfer', {
          sourceDirectory: archive,
          targetDirectory: staging
        })
      ).resolves.toEqual({ imported: [], skipped: [...ids].sort(), events: '0' })
      await expect(
        reader.call('deepchat.storage.archive_transfer', {
          sourceDirectory: archive,
          targetDirectory: path.join(root, 'target/dim')
        })
      ).rejects.toThrow()
      expect(await digest()).toBe(before)
      await target.stop()
      await rm(path.join(root, 'target/dim'), { recursive: true, force: true })
      await cp(staging, path.join(root, 'target/dim'), { recursive: true })
      reader = await target.start()
      expect(
        await reader.call('deepchat.storage.history', {
          sessionId: ids[0],
          branchId: 'main',
          after: '0',
          limit: 100
        })
      ).toEqual(originalHistory)
      expect(requests).toBe(0)
    } finally {
      await Promise.all([source.stop(), target.stop()])
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000
)
