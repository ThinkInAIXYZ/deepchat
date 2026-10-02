import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('workspace HTML keeps modules but cannot access the app bridge @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const workspacePath = mkdtempSync(join(tmpdir(), 'deepchat-preview-isolation-'))
  writeFileSync(
    join(workspacePath, 'index.html'),
    '<!doctype html><html><body><script type="module" src="./app.js"></script></body></html>'
  )
  writeFileSync(
    join(workspacePath, 'app.js'),
    `const data = await (await fetch('./data.json')).json()
     document.body.textContent = data.marker
     try {
       document.body.dataset.parentAccess = typeof parent.deepchat
     } catch (error) {
       document.body.dataset.parentAccess = error.name
     }
     document.body.dataset.ownBridge = typeof window.deepchat`
  )
  writeFileSync(join(workspacePath, 'data.json'), JSON.stringify({ marker: 'module-and-fetch-ok' }))

  try {
    await app.page.evaluate(async (workspacePath) => {
      await window.deepchat.invoke('workspace.register', { mode: 'workspace', workspacePath })
    }, workspacePath)
    // Exercise the real registered protocol independently of attachment MIME classification.
    const rootId = createHash('sha256').update(realpathSync(workspacePath)).digest('hex')
    const previewUrl = `workspace-preview://${rootId}/index.html`

    await app.page.evaluate((url) => {
      const frame = document.createElement('iframe')
      frame.id = 'security-preview'
      frame.sandbox.add('allow-scripts', 'allow-same-origin')
      frame.src = url
      document.body.append(frame)
    }, previewUrl)

    const body = app.page.frameLocator('#security-preview').locator('body')
    await expect(body).toHaveText('module-and-fetch-ok')
    await expect(body).toHaveAttribute('data-parent-access', 'SecurityError')
    await expect(body).toHaveAttribute('data-own-bridge', 'undefined')
    await expect(
      app.page.evaluate(() => window.deepchat.invoke('config.getLanguage', {}))
    ).resolves.toHaveProperty('locale')
  } finally {
    await app.page.evaluate(async (workspacePath) => {
      document.getElementById('security-preview')?.remove()
      await window.deepchat.invoke('workspace.unregister', { mode: 'workspace', workspacePath })
    }, workspacePath)
    rmSync(workspacePath, { recursive: true, force: true })
  }
})
