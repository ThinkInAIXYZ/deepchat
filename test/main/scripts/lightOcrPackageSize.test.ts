import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { TARGET_IDS } from '../../../scripts/ci/package-contract.mjs'
import { readComponentBudgets } from '../../../scripts/smoke-light-ocr.js'

describe('Light OCR packaged component budgets', () => {
  it('requires OCR and other-runtime budgets for all six targets', async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve('resources/light-ocr-size-budgets.json'), 'utf8')
    ) as {
      schemaVersion: number
      componentBudgetsMiB: {
        ocrAssetsCompressed: number
        nodeRuntimeCompressed: number
        otherRuntimeCompressedByTarget: Record<string, number>
      }
    }

    expect(manifest).toEqual({
      schemaVersion: 1,
      componentBudgetsMiB: {
        ocrAssetsCompressed: 90,
        nodeRuntimeCompressed: 0,
        otherRuntimeCompressedByTarget: {
          'darwin-arm64': 48,
          'darwin-x64': 48,
          'linux-arm64': 48,
          'linux-x64': 48,
          'win32-arm64': 32,
          'win32-x64': 48
        }
      }
    })
    expect(
      Object.keys(manifest.componentBudgetsMiB.otherRuntimeCompressedByTarget).sort()
    ).toEqual([...TARGET_IDS].sort())
    for (const target of TARGET_IDS) {
      expect(readComponentBudgets(manifest, target)).toEqual({
        ocrAssetsCompressed: 90,
        nodeRuntimeCompressed: 0,
        otherRuntimeCompressed: target === 'win32-arm64' ? 32 : 48
      })
    }
  })

  it('fails closed when a target has no other-runtime budget', () => {
    expect(() =>
      readComponentBudgets(
        {
          schemaVersion: 1,
          componentBudgetsMiB: {
            ocrAssetsCompressed: 90,
            nodeRuntimeCompressed: 0,
            otherRuntimeCompressedByTarget: {}
          }
        },
        'darwin-arm64'
      )
    ).toThrow(/Missing or invalid/)
  })
})
