import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngDimensions(data: Buffer) {
  if (
    data.length < 24 ||
    !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    data.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error('Expected a PNG image with an IHDR chunk')
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  }
}

describe('macOS DMG layout', () => {
  it('configures matching 1x and 2x Finder backgrounds', async () => {
    const config = parse(await readFile('electron-builder.yml', 'utf8'))

    expect(config.dmg).toMatchObject({
      background: 'build/dmg-background.png',
      iconSize: 96,
      iconTextSize: 13,
      contents: [
        { x: 157, y: 213, type: 'file' },
        { x: 507, y: 213, type: 'link', path: '/Applications' }
      ]
    })
    expect(config.dmg).not.toHaveProperty('window')

    const backgroundPath = config.dmg.background as string
    const retinaBackgroundPath = backgroundPath.replace(/\.([^.]+)$/, '@2x.$1')
    const [background, retinaBackground] = await Promise.all([
      readFile(backgroundPath),
      readFile(retinaBackgroundPath)
    ])

    expect(readPngDimensions(background)).toEqual({ width: 660, height: 400 })
    expect(readPngDimensions(retinaBackground)).toEqual({ width: 1320, height: 800 })
  })
})
