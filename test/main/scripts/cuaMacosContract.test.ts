import { describe, expect, it } from 'vitest'

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
      '@loader_path/../Frameworks/Example.framework/Example',
      '@executable_path/../Frameworks/Example.framework/Example'
    ]) {
      expect(isAllowedDarwinLoadPath(allowed)).toBe(true)
    }

    expect(
      findDisallowedDarwinLoadPaths([
        '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx',
        '/Users/runner/build/libInjected.dylib',
        '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx'
      ])
    ).toEqual([
      '/Applications/Xcode.app/Contents/Developer/usr/lib/swift/macosx',
      '/Users/runner/build/libInjected.dylib'
    ])
  })
})
