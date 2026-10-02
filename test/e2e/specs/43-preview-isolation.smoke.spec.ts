import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '../../../src/shared/contracts/channels'

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

test('the app preload does not follow navigation to unrelated files @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const directory = mkdtempSync(join(tmpdir(), 'deepchat-preload-isolation-'))
  const file = join(directory, 'untrusted.html')
  writeFileSync(file, '<!doctype html><html><body>untrusted-document</body></html>')
  try {
    const result = await app.electronApp.evaluate(
      async ({ BrowserWindow }, input) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: input.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        })
        try {
          await window.loadURL(input.appUrl)
          const hasBridge = await window.webContents.executeJavaScript(
            'typeof window.deepchat?.invoke === "function"'
          )
          if (!hasBridge) throw new Error('App preload did not expose its bridge before navigation')
          await window.loadFile(input.file)
          return await window.webContents.executeJavaScript(`({
          content: document.body.textContent,
          api: typeof window.api,
          deepchat: typeof window.deepchat,
          dev: typeof window.__deepchatDev
        })`)
        } finally {
          window.destroy()
        }
      },
      {
        appUrl: app.page.url(),
        preload: fileURLToPath(new URL('../preload/index.mjs', app.page.url())),
        file
      }
    )
    expect(result).toEqual({
      content: 'untrusted-document',
      api: 'undefined',
      deepchat: 'undefined',
      dev: 'undefined'
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('main process rejects direct IPC from an unrelated document @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const directory = mkdtempSync(join(tmpdir(), 'deepchat-ipc-isolation-'))
  const file = join(directory, 'untrusted.html')
  const preload = join(directory, 'probe.cjs')
  writeFileSync(file, '<!doctype html><html><body>IPC probe</body></html>')
  // Deliberately bypass the normal preload gate to exercise the main-process boundary itself.
  writeFileSync(
    preload,
    `
    const { contextBridge, ipcRenderer } = require('electron')
    contextBridge.exposeInMainWorld('probe', {
      invoke: () => ipcRenderer.invoke(${JSON.stringify(DEEPCHAT_ROUTE_INVOKE_CHANNEL)}, 'config.getLanguage', {})
        .then(() => 'unexpectedly allowed', error => error.message)
    })
  `
  )
  try {
    const result = await app.electronApp.evaluate(
      async ({ BrowserWindow }, input) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: { preload: input.preload, contextIsolation: true, nodeIntegration: false }
        })
        try {
          await window.loadFile(input.file)
          return await window.webContents.executeJavaScript('window.probe.invoke()')
        } finally {
          window.destroy()
        }
      },
      { file, preload }
    )
    expect(result).toContain('Native IPC is not available to this document')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
