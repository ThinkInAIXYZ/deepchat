import { describe, expect, it } from 'vitest'

import {
  classifyLightOcrArtifact as classifyRuntimeArtifact,
  getRequiredPdfiumArtifactPaths as getRuntimePdfiumPaths,
  getRequiredPdfiumResourcePaths as getRuntimePdfiumResourcePaths
} from '../../../src/main/ocr/lightOcrNativePayload'
import {
  classifyLightOcrArtifact as classifyScriptArtifact,
  getRequiredPdfiumArtifactPaths as getScriptPdfiumPaths,
  getRequiredPdfiumResourcePaths as getScriptPdfiumResourcePaths,
  groupLightOcrArtifactPaths,
  hasSameLightOcrArtifactInventory
} from '../../../scripts/light-ocr-artifacts.mjs'

describe('Light OCR artifact contract', () => {
  it.each([
    ['native/light_ocr_node.node', 'native-code'],
    ['native/libonnxruntime.1.22.0.dylib', 'native-code'],
    ['native/libonnxruntime.so', 'native-code'],
    ['native/onnxruntime.dll', 'native-code'],
    ['native/runtime-descriptor.json', 'other'],
    ['pdfium/index.cjs', 'pdfium-loader'],
    ['pdfium/pdfium.node', 'pdfium-code'],
    ['pdfium/libpdfium.dylib', 'pdfium-code'],
    ['pdfium/libpdfium.so', 'pdfium-code'],
    ['pdfium/pdfium.dll', 'pdfium-code'],
    ['pdfium/fonts/NotoSansSC-Regular.otf', 'other'],
    ['pdfium/fonts/OFL.txt', 'other'],
    ['licenses/pdfium-native-MIT.txt', 'other'],
    ['pdfium/README.md', 'other']
  ] as const)('classifies %s identically as %s', (relativePath, expected) => {
    expect(classifyScriptArtifact(relativePath)).toBe(expected)
    expect(classifyRuntimeArtifact(relativePath)).toBe(expected)
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'keeps the %s PDFium inventory identical across build boundaries',
    (platform) => {
      expect(getScriptPdfiumPaths(platform)).toEqual(getRuntimePdfiumPaths(platform))
    }
  )

  it('keeps PDFium resource paths identical across build boundaries', () => {
    expect(getScriptPdfiumResourcePaths()).toEqual(getRuntimePdfiumResourcePaths())
  })

  it('accepts the exact PDFium code and font-resource inventory', () => {
    expect(
      groupLightOcrArtifactPaths(
        [
          'native/light_ocr_node.node',
          'native/runtime-descriptor.json',
          ...getScriptPdfiumPaths('darwin')
        ],
        'darwin'
      )
    ).toEqual({
      nativeCode: ['native/light_ocr_node.node'],
      pdfiumCode: ['pdfium/libpdfium.dylib', 'pdfium/pdfium.node'],
      pdfiumLoader: ['pdfium/index.cjs'],
      other: [
        'native/runtime-descriptor.json',
        'pdfium/fonts/NotoSansSC-Regular.otf',
        'pdfium/fonts/OFL.txt'
      ]
    })
  })

  it('rejects a partial PDFium inventory', () => {
    expect(() =>
      groupLightOcrArtifactPaths(
        ['native/light_ocr_node.node', 'pdfium/index.cjs', 'pdfium/pdfium.node'],
        'darwin'
      )
    ).toThrow(/PDFium artifact inventory mismatch/)
  })

  it('rejects unclassified files inside the exact PDFium inventory', () => {
    expect(() =>
      groupLightOcrArtifactPaths(
        [
          'native/light_ocr_node.node',
          'pdfium/index.cjs',
          'pdfium/libpdfium.dylib',
          'pdfium/pdfium.node',
          'pdfium/README.md'
        ],
        'darwin'
      )
    ).toThrow(/PDFium artifact inventory mismatch/)
  })

  it('compares artifact groups independently of object key order', () => {
    const inventory = {
      nativeCode: ['native/light_ocr_node.node'],
      pdfiumCode: ['pdfium/libpdfium.dylib', 'pdfium/pdfium.node'],
      pdfiumLoader: ['pdfium/index.cjs'],
      other: ['native/runtime-descriptor.json']
    }

    expect(
      hasSameLightOcrArtifactInventory(inventory, {
        other: inventory.other,
        pdfiumLoader: inventory.pdfiumLoader,
        pdfiumCode: inventory.pdfiumCode,
        nativeCode: inventory.nativeCode
      })
    ).toBe(true)
    expect(
      hasSameLightOcrArtifactInventory(inventory, {
        ...inventory,
        pdfiumCode: [...inventory.pdfiumCode].reverse()
      })
    ).toBe(false)
  })
})
