import { spawnSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FIXTURE_PATH = path.join(
  ROOT,
  'src/renderer/settings/__architecture_guard_legacy_fixture__.ts'
)

async function writeSettingsFixture(source: string) {
  await writeFile(FIXTURE_PATH, source, 'utf8')
}

function runArchitectureGuard() {
  return spawnSync(process.execPath, ['scripts/architecture-guard.mjs'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
}

describe.sequential('architecture guard', () => {
  afterEach(async () => {
    await rm(FIXTURE_PATH, { force: true })
  })

  it('fails when settings imports or calls the retired legacy presenter bridge', async () => {
    await writeSettingsFixture(`
      import { useLegacyPresenter } from '@api/legacy/presenters'

      export const fixture = useLegacyPresenter('configPresenter')
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[renderer-business-direct-use-presenter-import]')
    expect(result.stderr).toContain('[renderer-business-direct-use-presenter]')
  })

  it('fails when settings reintroduces raw window.electron IPC listeners', async () => {
    await writeSettingsFixture(`
      export function fixture() {
        window.electron.ipcRenderer.on('settings:navigate', () => {})
      }
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[renderer-business-direct-window-electron]')
    expect(result.stderr).toContain('[renderer-business-direct-ipc-listener]')
  })
})
