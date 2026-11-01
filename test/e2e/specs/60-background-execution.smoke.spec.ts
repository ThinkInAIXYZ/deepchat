import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

for (const action of [
  'complete',
  'environment',
  'shutdown',
  'held-start',
  'helper-loss',
  'registration-failure',
  'exec-transition',
  'group-shutdown',
  'group-helper-loss',
  'root-exit',
  'escaped-root-exit',
  'registration-loss'
] as const) {
  test(`background exec retains process feedback and ${action} ownership @smoke`, async ({
    launchApp
  }, testInfo) => {
    const rootExits = action === 'root-exit' || action === 'escaped-root-exit'
    const hasDescendant = action === 'group-shutdown' || action === 'group-helper-loss' || rootExits
    test.skip(
      action === 'exec-transition' && process.platform !== 'darwin',
      'macOS native identity'
    )
    test.skip(hasDescendant && process.platform === 'win32', 'POSIX process group')
    test.skip(
      (action === 'group-helper-loss' || rootExits) && process.platform !== 'darwin',
      'macOS identity-bound recovery'
    )
    test.skip(
      action === 'registration-loss' && process.platform !== 'darwin',
      'macOS execution gate'
    )
    let command = ''
    let firstResult = ''
    let processResult = ''
    let environmentStarted = false
    let releaseEnvironment!: () => void
    const environmentReady = new Promise<void>((resolve) => {
      releaseEnvironment = resolve
    })
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
            id: `owned-${name}${results.length > 1 ? `-${results.length}` : ''}`,
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
      } else if (
        (action === 'complete' || action === 'environment' || rootExits) &&
        results.length === 1
      ) {
        firstResult = JSON.stringify(results)
        await pollReady
        const sessionId = /bg_[A-Za-z0-9_-]{12}/.exec(firstResult)?.[0]
        delta = toolCall('process', { action: 'poll', sessionId })
      } else if (
        (rootExits || (action === 'environment' && !environmentStarted)) &&
        JSON.parse(results.at(-1).content).status === 'running'
      ) {
        const sessionId = /bg_[A-Za-z0-9_-]{12}/.exec(firstResult)?.[0]
        delta = toolCall('process', { action: 'poll', sessionId })
      } else if (action === 'environment' && !environmentStarted) {
        processResult = JSON.stringify(results)
        await environmentReady
        environmentStarted = true
        delta = toolCall('exec', {
          command,
          description: 'Verify cleared command environment',
          background: false,
          yieldMs: 30_000
        })
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
    let releaseCommand: (() => void) | undefined
    let drainReleasedCommand: (() => Promise<void>) | undefined
    let restoreRegistry: (() => void) | undefined
    let releaseObservation: (() => void) | undefined
    try {
      const active = await launchApp()
      expect(active.ownsUserDataDir).toBe(true)
      await waitForAppReady(active.page)
      const proxyUrl = `http://127.0.0.1:${port}`
      if (action === 'environment') {
        await active.page.evaluate(async (url) => {
          await window.deepchat.invoke('config.setCustomProxyUrl', { url })
          await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
        }, proxyUrl)
      }
      if (action === 'registration-failure') {
        const registryRoot = join(active.userDataDir, 'child-processes')
        const registryDirectory = join(registryRoot, 'background-exec')
        mkdirSync(registryRoot, { recursive: true })
        expect(existsSync(registryDirectory)).toBe(false)
        writeFileSync(registryDirectory, 'unavailable registry directory')
        restoreRegistry = () => {
          rmSync(registryDirectory, { force: true })
          mkdirSync(registryDirectory)
          restoreRegistry = undefined
        }
      }
      const observationFile = join(active.userDataDir, 'held-exec-observation')
      let observerDirectory: string | undefined
      if (action === 'registration-loss') {
        observerDirectory = join(active.userDataDir, 'exec-observer')
        mkdirSync(observerDirectory)
        const executable =
          (await active.electronApp.evaluate(() => process.env.DEEPCHAT_HARNESS_EXECUTABLE)) ??
          `${process.cwd()}/out/harness/deepchat-harness-${process.platform}-${process.arch}`
        const release = join(observerDirectory, 'release')
        releaseObservation = () => writeFileSync(release, 'release')
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
        const script = `#!/bin/sh\nif [ "$1" = "--exec-gate" ]; then while [ ! -f ${quote(release)} ]; do /bin/sleep 0.02; done; exec ${quote(executable)} "$@"; fi\nif [ "$1" = "--process-identity" ]; then target="$2"; binary=${quote(executable)}; elif [ "$1" = "-ww" ]; then target="$3"; binary=/bin/ps; else exec ${quote(executable)} "$@"; fi\nprintf '%s %s' "$target" "$$" > ${quote(observationFile)}\nwhile [ ! -f ${quote(release)} ]; do /bin/sleep 0.02; done\nexec "$binary" "$@"\n`
        for (const name of ['ps', 'harness'])
          writeFileSync(join(observerDirectory, name), script, { mode: 0o755 })
      }
      if (
        action === 'held-start' ||
        action === 'helper-loss' ||
        action === 'group-helper-loss' ||
        action === 'exec-transition' ||
        action === 'registration-loss'
      ) {
        await active.electronApp.evaluate(
          ({ utilityProcess }, { holdStart, observerDirectory }) => {
            const originalFork = utilityProcess.fork
            const fixture = {
              entered: false,
              pid: undefined as number | undefined,
              crash: () => {}
            }
            utilityProcess.fork = (entry, args, options) => {
              if (entry.endsWith('backgroundExecUtilityHost.js') && observerDirectory) {
                options = {
                  ...options,
                  env: {
                    ...process.env,
                    ...options?.env,
                    PATH: `${observerDirectory}:${process.env.PATH ?? ''}`,
                    DEEPCHAT_HARNESS_EXECUTABLE: `${observerDirectory}/harness`
                  }
                }
              }
              const host = originalFork.call(utilityProcess, entry, args, options)
              if (entry.endsWith('backgroundExecUtilityHost.js')) {
                fixture.crash = () => {
                  host.kill()
                }
                if (!holdStart) return host
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
          },
          { holdStart: action === 'held-start', observerDirectory }
        )
      }
      const startedFile = join(active.userDataDir, 'owned-command.pid')
      const releaseFile = join(active.userDataDir, 'owned-command.release')
      releaseCommand = () => writeFileSync(releaseFile, 'release')
      const doneFile = join(active.userDataDir, 'owned-command.done')
      const execFile = join(active.userDataDir, 'owned-command.exec')
      const descendantFile = join(active.userDataDir, 'owned-command.descendant')
      const rootExitFile = join(active.userDataDir, 'owned-command.root-exit')
      const environmentFile = join(active.userDataDir, 'owned-command.environment')
      let script = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(startedFile)}, String(process.pid)); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(releaseFile)})) { clearInterval(timer); process.stdout.write('BACKGROUND_EXEC_DONE'); fs.writeFileSync(${JSON.stringify(doneFile)}, 'done') } }, 20)`
      if (action === 'environment')
        script = `require('node:fs').writeFileSync(${JSON.stringify(environmentFile)}, JSON.stringify({ proxy: process.env.HTTP_PROXY ?? null, utility: process.env.DEEPCHAT_EXEC_UTILITY_HOST ?? null })); ${script}`
      if (hasDescendant) {
        const descendant = `process.on('SIGTERM', () => {}); const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(releaseFile)})) { clearInterval(timer); fs.writeFileSync(${JSON.stringify(doneFile)}, 'done'); process.exit(0) } }, 20); process.stdout.write('ready')`
        script = `const fs = require('node:fs'); const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: ${action === 'escaped-root-exit'}, stdio: ['ignore', 'pipe', 'ignore'] }); child.stdout.once('data', () => { fs.writeFileSync(${JSON.stringify(descendantFile)}, String(child.pid)); fs.writeFileSync(${JSON.stringify(startedFile)}, String(process.pid)) }); setInterval(() => { if (fs.existsSync(${JSON.stringify(rootExitFile)})) { process.stdout.write('ROOT_EXITED', () => process.exit(0)) } else if (fs.existsSync(${JSON.stringify(releaseFile)})) process.exit(0) }, 20)`
      }
      const executable =
        process.platform === 'win32'
          ? `"${process.execPath}"`
          : `'${process.execPath.replaceAll("'", "'\\''")}'`
      command = `${executable} -e "eval(Buffer.from('${Buffer.from(script).toString('base64')}', 'base64').toString())"`
      if (hasDescendant || action === 'registration-loss') command = `exec ${command}`
      if (action === 'helper-loss' && process.platform !== 'win32') command += '; wait'
      if (action === 'exec-transition') {
        const inner = `while [ ! -f '${execFile.replaceAll("'", "'\\''")}' ]; do sleep 0.02; done; exec ${command}`
        command = `exec /bin/sh -c '${inner.replaceAll("'", "'\\''")}'`
      }
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
      if (action === 'registration-loss') {
        await expect.poll(() => existsSync(observationFile)).toBe(true)
        const [rootPid, observerPid] = readFileSync(observationFile, 'utf8').split(' ').map(Number)
        expect(rootPid).toBeGreaterThan(0)
        expect(observerPid).toBeGreaterThan(0)
        const alive = (pid: number) => {
          try {
            process.kill(pid, 0)
            return true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
            throw error
          }
        }
        drainReleasedCommand = async () => {
          await expect.poll(() => alive(rootPid)).toBe(false)
          await expect.poll(() => alive(observerPid)).toBe(false)
        }
        await active.electronApp.evaluate(() =>
          (
            globalThis as unknown as { __backgroundSpawnFixture: { crash(): void } }
          ).__backgroundSpawnFixture.crash()
        )
        await expect.poll(() => alive(rootPid)).toBe(false)
        await expect.poll(() => alive(observerPid)).toBe(false)
        releaseObservation?.()
        expect(existsSync(startedFile)).toBe(false)
        expect(existsSync(doneFile)).toBe(false)
        const exitCode = active.electronApp.process().exitCode
        if (exitCode === null) expect(await active.close()).toBe('graceful')
        else expect([0, 1]).toContain(exitCode)
        const reopened = await launchApp()
        await waitForAppReady(reopened.page)
        const persisted = await reopened.page.evaluate(
          (sessionId) =>
            window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
          sessionId
        )
        expect(JSON.stringify(persisted)).toContain('Verify the owned background command')
        expect(existsSync(startedFile)).toBe(false)
        expect(await reopened.close()).toBe('graceful')
        return
      }
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
      if (action === 'registration-failure') {
        await expect.poll(() => firstResult).not.toBe('')
        expect(firstResult).toContain('could not be registered')
        expect(firstResult).not.toMatch(/bg_[A-Za-z0-9_-]{12}/)
        restoreRegistry?.()
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
          .toContain(finalText)
        expect(await active.close()).toBe('graceful')
        const reopened = await launchApp()
        await waitForAppReady(reopened.page)
        const persisted = await reopened.page.evaluate(
          (sessionId) =>
            window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
          sessionId
        )
        expect(JSON.stringify(persisted)).toContain('could not be registered')
        expect(await reopened.close()).toBe('graceful')
        return
      }
      let registeredPid: number | undefined
      if (action === 'exec-transition') {
        await expect.poll(() => firstResult).toMatch(/bg_[A-Za-z0-9_-]{12}/)
        const registry = join(active.userDataDir, 'child-processes', 'background-exec')
        const record = JSON.parse(
          readFileSync(
            join(registry, readdirSync(registry).find((name) => name.endsWith('.json'))!),
            'utf8'
          )
        )
        registeredPid = record.pid
        await testInfo.attach('exec-transition-registry.json', {
          body: JSON.stringify(record),
          contentType: 'application/json'
        })
        writeFileSync(execFile, 'exec')
      }
      await expect.poll(() => existsSync(startedFile)).toBe(true)
      const pid = Number(readFileSync(startedFile, 'utf8'))
      if (action === 'exec-transition') expect(pid).toBe(registeredPid)
      const alive = (targetPid = pid) => {
        try {
          process.kill(targetPid, 0)
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
          throw error
        }
      }
      const descendantPid = hasDescendant ? Number(readFileSync(descendantFile, 'utf8')) : undefined
      if (descendantPid) {
        expect(alive(descendantPid)).toBe(true)
        drainReleasedCommand = async () => {
          await expect.poll(() => alive(descendantPid)).toBe(false)
          await expect.poll(alive).toBe(false)
        }
      }
      expect(alive()).toBe(true)
      await expect.poll(() => firstResult).toMatch(/bg_[A-Za-z0-9_-]{12}/)
      if (
        action === 'helper-loss' ||
        action === 'exec-transition' ||
        action === 'group-helper-loss'
      ) {
        await active.electronApp.evaluate(() =>
          (
            globalThis as unknown as { __backgroundSpawnFixture: { crash(): void } }
          ).__backgroundSpawnFixture.crash()
        )
        await expect.poll(alive).toBe(false)
        if (descendantPid) await expect.poll(() => alive(descendantPid)).toBe(false)
        expect(existsSync(doneFile)).toBe(false)
      }
      if (action === 'complete' || action === 'environment') {
        if (action === 'environment') {
          expect(JSON.parse(readFileSync(environmentFile, 'utf8')).proxy).toBe(proxyUrl)
        }
        writeFileSync(releaseFile, 'release')
        await expect.poll(() => existsSync(doneFile)).toBe(true)
        await expect.poll(alive).toBe(false)
        releasePoll()
        await expect.poll(() => processResult).toContain('BACKGROUND_EXEC_DONE')
        if (action === 'environment') {
          await active.page.evaluate(() =>
            window.deepchat.invoke('config.setProxyMode', { mode: 'none' })
          )
          releaseEnvironment()
          await expect
            .poll(() => JSON.parse(readFileSync(environmentFile, 'utf8')))
            .toEqual({ proxy: null, utility: null })
        }
      }
      if (rootExits) {
        if (action === 'escaped-root-exit') {
          const group = (target: number) =>
            Number(
              execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(target)], {
                encoding: 'utf8',
                timeout: 5000
              }).trim()
            )
          expect(group(pid)).toBe(pid)
          expect(group(descendantPid!)).toBe(descendantPid)
          expect(descendantPid).not.toBe(pid)
        }
        writeFileSync(rootExitFile, 'exit')
        await expect.poll(alive).toBe(false)
        await expect.poll(() => alive(descendantPid)).toBe(false)
        expect(existsSync(doneFile)).toBe(false)
        releasePoll()
        await expect.poll(() => processResult).toContain('ROOT_EXITED')
        const polled = JSON.parse(JSON.parse(processResult).at(-1).content)
        expect(polled).toMatchObject({ status: 'done', exitCode: 0 })
      }
      const messages = () =>
        active.page.evaluate(
          (sessionId) =>
            window.deepchat.invoke('sessions.listMessagesPage', { sessionId, limit: 100 }),
          sessionId
        )
      await expect.poll(async () => JSON.stringify(await messages())).toContain(finalText)
      if (action === 'environment') {
        expect(JSON.parse(processResult).at(-1).content).toContain('BACKGROUND_EXEC_DONE')
        await expect.poll(() => alive(Number(readFileSync(startedFile, 'utf8')))).toBe(false)
      }
      expect(await active.close()).toBe('graceful')
      await expect.poll(alive).toBe(false)
      if (descendantPid) await expect.poll(() => alive(descendantPid)).toBe(false)
      if (action === 'shutdown') expect(existsSync(doneFile)).toBe(false)
      if (hasDescendant) expect(existsSync(doneFile)).toBe(false)
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
      restoreRegistry?.()
      releaseObservation?.()
      releaseCommand?.()
      await drainReleasedCommand?.()
      releasePoll()
      releaseEnvironment()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
