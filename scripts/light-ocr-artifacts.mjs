import path from 'node:path'
import { lstat, readdir } from 'node:fs/promises'

export const LIGHT_OCR_ARTIFACT_KINDS = Object.freeze({
  nativeCode: 'native-code',
  pdfiumCode: 'pdfium-code',
  pdfiumLoader: 'pdfium-loader',
  other: 'other'
})
export const LIGHT_OCR_ARTIFACT_GROUPS = Object.freeze([
  'nativeCode',
  'pdfiumCode',
  'pdfiumLoader',
  'other'
])

const PDFIUM_ARTIFACTS_BY_PLATFORM = Object.freeze({
  darwin: Object.freeze([
    'pdfium/index.cjs',
    'pdfium/libpdfium.dylib',
    'pdfium/pdfium.node'
  ]),
  linux: Object.freeze(['pdfium/index.cjs', 'pdfium/libpdfium.so', 'pdfium/pdfium.node']),
  win32: Object.freeze(['pdfium/index.cjs', 'pdfium/pdfium.dll', 'pdfium/pdfium.node'])
})
const PDFIUM_RESOURCE_ARTIFACTS = Object.freeze([
  'pdfium/fonts/NotoSansSC-Regular.otf',
  'pdfium/fonts/OFL.txt'
])
const PDFIUM_DIRECTORIES = Object.freeze(['pdfium', 'pdfium/fonts'])

const CODE_EXTENSIONS = new Set(['.dll', '.dylib', '.node', '.so'])
const MAC_CODE_EXTENSIONS = new Set(['.dylib', '.node'])

export function classifyLightOcrArtifact(relativePath) {
  if (relativePath === 'pdfium/index.cjs') return LIGHT_OCR_ARTIFACT_KINDS.pdfiumLoader
  const extension =
    typeof relativePath === 'string' ? path.posix.extname(relativePath).toLowerCase() : ''
  if (
    typeof relativePath === 'string' &&
    relativePath.startsWith('pdfium/') &&
    CODE_EXTENSIONS.has(extension)
  ) {
    return LIGHT_OCR_ARTIFACT_KINDS.pdfiumCode
  }
  if (
    typeof relativePath === 'string' &&
    relativePath.startsWith('native/') &&
    CODE_EXTENSIONS.has(extension)
  ) {
    return LIGHT_OCR_ARTIFACT_KINDS.nativeCode
  }
  return LIGHT_OCR_ARTIFACT_KINDS.other
}

export function isEncodedMacLightOcrArtifact(relativePath) {
  const kind = classifyLightOcrArtifact(relativePath)
  if (
    kind !== LIGHT_OCR_ARTIFACT_KINDS.nativeCode &&
    kind !== LIGHT_OCR_ARTIFACT_KINDS.pdfiumCode
  ) {
    return false
  }
  return MAC_CODE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())
}

export function getRequiredPdfiumArtifactPaths(platform) {
  const paths = PDFIUM_ARTIFACTS_BY_PLATFORM[platform]
  if (!paths) throw new Error(`Unsupported Light OCR PDFium platform: ${String(platform)}`)
  return [...paths, ...PDFIUM_RESOURCE_ARTIFACTS]
}

export function getRequiredPdfiumResourcePaths() {
  return [...PDFIUM_RESOURCE_ARTIFACTS]
}

export function getRequiredPdfiumDirectoryPaths() {
  return [...PDFIUM_DIRECTORIES]
}

export async function inspectRegularArtifactTree(rootDir, relativeRoot) {
  if (
    typeof relativeRoot !== 'string' ||
    relativeRoot.length === 0 ||
    relativeRoot.includes('\\') ||
    path.posix.isAbsolute(relativeRoot) ||
    relativeRoot.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid Light OCR artifact tree root: ${String(relativeRoot)}`)
  }

  const resolvedRoot = path.resolve(rootDir)
  const files = []
  const directories = []
  const visit = async (relativePath) => {
    const absolutePath = path.resolve(resolvedRoot, ...relativePath.split('/'))
    const relative = path.relative(resolvedRoot, absolutePath)
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Light OCR artifact tree escapes its package: ${relativePath}`)
    }

    const entryStat = await lstat(absolutePath)
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Light OCR artifact tree contains a symbolic link: ${relativePath}`)
    }
    if (entryStat.isFile()) {
      files.push(relativePath)
      return
    }
    if (!entryStat.isDirectory()) {
      throw new Error(`Light OCR artifact tree contains an unsupported entry: ${relativePath}`)
    }

    directories.push(relativePath)
    const entries = await readdir(absolutePath)
    for (const entry of entries) {
      await visit(`${relativePath}/${entry}`)
    }
  }

  await visit(relativeRoot)
  files.sort()
  directories.sort()
  return { files, directories }
}

export function groupLightOcrArtifactPaths(relativePaths, platform) {
  const groups = {
    nativeCode: [],
    pdfiumCode: [],
    pdfiumLoader: [],
    other: []
  }
  const seen = new Set()
  for (const relativePath of relativePaths) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('Light OCR artifact inventory contains an invalid path')
    }
    if (seen.has(relativePath)) {
      throw new Error(`Light OCR artifact inventory contains a duplicate path: ${relativePath}`)
    }
    seen.add(relativePath)
    const kind = classifyLightOcrArtifact(relativePath)
    if (kind === LIGHT_OCR_ARTIFACT_KINDS.nativeCode) groups.nativeCode.push(relativePath)
    else if (kind === LIGHT_OCR_ARTIFACT_KINDS.pdfiumCode) groups.pdfiumCode.push(relativePath)
    else if (kind === LIGHT_OCR_ARTIFACT_KINDS.pdfiumLoader) {
      groups.pdfiumLoader.push(relativePath)
    } else {
      groups.other.push(relativePath)
    }
  }

  for (const paths of Object.values(groups)) paths.sort()
  if (groups.nativeCode.length === 0) {
    throw new Error('Light OCR native artifact inventory contains no runtime code')
  }
  const expectedPdfiumPaths = getRequiredPdfiumArtifactPaths(platform).sort()
  const actualPdfiumPaths = [...seen].filter((relativePath) =>
    relativePath.startsWith('pdfium/')
  ).sort()
  if (
    expectedPdfiumPaths.length !== actualPdfiumPaths.length ||
    expectedPdfiumPaths.some((relativePath, index) => relativePath !== actualPdfiumPaths[index])
  ) {
    throw new Error(
      `Light OCR PDFium artifact inventory mismatch for ${platform}: expected ${expectedPdfiumPaths.join(', ')}`
    )
  }
  return groups
}

export function hasSameLightOcrArtifactInventory(left, right) {
  return LIGHT_OCR_ARTIFACT_GROUPS.every((group) => {
    const leftPaths = left?.[group]
    const rightPaths = right?.[group]
    return (
      Array.isArray(leftPaths) &&
      Array.isArray(rightPaths) &&
      leftPaths.length === rightPaths.length &&
      leftPaths.every((relativePath, index) => relativePath === rightPaths[index])
    )
  })
}
