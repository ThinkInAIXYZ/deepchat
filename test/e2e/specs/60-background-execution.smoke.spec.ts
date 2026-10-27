import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

for (const action of ['complete', 'shutdown', 'held-start'] as const) {
  test(`background exec retains process feedback and ${action} ownership @smoke`, async ({
    launchApp
  }) => {
    let command = ''
    let firstResult = ''
    let processResult = ''
    let releasePoll!: () => void
    const pollReady = new Promise<void>((resolve) => {
      releasePoll = resolve
    })
    const finalText = `BACKGROUND_${action.toUpperCase()}_VERIFIED`
    const server = createServer(async (request, response) => {
      if (request.url === '/v1/models') {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ data: [{ id: 'exec-fixture' }] }))
        return
      }
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      let source = ''
      for await (const chunk of request) source += chunk
      const body = JSON.parse(source)
      if (!body.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            id: 'title',
            object: 'chat.completion',
            created: 1,
            model: 'exec-fixture',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Execution verification' },
                finish_reason: 'stop'
              }
            ]
          })
        )
        return
      }
      const results = body.messages.filter((message: { role: string }) => message.role === 'tool')
      const toolCall = (name: string, args: unknown) => ({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `owned-${name}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) }
          }
        ]
      })
      let delta: unknown
      let finishReason = 'tool_calls'
      if (!results.length) {
        delta = toolCall('exec', {
          command,
          description: 'Verify owned background execution',
          background: true
        })
      } else if (action === 'complete' && results.length === 1) {
        firstResult = JSON.stringify(results)
        await pollReady
        const sessionId = /bg_[A-Za-z0-9_-]{12}/.exec(firstResult)?.[0]
        delta = toolCall('process', { action: 'poll', sessionId })
      } else {
        if (!firstResult) firstResult = JSON.stringify(results)
        processResult = JSON.stringify(results)
        delta = { content: finalText }
        finishReason = 'stop'
      }
      if (response.destroyed) return
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({
          id: 'exec-fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'exec-fixture',
          choices: [{ index: 0, delta, finish_reason: finishReason }]
        })}\n\n`
      )
      response.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      const active = await launchApp()
      expect(active.ownsUserDataDir).toBe(true)
      await waitForAppReady(active.page)
      if (action === 'held-start') {
        await active.electronApp.evaluate(({ utilityProcess }) => {
          const originalFork = utilityProcess.fork
          const fixture = { entered: false, pid: undefined as number | undefined }
          utilityProcess.fork = (entry, args, options) => {
            const host = originalFork.call(utilityProcess, entry, args, options)
            if (entry.endsWith('backgroundExecUtilityHost.js')) {
              const once = host.once.bind(host) as (
                event: string,
                listener: (...values: unknown[]) => void
              ) => typeof host
              host.once = ((event: string, listener: (...values: unknown[]) => void) => {
                if (event === 'spawn')
                  return once(event, () => {
                    fixture.entered = true
                    fixture.pid = host.pid
                  })
                return once(event, listener)
              }) as typeof host.once
            }
            return host
          }
          Object.assign(globalThis, { __backgroundSpawnFixture: fixture })
        })
      }
      const startedFile = join(active.userDataDir, 'owned-command.pid')
      const releaseFile = join(active.userDataDir, 'owned-command.release')
      const doneFile = join(active.userDataDir, 'owned-command.done')
      const script = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(startedFile)}, String(process.pid)); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(releaseFile)})) { clearInterval(timer); process.stdout.write('BACKGROUND_EXEC_DONE'); fs.writeFileSync(${JSON.stringify(doneFile)}, 'done') } }, 20)`
      const executable =
        process.platform === 'win32'
          ? `"${process.execPath}"`
          : `'${process.execPath.replaceAll("'", "'\\''")}'`
      command = `${executable} -e "eval(Buffer.from('${Buffer.from(script).toString('base64')}', 'base64').toString())"`
      const sessionId = await active.page.evaluate(
        async ({ baseUrl, projectDir }) => {
          const providerId = `custom-${crypto.randomUUID()}`
          await window.deepchat.invoke('providers.add', {
            provider: {
              id: providerId,
              name: 'Execution fixture',
              apiType: 'openai-completions',
              baseUrl,
              apiKey: 'fixture-key',
              enable: true,
              custom: true
            }
          })
          await window.deepchat.invoke('models.addCustom', {
            providerId,
            model: {
              id: 'exec-fixture',
              name: 'Execution fixture',
              enabled: true,
              vision: false,
              functionCall: true,
              reasoning: false,
              contextLength: 32000,
              maxTokens: 8000
            }
          })
          await window.deepchat.invoke('models.setStatus', {
            providerId,
            modelId: 'exec-fixture',
            enabled: true
          })
          const { config } = await window.deepchat.invoke('config.resolveDeepChatAgentConfig', {
            agentId: 'deepchat'
          })
          await window.deepchat.invoke('config.updateDeepChatAgent', {
            agentId: 'deepchat',
            updates: {
              config: {
                ...config,
                permissionMode: 'full_access',
                disabledAgentTools: [],
                enabledSkillNames: [],
                memoryEnabled: false
              }
            }
          })
          const { session } = await window.deepchat.invoke('sessions.create', {
            agentId: 'deepchat',
            message: 'Verify the owned background command and its process feedback.',
            providerId,
            modelId: 'exec-fixture',
            projectDir,
            permissionMode: 'full_access',
            toolModeOverride: 'agent'
          })
          return session.id
        },
        { baseUrl: `http://127.0.0.1:${port}/v1`, projectDir: active.userDataDir }
      )
      if (action === 'held-start') {
        await expect
          .poll(() =>
            active.electronApp.evaluate(
              () =>
                (globalThis as unknown as { __backgroundSpawnFixture: { entered: boolean } })
                  .__backgroundSpawnFixture.entered
            )
          )
          .toBe(true)
        const helperPid = await active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __backgroundSpawnFixture: { pid?: number } })
              .__backgroundSpawnFixture.pid
        )
        expect(helperPid).toBeGreaterThan(0)
        expect(existsSync(startedFile)).toBe(false)
        expect(await active.close()).toBe('graceful')
        await expect
          .poll(() => {
            try {
              process.kill(helperPid!, 0)
              return true
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
              throw error
            }
          })
          .toBe(false)
        expect(existsSync(startedFile)).toBe(false)
        const reopened = await launchApp()
        await waitForAppReady(reopened.page)
        const { messages } = await reopened.page.evaluate(
          (sessionId) =>
            window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
          sessionId
        )
        expect(JSON.stringify(messages)).toContain('Verify the owned background command')
        expect(JSON.stringify(messages)).not.toContain(finalText)
        expect(await reopened.close()).toBe('graceful')
        return
      }
      await expect.poll(() => existsSync(startedFile)).toBe(true)
      const pid = Number(readFileSync(startedFile, 'utf8'))
      const alive = () => {
        try {
          process.kill(pid, 0)
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
          throw error
        }
      }
      expect(alive()).toBe(true)
      await expect.poll(() => firstResult).toMatch(/bg_[A-Za-z0-9_-]{12}/)
      if (action === 'complete') {
        writeFileSync(releaseFile, 'release')
        await expect.poll(() => existsSync(doneFile)).toBe(true)
        await expect.poll(alive).toBe(false)
        releasePoll()
        await expect.poll(() => processResult).toContain('BACKGROUND_EXEC_DONE')
      }
      const messages = () =>
        active.page.evaluate(
          (sessionId) =>
            window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
          sessionId
        )
      await expect.poll(async () => JSON.stringify(await messages())).toContain(finalText)
      expect(await active.close()).toBe('graceful')
      await expect.poll(alive).toBe(false)
      if (action === 'shutdown') expect(existsSync(doneFile)).toBe(false)
      const reopened = await launchApp()
      await waitForAppReady(reopened.page)
      const persisted = await reopened.page.evaluate(
        (sessionId) =>
          window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
        sessionId
      )
      expect(JSON.stringify(persisted)).toContain(finalText)
      expect(await reopened.close()).toBe('graceful')
    } finally {
      releasePoll()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
