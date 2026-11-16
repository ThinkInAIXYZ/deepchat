import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'

const [platform, arch, target] = process.argv.slice(2)
const versions = JSON.parse(
  await readFile(new URL('../resources/runtime-versions.json', import.meta.url), 'utf8')
)
const artifact = versions.uvArtifacts[`${platform}-${arch}`]
if (platform !== 'win32' || !target || !artifact || versions.uv !== versions.artifactVersions.uv) {
  throw new Error(`No pinned Windows uv artifact for ${platform}-${arch}`)
}

const response = await fetch(
  `https://github.com/astral-sh/uv/releases/download/${versions.uv}/${artifact.filename}`,
  { signal: AbortSignal.timeout(180_000) }
)
if (!response.ok) throw new Error(`uv download failed: ${response.status}`)
const data = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(data).digest('hex') !== artifact.archiveSha256) {
  throw new Error('uv archive checksum mismatch')
}

const executables = ['uv.exe', 'uvx.exe']
const files = unzipSync(data, { filter: ({ name }) => executables.includes(name) })
for (const name of executables) {
  if (!files[name]?.length) throw new Error(`uv archive is missing ${name}`)
}

await mkdir(target, { recursive: true })
const stage = await mkdtemp(path.join(target, '.install-'))
try {
  for (const name of executables) await writeFile(path.join(stage, name), files[name])
  for (const name of executables) await rename(path.join(stage, name), path.join(target, name))
} finally {
  await rm(stage, { recursive: true, force: true })
}
