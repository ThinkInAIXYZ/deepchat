import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

const isGitAvailable = (): boolean => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('workspace watcher emits file and git invalidations through the typed bridge @smoke', async ({
  app
}) => {
  test.skip(!isGitAvailable(), 'git is required for workspace watcher smoke coverage')

  await waitForAppReady(app.page)

  const workspacePath = mkdtempSync(join(tmpdir(), 'deepchat-e2e-workspace-watch-'))
  const nestedDir = join(workspacePath, 'src')
  const filePath = join(nestedDir, 'watch-target.txt')

  try {
    mkdirSync(nestedDir, { recursive: true })
    execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' })

    await app.page.evaluate(
      async ({ workspacePath }) => {
        const runtime = {
          events: [] as Array<{
            workspacePath: string
            kind: 'fs' | 'git' | 'full'
            source: 'watcher' | 'fallback' | 'lifecycle'
          }>,
          statuses: [] as Array<{
            workspacePath: string
            health: 'healthy' | 'degraded' | 'failed'
            mode: 'native' | 'snapshot-polling' | 'git-metadata-polling'
          }>,
          cleanup: [] as Array<() => void>
        }

        ;(window as any).__workspaceWatcherE2E = runtime

        runtime.cleanup.push(
          window.deepchat.on('workspace.invalidated', (payload) => {
            if (payload.workspacePath === workspacePath) {
              runtime.events.push(payload)
            }
          })
        )

        runtime.cleanup.push(
          window.deepchat.on('workspace.watch.status.changed', (payload) => {
            if (payload.workspacePath === workspacePath) {
              runtime.statuses.push(payload)
            }
          })
        )

        await window.deepchat.invoke('workspace.register', {
          mode: 'workspace',
          workspacePath
        })
        await window.deepchat.invoke('workspace.watch', {
          workspacePath
        })
      },
      { workspacePath }
    )

    await expect
      .poll(
        async () =>
          await app.page.evaluate(() =>
            ((window as any).__workspaceWatcherE2E?.statuses ?? []).some(
              (status: { health: string; mode: string }) =>
                status.health === 'healthy' && status.mode === 'native'
            )
          ),
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000]
        }
      )
      .toBe(true)

    writeFileSync(filePath, 'first\n', 'utf8')

    await expect
      .poll(
        async () =>
          await app.page.evaluate(() =>
            ((window as any).__workspaceWatcherE2E?.events ?? []).some(
              (event: { kind: string }) => event.kind === 'fs' || event.kind === 'full'
            )
          ),
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000]
        }
      )
      .toBe(true)

    execFileSync('git', ['add', 'src/watch-target.txt'], { cwd: workspacePath, stdio: 'ignore' })

    await expect
      .poll(
        async () =>
          await app.page.evaluate(() =>
            ((window as any).__workspaceWatcherE2E?.events ?? []).some(
              (event: { kind: string }) => event.kind === 'git'
            )
          ),
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000]
        }
      )
      .toBe(true)
  } finally {
    await app.page
      .evaluate(
        async ({ workspacePath }) => {
          const runtime = (window as any).__workspaceWatcherE2E
          if (runtime?.cleanup) {
            for (const cleanup of runtime.cleanup) {
              cleanup()
            }
          }

          await window.deepchat
            .invoke('workspace.unwatch', { workspacePath })
            .catch(() => undefined)
          await window.deepchat
            .invoke('workspace.unregister', {
              mode: 'workspace',
              workspacePath
            })
            .catch(() => undefined)

          delete (window as any).__workspaceWatcherE2E
        },
        { workspacePath }
      )
      .catch(() => undefined)
    rmSync(workspacePath, { recursive: true, force: true })
  }
})
