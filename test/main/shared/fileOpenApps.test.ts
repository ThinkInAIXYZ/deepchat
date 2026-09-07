import { describe, expect, it } from 'vitest'
import {
  appsForPlatform,
  buildLaunchArgs,
  toFileOpenAppPlatform,
  WORKSPACE_FILE_OPEN_APPS,
  type WorkspaceFileOpenAppPlatform
} from '@shared/workspace/fileOpenApps'

const PLATFORMS: WorkspaceFileOpenAppPlatform[] = ['darwin', 'win32', 'linux']

describe('fileOpenApps', () => {
  it('substitutes or appends the target path for exec launches', () => {
    expect(buildLaunchArgs(undefined, '/tmp/file.ts')).toEqual(['/tmp/file.ts'])
    expect(buildLaunchArgs([], '/tmp/file.ts')).toEqual(['/tmp/file.ts'])
    expect(buildLaunchArgs(['--cwd'], '/tmp/dir')).toEqual(['--cwd', '/tmp/dir'])
    expect(buildLaunchArgs(['--working-directory={path}'], '/tmp/dir')).toEqual([
      '--working-directory=/tmp/dir'
    ])
  })

  it('offers an app only when both detect and launch exist', () => {
    for (const definition of WORKSPACE_FILE_OPEN_APPS) {
      const detectPlatforms = Object.keys(definition.detect).sort()
      const launchPlatforms = Object.keys(definition.launch).sort()
      expect(launchPlatforms).toEqual(detectPlatforms)
    }

    for (const platform of PLATFORMS) {
      const offered = appsForPlatform(platform)
      expect(offered.length).toBeGreaterThan(0)
      expect(
        offered.every((definition) => definition.detect[platform] && definition.launch[platform])
      ).toBe(true)
    }
  })

  it('requires a working-directory strategy on every terminal except Hyper', () => {
    const terminals = WORKSPACE_FILE_OPEN_APPS.filter(
      (definition) => definition.kind === 'terminal'
    )

    for (const definition of terminals) {
      for (const launch of Object.values(definition.launch)) {
        if (launch.type !== 'exec') {
          continue
        }

        if (definition.id === 'hyper') {
          expect(launch.args).toBeUndefined()
          continue
        }

        expect(launch.args?.length).toBeGreaterThan(0)
      }
    }
  })

  it('maps unknown process platforms to linux', () => {
    expect(toFileOpenAppPlatform('darwin')).toBe('darwin')
    expect(toFileOpenAppPlatform('win32')).toBe('win32')
    expect(toFileOpenAppPlatform('linux')).toBe('linux')
    expect(toFileOpenAppPlatform('freebsd')).toBe('linux')
  })
})
