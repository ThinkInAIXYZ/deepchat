import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('Memory impact review archives only selected reflections @smoke', async ({
  launchApp
}, testInfo) => {
  const initial = await launchApp()
  expect(initial.ownsUserDataDir).toBe(true)
  await waitForAppReady(initial.page)
  await initial.page.evaluate(() =>
    window.deepchat.invoke('config.updateDeepChatAgent', {
      agentId: 'deepchat',
      updates: { memoryEnabled: true }
    })
  )
  expect(await initial.close()).toBe('graceful')
  const db = new Database(join(initial.userDataDir, 'app_db', 'agent.db'))
  try {
    const now = Date.now()
    const insert = db.prepare(`INSERT INTO agent_memory
      (id, agent_id, kind, content, created_at, status, embedding_state, lifecycle_state)
      VALUES (?, 'deepchat', ?, ?, ?, 'fts_only', 'fts_only', 'active')`)
    db.transaction(() => {
      insert.run('impact-source', 'semantic', 'The project uses PostgreSQL.', now)
      insert.run(
        'impact-a',
        'reflection',
        'Prefer PostgreSQL-specific examples for this project.',
        now - 1
      )
      insert.run(
        'impact-b',
        'reflection',
        'Explain database decisions using concrete project facts.',
        now - 2
      )
      const edge = db.prepare(`INSERT INTO agent_memory_derivation
        (agent_id, parent_memory_id, child_memory_id, derivation_kind, created_at)
        VALUES ('deepchat', 'impact-source', ?, 'reflection', ?)`)
      edge.run('impact-a', now - 2)
      edge.run('impact-b', now - 1)
    })()
  } finally {
    db.close()
  }

  const app = await launchApp()
  await waitForAppReady(app.page)
  const page = await openSettings(app)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => {
    window.location.hash = '#/memory'
  })
  await expect(page.getByTestId('settings-memory-page')).toBeVisible()
  const row = page
    .locator('li')
    .filter({ has: page.locator('[data-memory-trigger="impact-source"]') })
  await row.getByTestId('memory-row-delete').click()
  let dialog = page.getByRole('alertdialog')
  await dialog.getByTestId('memory-impact-trigger').click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog.getByTestId('memory-impact-archive-selected')).toBeDisabled()
  await dialog.screenshot({ path: testInfo.outputPath('memory-impact-delete.png') })
  await page.getByTestId('memory-list-delete-cancel').click()

  await page.locator('[data-memory-trigger="impact-source"]').click()
  await page.getByTestId('memory-inline-edit').click()
  const panel = page.getByTestId('memory-inline-panel')
  await panel.getByTestId('memory-impact-trigger').click()
  await expect(panel.getByRole('checkbox')).toHaveCount(2)
  await panel.getByRole('checkbox').first().click()
  await panel.getByTestId('memory-impact-archive-selected').click()
  await expect(panel.getByTestId('memory-impact-status-impact-a')).toContainText(/Archived|已归档/)
  const preview = await page.evaluate(() =>
    window.deepchat.invoke('memory.getImpact', {
      agentId: 'deepchat',
      memoryId: 'impact-source'
    })
  )
  expect(preview.page?.items.map((item) => item.memory.id)).toEqual(['impact-b'])
  await page.setViewportSize({ width: 760, height: 800 })
  await expect(panel.getByTestId('memory-impact-status-impact-a')).toContainText(/Archived|已归档/)
  await panel.screenshot({ path: testInfo.outputPath('memory-impact-edit.png') })

  // Deleting the source without another selection must preserve the remaining reflection.
  await panel.getByTestId('memory-inline-delete-trigger').click()
  dialog = page.getByRole('alertdialog')
  await dialog.getByTestId('memory-impact-trigger').click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await expect(dialog.getByTestId('memory-impact-archive-selected')).toBeDisabled()
  await page.getByTestId('memory-inline-delete-confirm').click()
  await expect(dialog).not.toBeVisible()
  const result = await page.evaluate(() =>
    window.deepchat.invoke('memory.getByIds', {
      agentId: 'deepchat',
      memoryIds: ['impact-source', 'impact-a', 'impact-b']
    })
  )
  expect(result.memories.map((memory) => [memory.id, memory.status])).toEqual([
    ['impact-a', 'archived'],
    ['impact-b', 'fts_only']
  ])
})
