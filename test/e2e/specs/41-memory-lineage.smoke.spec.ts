import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('Memory evidence pages, navigation and selective deletion @smoke', async ({
  launchApp
}, testInfo) => {
  const initial = await launchApp()
  // This fixture writes only to a closed, disposable database, never a developer profile.
  expect(initial.ownsUserDataDir).toBe(true)
  await waitForAppReady(initial.page)
  await initial.page.evaluate(async () => {
    await window.deepchat.invoke('config.updateDeepChatAgent', {
      agentId: 'deepchat',
      updates: { memoryEnabled: true }
    })
  })
  expect(await initial.close()).toBe('graceful')
  const securityPath = join(initial.userDataDir, 'database-security.json')
  if (existsSync(securityPath)) {
    expect(JSON.parse(readFileSync(securityPath, 'utf8')).metadata?.enabled).not.toBe(true)
  }
  const db = new Database(join(initial.userDataDir, 'app_db', 'agent.db'))
  try {
    const now = Date.now()
    const insert = db.prepare(`INSERT INTO agent_memory
      (id, agent_id, kind, content, created_at, status, embedding_state, lifecycle_state)
      VALUES (?, 'deepchat', ?, ?, ?, ?, 'fts_only', ?)`)
    const edge = db.prepare(`INSERT INTO agent_memory_derivation
      (agent_id, parent_memory_id, child_memory_id, derivation_kind, created_at)
      VALUES ('deepchat', ?, 'lineage-root', 'reflection', ?)`)
    db.transaction(() => {
      insert.run(
        'lineage-root',
        'reflection',
        'Prefer clear explanations grounded in project facts.',
        now,
        'fts_only',
        'active'
      )
      for (let index = 0; index < 22; index += 1) {
        const id = `lineage-source-${index}`
        insert.run(
          id,
          'semantic',
          `Project fact ${index + 1}: keep evidence separate from conclusions.`,
          now - index - 1,
          index === 0 ? 'archived' : 'fts_only',
          index === 0 ? 'archived' : 'active'
        )
        edge.run(id, now - 100 + index)
      }
      edge.run('unavailable-source', now - 50)
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
  const root = page.locator('[data-memory-trigger="lineage-root"]')
  await root.click()
  await page.getByTestId('memory-lineage-parents-trigger').click()
  const parents = page.getByTestId('memory-lineage-parents')
  await expect(parents.locator('li')).toHaveCount(20)
  await parents.getByRole('button', { name: /Load more|加载更多|載入更多/ }).click()
  await expect(parents.locator('li')).toHaveCount(23)
  await expect(
    parents.getByText(/Related claim unavailable|相关记忆不可用|相關記憶無法使用/)
  ).toBeVisible()
  await parents.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page
    .getByTestId('memory-inline-panel')
    .screenshot({ path: testInfo.outputPath('memory-lineage-desktop.png') })

  // A mutation outside the panel must invalidate already loaded relation content.
  await page.evaluate(async () => {
    await window.deepchat.invoke('memory.delete', {
      agentId: 'deepchat',
      memoryId: 'lineage-source-1'
    })
  })
  await expect(parents.locator('li')).toHaveCount(20)
  await expect(page.getByTestId('memory-lineage-open-lineage-source-1')).toHaveCount(0)
  await expect(parents.locator('li').nth(1)).toContainText(
    /Related claim unavailable|相关记忆不可用|相關記憶無法使用/
  )

  // Navigation must reveal a related archived row outside the default list filter.
  await page.getByTestId('memory-lineage-open-lineage-source-0').click()
  await expect(page.getByTestId('memory-inline-panel')).toContainText(
    /Archived memories are read-only|已归档记忆为只读|已封存記憶為唯讀/
  )
  await page.getByTestId('memory-lineage-children-trigger').click()
  await expect(page.getByTestId('memory-lineage-open-lineage-root')).toBeVisible()
  await page.setViewportSize({ width: 760, height: 720 })
  await page
    .getByTestId('memory-inline-panel')
    .screenshot({ path: testInfo.outputPath('memory-lineage-narrow.png') })
  await page.getByTestId('memory-inline-delete-trigger').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/will not be deleted automatically|不会自动删除|不會自動刪除/)
  await dialog.screenshot({ path: testInfo.outputPath('memory-lineage-delete.png') })
  await page.getByTestId('memory-inline-delete-confirm').click()
  await expect(dialog).not.toBeVisible()
  const remaining = await page.evaluate(async () => {
    return window.deepchat.invoke('memory.getLineage', {
      agentId: 'deepchat',
      memoryId: 'lineage-root',
      direction: 'parents',
      limit: 1
    })
  })
  expect(remaining.page?.items).toEqual([
    expect.objectContaining({ memoryId: 'lineage-source-0', memory: null })
  ])
})
