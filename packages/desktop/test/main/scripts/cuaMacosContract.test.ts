import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  findDisallowedDarwinLoadPaths,
  isAllowedDarwinLoadPath,
  parseDarwinLinkedLibraries,
  parseDarwinRpaths
} from '../../../scripts/cua-macos-contract.mjs'

describe('cua-macos-contract', () => {
  it('deduplicates RPATHs reported for universal Mach-O slices', () => {
    const output = `
driver (architecture x86_64):
          cmd LC_RPATH
      cmdsize 32
         path /usr/lib/swift (offset 12)
          cmd LC_RPATH
      cmdsize 120
         path /Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx (offset 12)
driver (architecture arm64):
          cmd LC_RPATH
      cmdsize 32
         path /usr/lib/swift (offset 12)
          cmd LC_RPATH
      cmdsize 120
         path /Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx (offset 12)
          cmd LC_FILESET_ENTRY
      cmdsize 48
         path /Users/runner/not-an-rpath (offset 24)
`

    expect(parseDarwinRpaths(output)).toEqual([
      '/usr/lib/swift',
      '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'
    ])
  })

  it('parses universal linked-library output without treating image headers as paths', () => {
    const output = `
driver (architecture x86_64):
\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0, current version 2685.0.0)
\t@rpath/libswiftCore.dylib (compatibility version 0.0.0, current version 0.0.0)
driver (architecture arm64):
\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0, current version 2685.0.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)
`

    expect(parseDarwinLinkedLibraries(output)).toEqual([
      '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit',
      '@rpath/libswiftCore.dylib',
      '/usr/lib/libSystem.B.dylib'
    ])
  })

  it('allows only system and loader-relative paths', () => {
    for (const allowed of [
      '/System/Library/Frameworks/AppKit.framework/AppKit',
      '/usr/lib/swift/libswiftCore.dylib',
      '@rpath/libswiftCore.dylib',
      '@loader_path/../Frameworks',
      '@loader_path/../Frameworks/Example.framework/Example',
      '@executable_path/../Frameworks/Example.framework/Example'
    ]) {
      expect(isAllowedDarwinLoadPath(allowed)).toBe(true)
    }

    expect(
      findDisallowedDarwinLoadPaths([
        '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx',
        '/Users/runner/build/libInjected.dylib',
        '/usr/lib/../../Users/runner/build/libInjected.dylib',
        '@loader_path/../../../../etc/evil.dylib',
        '@loader_path/../Frameworks/../../etc/evil.dylib',
        '@executable_path/../Resources/evil.dylib',
        '@rpath/../evil.dylib',
        '@rpath/./evil.dylib',
        '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'
      ])
    ).toEqual([
      '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx',
      '/Users/runner/build/libInjected.dylib',
      '/usr/lib/../../Users/runner/build/libInjected.dylib',
      '@loader_path/../../../../etc/evil.dylib',
      '@loader_path/../Frameworks/../../etc/evil.dylib',
      '@executable_path/../Resources/evil.dylib',
      '@rpath/../evil.dylib',
      '@rpath/./evil.dylib'
    ])
  })

  it('excludes only the managed CUA helper subtree from electron-builder signing', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8'))
    expect(config.mac.signIgnore).toEqual([
      '/Contents/Helpers/DeepChat Computer Use[.]app(?:/|$)'
    ])

    const ignored = config.mac.signIgnore.map((pattern: string) => new RegExp(pattern))
    const matches = (filePath: string) => ignored.some((pattern: RegExp) => pattern.test(filePath))
    const helperPath = '/tmp/DeepChat.app/Contents/Helpers/DeepChat Computer Use.app'

    expect(matches(helperPath)).toBe(true)
    expect(matches(`${helperPath}/Contents/MacOS/deepchat-cua-driver`)).toBe(true)
    expect(matches(`${helperPath}.backup/Contents/MacOS/deepchat-cua-driver`)).toBe(false)
    expect(matches('/tmp/DeepChat.app/Contents/Helpers/DeepChat Helper.app')).toBe(false)
    expect(
      matches('/tmp/DeepChat.app/Contents/Resources/DeepChat Computer Use.app')
    ).toBe(false)
  })
})
