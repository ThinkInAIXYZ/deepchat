import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DeviceService } from '@/device'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showMessageBoxSync: vi.fn(), showOpenDialog: vi.fn() }
}))
vi.mock('@/lib/svgSanitizer', () => ({ svgSanitizer: { sanitize: vi.fn() } }))

afterEach(() => {
  vi.useRealTimers()
  rmSync(state.userData, { recursive: true, force: true })
})

it('removes native conversations and legacy copies with chat data', async () => {
  vi.useFakeTimers()
  state.userData = mkdtempSync(path.join(tmpdir(), 'deepchat-reset-'))
  for (const file of [
    'app_db/agent.db',
    'app_db/agent.db.legacy-encrypted.1.id.bak',
    'app_db/chat.db',
    'app_db/KnowledgeBase/catalog.db',
    'dim/rust/dimcode.sqlite',
    '.dim-restore-abc/dim/rust/dimcode.sqlite',
    '.sync-import-abc/agent.db',
    '.dim-replica-import.json',
    'sync-import-recovery.json',
    'database-security.json',
    'app-settings.json'
  ]) {
    mkdirSync(path.dirname(path.join(state.userData, file)), { recursive: true })
    writeFileSync(path.join(state.userData, file), 'data')
  }
  const reset = new DeviceService().resetDataByType('chat')
  await vi.advanceTimersByTimeAsync(1000)
  await reset
  expect(readdirSync(path.join(state.userData, 'app_db'))).toEqual(['KnowledgeBase'])
  expect(readdirSync(state.userData).sort()).toEqual(['app-settings.json', 'app_db'])
})
