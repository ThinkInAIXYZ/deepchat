#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { validateSourceSha } from './package-contract.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?)$/

export function prepareReleaseContext({ tag, sourceSha, packageJson, changelog }) {
  const tagMatch = RELEASE_TAG_PATTERN.exec(tag ?? '')
  if (!tagMatch) {
    throw new Error(`Release tag has unsupported format: ${tag}`)
  }
  validateSourceSha(sourceSha, 'release source SHA')
  if (!packageJson || typeof packageJson.version !== 'string') {
    throw new Error('package.json does not contain a valid version')
  }
  const version = tagMatch[1]
  if (packageJson.version !== version) {
    throw new Error(`Release tag ${tag} does not match package.json version ${packageJson.version}`)
  }

  const normalizedChangelog = String(changelog)
    .replaceAll('（', '(')
    .replaceAll('）', ')')
    .replace(/\r$/gm, '')
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headerPattern = new RegExp(
    `^##\\s+v${escapedVersion}\\s*\\(\\d{4}-\\d{2}-\\d{2}\\)\\s*$`,
    'gm'
  )
  const headerMatches = [...normalizedChangelog.matchAll(headerPattern)]
  if (headerMatches.length === 0) {
    throw new Error(`CHANGELOG.md is missing a dated v${version} section`)
  }
  if (headerMatches.length !== 1) {
    throw new Error(`CHANGELOG.md contains duplicate v${version} sections`)
  }
  const headerMatch = headerMatches[0]
  const sectionStart = headerMatch.index
  const afterHeader = normalizedChangelog.slice(sectionStart + headerMatch[0].length)
  const nextHeaderOffset = afterHeader.search(/^##\s+/m)
  const sectionEnd =
    nextHeaderOffset === -1
      ? normalizedChangelog.length
      : sectionStart + headerMatch[0].length + nextHeaderOffset
  const releaseNotes = normalizedChangelog.slice(sectionStart, sectionEnd).trim()
  const body = releaseNotes.slice(headerMatch[0].length).trim()
  if (body.length === 0) {
    throw new Error(`CHANGELOG.md section for v${version} is empty`)
  }

  return {
    schemaVersion: 1,
    tag,
    sourceSha,
    version,
    prerelease: version.includes('-'),
    releaseNotes: `${releaseNotes}\n`
  }
}

function parseArguments(argv) {
  const options = {}
  const allowedArguments = new Set(['tag', 'source-sha', 'output-dir', 'project-dir'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (!allowedArguments.has(name)) throw new Error(`Unknown argument: --${name}`)
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    options[name] = value
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  for (const required of ['tag', 'source-sha', 'output-dir']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const projectDirectory = path.resolve(options['project-dir'] ?? repositoryRoot)
  const context = prepareReleaseContext({
    tag: options.tag,
    sourceSha: options['source-sha'],
    packageJson: JSON.parse(
      await readFile(path.join(projectDirectory, 'package.json'), 'utf8')
    ),
    changelog: await readFile(path.join(projectDirectory, 'CHANGELOG.md'), 'utf8')
  })
  const outputDirectory = path.resolve(options['output-dir'])
  await mkdir(outputDirectory, { recursive: true })
  const { releaseNotes, ...persistedContext } = context
  await Promise.all([
    writeFile(
      path.join(outputDirectory, 'release-context.json'),
      `${JSON.stringify(persistedContext, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      path.join(outputDirectory, 'release-notes.md'),
      releaseNotes,
      'utf8'
    )
  ])
  console.log(JSON.stringify(persistedContext))
  return context
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Release Preflight] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
