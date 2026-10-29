import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

for (const action of ['complete', 'held-ready'] as const) {
  test(`Code Mode preserves nested execution and ${action} ownership @smoke`, async ({
    launchApp
  }) => {
    const executable =
      process.platform === 'win32'
        ? `"${process.execPath}"`
        : `'${process.execPath.replaceAll("'", "'\\''")}'`
    const command = `${executable} -e "process.stdout.write('NESTED_CODE_DONE')"`
    const firstCode = `const result = await tools.exec({ command: ${JSON.stringify(command)}, description: 'Verify nested command execution' }); const earlierLocal = 'cell-local'; console.log('CODE_MODE_ONE'); return result`
    const secondCode = `return { earlierLocalType: typeof earlierLocal, processType: typeof process, requireType: typeof require }`
    let toolResults: string[] = []
    const server = createServer(async (request, response) => {
      if (request.url === '/v1/models') {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ data: [{ id: 'code-fixture' }] }))
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
            model: 'code-fixture',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Code Mode verification' },
                finish_reason: 'stop'
              }
            ]
          })
        )
        return
      }
      const results = body.messages.filter((message: { role: string }) => message.role === 'tool')
      toolResults = results.map((message: { content: unknown }) => JSON.stringify(message.content))
      const complete = results.length >= 2
      const delta = complete
        ? { content: 'CODE_MODE_VERIFIED' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `owned-code-${results.length}`,
                type: 'function',
                function: {
                  name: 'run_code',
                  arguments: JSON.stringify({
                    code: results.length ? secondCode : firstCode,
                    description: 'Verify isolated code execution'
                  })
                }
              }
            ]
          }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({
          id: 'code-fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'code-fixture',
          choices: [{ index: 0, delta, finish_reason: complete ? 'stop' : 'tool_calls' }]
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
      if (action === 'held-ready') {
        await active.electronApp.evaluate(({ utilityProcess }) => {
          const fork = utilityProcess.fork
          const fixture = { entered: false, pid: undefined as number | undefined }
          utilityProcess.fork = (entry, args, options) => {
            const host = fork.call(utilityProcess, entry, args, options)
            if (entry.endsWith('codeModeUtilityHost.js')) {
              const on = host.on.bind(host) as (
                event: string,
                listener: (...values: unknown[]) => void
              ) => typeof host
              host.on = ((event: string, listener: (...values: unknown[]) => void) => {
                if (event === 'message')
                  return on(event, (message) => {
                    if ((message as { type?: string })?.type === 'READY') {
                      fixture.entered = true
                      fixture.pid = host.pid
                    } else listener(message)
                  })
                return on(event, listener)
              }) as typeof host.on
            }
            return host
          }
          Object.assign(globalThis, { __codeModeReadyFixture: fixture })
        })
      }
      const sessionId = await active.page.evaluate(
        async ({ baseUrl, projectDir }) => {
          const providerId = `custom-${crypto.randomUUID()}`
          await window.deepchat.invoke('providers.add', {
            provider: {
              id: providerId,
              name: 'Code fixture',
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
              id: 'code-fixture',
              name: 'Code fixture',
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
            modelId: 'code-fixture',
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
            message: 'Verify Code Mode nested execution and isolated session state.',
            providerId,
            modelId: 'code-fixture',
            projectDir,
            permissionMode: 'full_access',
            toolModeOverride: 'code'
          })
          return session.id
        },
        { baseUrl: `http://127.0.0.1:${port}/v1`, projectDir: active.userDataDir }
      )
      if (action === 'held-ready') {
        await expect
          .poll(() =>
            active.electronApp.evaluate(
              () =>
                (globalThis as unknown as { __codeModeReadyFixture: { entered: boolean } })
                  .__codeModeReadyFixture.entered
            )
          )
          .toBe(true)
        const pid = await active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __codeModeReadyFixture: { pid?: number } })
              .__codeModeReadyFixture.pid
        )
        expect(pid).toBeGreaterThan(0)
        expect(await active.close()).toBe('graceful')
        await expect
          .poll(() => {
            try {
              process.kill(pid!, 0)
              return true
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
              throw error
            }
          })
          .toBe(false)
        expect(toolResults).toHaveLength(0)
      } else {
        await expect.poll(() => toolResults.length).toBe(2)
        expect(toolResults[0]).toContain('NESTED_CODE_DONE')
        expect(JSON.parse(JSON.parse(toolResults[1]))).toEqual({
          earlierLocalType: 'undefined',
          processType: 'undefined',
          requireType: 'undefined'
        })
        await expect
          .poll(async () =>
            JSON.stringify(
              await active.page.evaluate(
                (sessionId) =>
                  window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
                sessionId
              )
            )
          )
          .toContain('CODE_MODE_VERIFIED')
        expect(await active.close()).toBe('graceful')
      }
      const reopened = await launchApp()
      await waitForAppReady(reopened.page)
      const { messages } = await reopened.page.evaluate(
        (sessionId) =>
          window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
        sessionId
      )
      expect(JSON.stringify(messages)).toContain(
        action === 'complete' ? 'CODE_MODE_VERIFIED' : 'Verify Code Mode nested execution'
      )
      expect(await reopened.close()).toBe('graceful')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
