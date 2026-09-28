import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { getActiveSessionId, selectAgent, sendMessage } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

// A local stdio peer exercises the real transport, IPC, form and persisted projection.
test('ACP questions resume the owning prompt and keep child output separate @smoke', async ({
  app
}) => {
  const script = join(app.userDataDir, 'acp-extension-fixture.mjs')
  writeFileSync(
    script,
    `
import { createInterface } from 'node:readline'
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const reply = (id, result) => send({ id, result })
const update = (update) => send({ method: 'session/update', params: { sessionId: 'remote', update } })
const usage = { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 40 }
let promptId
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  const { id, method } = message
  if (method === 'initialize') reply(id, { protocolVersion: 1, agentInfo: { name: 'fixture', version: '1' }, agentCapabilities: { _meta: { lody: { usage: { version: 1 }, rateLimits: { version: 1, query: true }, subagentEvents: { version: 1 } } } }, authMethods: [] })
  else if (method === 'session/new') reply(id, { sessionId: 'remote' })
  else if (method === '_lody/rate_limits/get') reply(id, { rateLimits: [] })
  else if (method === 'session/prompt') {
    promptId = id
    update({ sessionUpdate: 'usage_update', used: 400, size: 1000 })
    update({ sessionUpdate: 'plan_update', plan: { planId: 'implementation', type: 'items', entries: [{ content: 'Verify structured answers', priority: 'high', status: 'in_progress' }] } })
    send({ method: '_lody/session/usage_update', params: { sessionId: 'remote', usage, modelUsage: { fixture: usage } } })
    send({ method: '_lody/subagents/event', params: { version: 1, sessionId: 'remote', runId: 'child', type: 'snapshot', snapshot: { state: 'running', name: 'Child verification', support: { stream: ['text'], progress: false, outputRead: 'none', cancel: false } } } })
    send({ method: '_lody/subagents/event', params: { version: 1, sessionId: 'remote', runId: 'child', type: 'output', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CHILD_ONLY_OUTPUT' } } } })
    send({ id: 'questions', method: 'elicitation/create', params: { sessionId: 'remote', mode: 'form', message: 'Choose the implementation and checks', requestedSchema: { type: 'object', required: ['strategy', 'checks', 'privateNote'], properties: { strategy: { type: 'string', title: 'Strategy', oneOf: [{ const: 'minimal', title: 'Minimal' }, { const: 'complete', title: 'Complete' }] }, checks: { type: 'array', title: 'Checks', items: { type: 'string', enum: ['types', 'tests'] }, minItems: 1 }, privateNote: { type: 'string', title: 'Private note', _meta: { lody: { elicitation: { version: 1, secret: true } } } } } } } })
  } else if (id === 'questions' && message.result) {
    const answer = message.result
    const valid = answer.action === 'accept' && answer.content.strategy === 'complete' && answer.content.checks.join(',') === 'types,tests' && answer.content.privateNote === 'fixture-private-value'
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: valid ? 'ACP_ANSWERS_OK fixture-private-value' : 'ACP_ANSWERS_INVALID' } })
    reply(promptId, { stopReason: 'end_turn' })
  } else if (id !== undefined) reply(id, {})
})
`
  )
  await waitForAppReady(app.page)
  const agentId = await app.page.evaluate(
    async ({ script, command }) => {
      await window.deepchat.invoke('config.setAcpEnabled', { enabled: true })
      const { agent } = (await window.deepchat.invoke('config.addManualAcpAgent', {
        name: 'ACP extension fixture',
        command,
        args: [script],
        enabled: true
      })) as { agent: { id: string } }
      return agent.id
    },
    { script, command: process.execPath }
  )
  await expect(
    app.page.locator(`[data-testid="sidebar-agent-button"][data-agent-id="${agentId}"]`)
  ).toBeVisible()
  await selectAgent(app.page, agentId)
  await sendMessage(app.page, 'Verify ACP structured answers')
  await expect(app.page.getByText('Choose the implementation and checks').first()).toBeVisible()
  await app.page.getByLabel('Complete', { exact: true }).check()
  await app.page.getByLabel('types', { exact: true }).check()
  await app.page.getByLabel('tests', { exact: true }).check()
  const secret = app.page.getByLabel('Private note', { exact: true })
  await expect(secret).toHaveAttribute('type', 'password')
  await secret.fill('fixture-private-value')
  await app.page.screenshot({ path: '/tmp/deepchat-acp-questions.png' })
  await secret.locator('xpath=ancestor::form').locator('button[type="submit"]').click()
  await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
    'data-generating',
    'false',
    { timeout: 15000 }
  )
  await expect(app.page.getByTestId('chat-message-assistant')).toContainText(
    'ACP_ANSWERS_OK [redacted]'
  )
  await expect(app.page.getByTestId('chat-message-assistant')).not.toContainText(
    'CHILD_ONLY_OUTPUT'
  )
  const sessionId = await getActiveSessionId(app.page)
  const state = (await app.page.evaluate(
    async ({ sessionId, agentId }) =>
      await window.deepchat.invoke('acp.extensions.inspect', { sessionId, agentId }),
    { sessionId, agentId }
  )) as {
    state: {
      usage: { total: { inputTokens: number } }
      runs: Record<string, { blocks: Array<{ content: string }> }>
    }
  }
  expect(state.state.usage.total.inputTokens).toBe(120)
  expect(state.state.runs.child.blocks[0].content).toBe('CHILD_ONLY_OUTPUT')
  await app.page
    .getByRole('button', {
      name: /ACP.*(status|状态|狀態)|Session status|Agent status|代理状态|代理狀態/i
    })
    .click()
  await expect(app.page.getByText('Child verification')).toBeVisible()
  await app.page.getByText('Child verification').click()
  await expect(app.page.getByText('CHILD_ONLY_OUTPUT')).toBeVisible()
  await app.page.screenshot({ path: '/tmp/deepchat-acp-status.png' })
  expect(app.pageErrors).toEqual([])
})
