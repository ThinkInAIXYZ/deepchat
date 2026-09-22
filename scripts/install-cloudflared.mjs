import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const [platform, arch, target] = process.argv.slice(2)
const versions = JSON.parse(
  await readFile(new URL('../resources/runtime-versions.json', import.meta.url), 'utf8')
)
const artifact = versions.cloudflaredArtifacts[`${platform}-${arch}`]
if (!artifact || !target) throw new Error(`No cloudflared artifact for ${platform}-${arch}`)
const staging = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cloudflared-'))
try {
  const response = await fetch(
    `https://github.com/cloudflare/cloudflared/releases/download/${versions.cloudflared}/${artifact.filename}`,
    { signal: AbortSignal.timeout(180_000) }
  )
  if (!response.ok) throw new Error(`cloudflared download failed: ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(data).digest('hex') !== artifact.sha256)
    throw new Error('cloudflared checksum mismatch')
  const archive = path.join(staging, artifact.filename)
  await writeFile(archive, data)
  const executableName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  let executable = archive
  if (artifact.filename.endsWith('.tgz')) {
    const result = spawnSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error('cloudflared extraction failed')
    executable = path.join(staging, executableName)
  }
  await mkdir(target, { recursive: true })
  const destination = path.join(target, executableName)
  await copyFile(executable, `${destination}.tmp`)
  await chmod(`${destination}.tmp`, 0o755)
  await rename(`${destination}.tmp`, destination)
} finally {
  await rm(staging, { recursive: true, force: true })
}
