import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('scheduler manual and timed runs settle once and survive restart @smoke', async ({
  launchApp
}, testInfo) => {
  let streamedRequests = 0
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'scheduler-fixture' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let source = ''
    for await (const chunk of request) source += chunk
    const body = JSON.parse(source)
    const message = 'SCHEDULER_FIXTURE_DONE'
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'scheduler-fixture',
          object: 'chat.completion',
          created: 1,
          model: 'scheduler-fixture',
          choices: [
            { index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }
          ]
        })
      )
      return
    }
    streamedRequests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(
      `data: ${JSON.stringify({
        id: 'scheduler-fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'scheduler-fixture',
        choices: [
          { index: 0, delta: { role: 'assistant', content: message }, finish_reason: 'stop' }
        ]
      })}\n\ndata: [DONE]\n\n`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const initial = await launchApp()
    expect(initial.ownsUserDataDir).toBe(true)
    await waitForAppReady(initial.page)
    const { schedulerStatus: unused } = await initial.page.evaluate(() =>
      window.deepchat.invoke('cronJobs.getSchedulerStatus', {})
    )
    expect(unused.pid).toBeNull()
    await initial.page.evaluate(async (baseUrl) => {
      const providerId = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id: providerId,
          name: 'Scheduler fixture',
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
          id: 'scheduler-fixture',
          name: 'Scheduler fixture',
          enabled: true,
          vision: false,
          functionCall: false,
          reasoning: false,
          contextLength: 32000,
          maxTokens: 8000
        }
      })
      await window.deepchat.invoke('models.setStatus', {
        providerId,
        modelId: 'scheduler-fixture',
        enabled: true
      })
      await window.deepchat.invoke('config.updateDeepChatAgent', {
        agentId: 'deepchat',
        updates: {
          config: {
            defaultModelPreset: { providerId, modelId: 'scheduler-fixture' },
            memoryEnabled: false,
            subagentEnabled: false,
            permissionMode: 'full_access',
            disabledAgentTools: [],
            enabledSkillNames: []
          }
        }
      })
    }, `http://127.0.0.1:${port}/v1`)
    expect(await initial.close()).toBe('graceful')

    const active = await launchApp()
    await waitForAppReady(active.page)
    const { job } = await active.page.evaluate(() =>
      window.deepchat.invoke('cronJobs.upsert', {
        name: 'Scheduler ownership fixture',
        enabled: true,
        cronExpr: '0 0 1 1 *',
        timezone: 'UTC',
        agentId: 'deepchat',
        taskPrompt: 'Reply with SCHEDULER_FIXTURE_DONE without using tools.',
        runtime: { maxDurationMs: 30_000, maxTurns: 2, concurrencyPolicy: 'queue' }
      })
    )
    expect(
      await active.electronApp.evaluate(({ powerMonitor }) => ({
        listeners: powerMonitor.listenerCount('resume'),
        delivered: [powerMonitor.emit('resume'), powerMonitor.emit('resume')]
      }))
    ).toEqual({ listeners: 1, delivered: [true, true] })
    const { run: manual } = await active.page.evaluate(
      (id) => window.deepchat.invoke('cronJobs.runNow', { id }),
      job.id
    )
    await expect
      .poll(
        async () =>
          (
            await active.page.evaluate(
              (runId) => window.deepchat.invoke('cronJobs.getRun', { runId }),
              manual.id
            )
          ).run.status
      )
      .toBe('completed')
    await active.page.evaluate(
      (job) => window.deepchat.invoke('cronJobs.upsert', { ...job, cronExpr: '*/2 * * * * *' }),
      job
    )
    await expect
      .poll(async () => {
        const { runs } = await active.page.evaluate(
          (jobId) => window.deepchat.invoke('cronJobs.listRuns', { jobId, limit: 20 }),
          job.id
        )
        return runs.some((run) => run.reason === 'scheduled' && run.status === 'completed')
      })
      .toBe(true)
    await active.page.evaluate(
      (job) => window.deepchat.invoke('cronJobs.upsert', { ...job, cronExpr: '0 0 1 1 *' }),
      job
    )
    await expect
      .poll(async () => {
        const { runs } = await active.page.evaluate(
          (jobId) => window.deepchat.invoke('cronJobs.listRuns', { jobId, limit: 20 }),
          job.id
        )
        return runs.every((run) => run.status === 'completed')
      })
      .toBe(true)
    const { runs } = await active.page.evaluate(
      (jobId) => window.deepchat.invoke('cronJobs.listRuns', { jobId, limit: 20 }),
      job.id
    )
    expect(runs.find((run) => run.id === manual.id)?.reason).toBe('manual')
    const scheduled = runs.filter((run) => run.reason === 'scheduled')
    expect(new Set(scheduled.map((run) => run.scheduledAt)).size).toBe(scheduled.length)
    expect(runs.every((run) => run.sessionId && run.outputMessageId)).toBe(true)
    expect(streamedRequests).toBe(runs.length)
    if (process.env.DEEPCHAT_E2E_MEASURE_RESOURCES === '1')
      await new Promise((resolve) => setTimeout(resolve, 30_000))
    expect(await active.close()).toBe('graceful')

    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    const persisted = await reopened.page.evaluate(
      (jobId) => window.deepchat.invoke('cronJobs.listRuns', { jobId, limit: 20 }),
      job.id
    )
    expect(persisted.runs).toEqual(runs)
    expect(streamedRequests).toBe(runs.length)
    await reopened.page.evaluate(
      (id) => window.deepchat.invoke('cronJobs.toggle', { id, enabled: false }),
      job.id
    )
    const { schedulerStatus: stopped } = await reopened.page.evaluate(() =>
      window.deepchat.invoke('cronJobs.restartScheduler', {})
    )
    expect(stopped.pid).toBeNull()
    expect(stopped.enabledJobCount).toBe(0)
    await reopened.page.evaluate((id) => window.deepchat.invoke('cronJobs.delete', { id }), job.id)
    expect(
      (await reopened.page.evaluate(() => window.deepchat.invoke('cronJobs.list', {}))).jobs
    ).toEqual([])
    expect(await reopened.close()).toBe('graceful')
    await testInfo.attach('scheduler-outcomes.json', {
      body: Buffer.from(JSON.stringify({ runs, streamedRequests })),
      contentType: 'application/json'
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
