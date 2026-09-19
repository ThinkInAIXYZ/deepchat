import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const MANIFEST_NAME = 'package.json'
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const BUILD_DEPENDENCY_FIELDS = [...DEPENDENCY_FIELDS, 'devDependencies']
const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function manifestAt(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, MANIFEST_NAME), 'utf8'))
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function packageSubpath(specifier, packageName) {
  const remainder = specifier.slice(packageName.length)
  return remainder ? `.${remainder}` : '.'
}

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...listFiles(path))
    else files.push(path)
  }
  return files
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(exportTargets)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportTargets)
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function assertWithin(root, candidate, message) {
  if (!isWithin(root, candidate)) throw new Error(message)
}

function existingFileWithin(root, candidate) {
  assertWithin(root, candidate, `artifact path '${candidate}' escapes '${root}'`)
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return undefined
  const realRoot = realpathSync(root)
  const realCandidate = realpathSync(candidate)
  assertWithin(realRoot, realCandidate, `artifact path '${candidate}' escapes '${root}' through a symlink`)
  return candidate
}

function matchingExportTargets(exports, subpath) {
  if (typeof exports === 'string' || Array.isArray(exports)) return subpath === '.' ? exportTargets(exports) : []
  if (!exports || typeof exports !== 'object') return []

  const keys = Object.keys(exports)
  const isSubpathMap = keys.some((key) => key.startsWith('.'))
  if (!isSubpathMap) return subpath === '.' ? exportTargets(exports) : []

  if (Object.hasOwn(exports, subpath)) return exportTargets(exports[subpath])
  for (const [key, target] of Object.entries(exports)) {
    const star = key.indexOf('*')
    if (star < 0) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    const value = subpath.slice(prefix.length, subpath.length - suffix.length)
    return exportTargets(target).map((entry) => entry.replaceAll('*', value))
  }
  return []
}

function assertPublicTargets(packageDir, manifest) {
  const targets = [manifest.main, manifest.types, ...exportTargets(manifest.exports)].filter(Boolean)
  if (targets.length === 0) throw new Error(`${manifest.name}: no public entry or exports declared`)

  for (const target of targets) {
    if (!target.startsWith('./')) throw new Error(`${manifest.name}: invalid public target '${target}'`)
    if (!target.includes('*')) {
      if (!existingFileWithin(packageDir, resolve(packageDir, target))) {
        throw new Error(`${manifest.name}: public target '${target}' is missing from artifact`)
      }
      continue
    }

    const prefix = target.slice(2).split('*')[0]
    const directory = resolve(packageDir, dirname(prefix))
    if (!isWithin(packageDir, directory) || !existsSync(directory) || !statSync(directory).isDirectory()) {
      throw new Error(`${manifest.name}: wildcard export '${target}' has no artifact directory`)
    }
    const suffix = target.slice(target.lastIndexOf('*') + 1)
    if (
      !listFiles(directory).some((file) => {
        const artifactPath = relative(packageDir, file)
        return artifactPath.startsWith(prefix) && file.endsWith(suffix) && existingFileWithin(packageDir, file)
      })
    ) {
      throw new Error(`${manifest.name}: wildcard export '${target}' matches no artifact files`)
    }
  }
}

function privateWorkspaceDependencies(manifest, manifests, fields = DEPENDENCY_FIELDS) {
  const result = []
  for (const field of fields) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (typeof version !== 'string' || !version.startsWith('workspace:')) continue
      if (!manifests.has(name)) {
        throw new Error(`${manifest.name}: workspace dependency '${name}' is not declared`)
      }
      result.push(name)
    }
  }
  return [...new Set(result)]
}

export function discoverWorkspacePackages(rootDir) {
  const packagesDir = join(rootDir, 'packages')
  const packages = new Map()
  for (const entry of readdirSync(packagesDir)) {
    const packageDir = join(packagesDir, entry)
    if (!statSync(packageDir).isDirectory() || !existsSync(join(packageDir, MANIFEST_NAME))) continue
    const manifest = manifestAt(packageDir)
    packages.set(manifest.name, { directory: packageDir, manifest })
  }
  return packages
}

export function workspaceClosure(entryName, packages, fields = DEPENDENCY_FIELDS) {
  const closure = new Map()
  const visit = (name) => {
    if (closure.has(name)) return
    const pkg = packages.get(name)
    if (!pkg) throw new Error(`workspace package '${name}' is not declared`)
    closure.set(name, pkg)
    for (const dependency of privateWorkspaceDependencies(pkg.manifest, packages, fields)) visit(dependency)
  }
  visit(entryName)
  return closure
}

export function buildWorkspaceClosure(rootDir, entryName) {
  const packages = discoverWorkspacePackages(rootDir)
  const closure = workspaceClosure(entryName, packages, BUILD_DEPENDENCY_FIELDS)
  const built = new Set()
  const visiting = []
  const build = (name) => {
    if (built.has(name)) return
    const cycleStart = visiting.indexOf(name)
    if (cycleStart >= 0) {
      throw new Error(`workspace dependency cycle: ${[...visiting.slice(cycleStart), name].join(' -> ')}`)
    }
    const pkg = closure.get(name)
    if (!pkg) throw new Error(`workspace package '${name}' is not declared`)
    visiting.push(name)
    for (const dependency of privateWorkspaceDependencies(pkg.manifest, packages, BUILD_DEPENDENCY_FIELDS)) {
      if (closure.has(dependency)) build(dependency)
    }
    visiting.pop()
    if (!pkg.manifest.scripts?.build) throw new Error(`${name}: missing required build script`)
    execFileSync('pnpm', ['run', 'build'], {
      cwd: pkg.directory,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    built.add(name)
  }
  build(entryName)
  return { packages, closure }
}

function copyDeclaredFiles(sourceDir, destinationDir, manifest) {
  for (const declared of manifest.files ?? []) {
    if (typeof declared !== 'string' || declared.includes('*')) {
      throw new Error(`${manifest.name}: artifact gate supports concrete manifest files entries only`)
    }
    const source = resolve(sourceDir, declared)
    if (!isWithin(sourceDir, source) || !existsSync(source)) {
      throw new Error(`${manifest.name}: declared artifact path '${declared}' is missing`)
    }
    cpSync(source, join(destinationDir, declared), { recursive: true })
  }
}

export function stageWorkspaceClosure(rootDir, entryName, artifactRoot) {
  const { packages, closure } = buildWorkspaceClosure(rootDir, entryName)
  const staged = new Map()

  for (const [name, pkg] of closure) {
    const destination = join(artifactRoot, name.replace('/', '__'))
    mkdirSync(destination, { recursive: true })
    copyDeclaredFiles(pkg.directory, destination, pkg.manifest)
    const manifest = structuredClone(pkg.manifest)
    for (const field of DEPENDENCY_FIELDS) {
      for (const dependency of privateWorkspaceDependencies(manifest, packages, [field])) {
        manifest[field][dependency] = `file:${relative(destination, join(artifactRoot, dependency.replace('/', '__')))}`
      }
    }
    writeFileSync(join(destination, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
    assertPublicTargets(destination, manifest)
    staged.set(name, { directory: destination, manifest })
  }
  return staged
}

function declaredDependencies(manifest) {
  return new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})))
}

function relativeCandidates(importer, specifier, declaration) {
  const target = resolve(dirname(importer), specifier)
  const candidates = [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, `${target}.json`]
  if (declaration) {
    candidates.push(`${target}.d.ts`)
    candidates.push(target.replace(/\.(?:mjs|cjs|js)$/, '.d.ts'))
  }
  for (const extension of ['.js', '.mjs', '.cjs']) candidates.push(join(target, `index${extension}`))
  if (declaration) candidates.push(join(target, 'index.d.ts'))
  return [...new Set(candidates)]
}

function resolveRelativeFile(packageDir, importer, specifier, declaration) {
  for (const candidate of relativeCandidates(importer, specifier, declaration)) {
    const file = existingFileWithin(packageDir, candidate)
    if (file) return file
  }
  return undefined
}

function importedSpecifiers(source) {
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2] ?? match[3])
}

function assertExportedImport(specifier, dependency) {
  const dependencyName = packageNameFromSpecifier(specifier)
  const subpath = packageSubpath(specifier, dependencyName)
  const targets = matchingExportTargets(dependency.manifest.exports, subpath)
  if (dependency.manifest.exports !== undefined && targets.length === 0) {
    return `imports unexported subpath '${specifier}'`
  }
  if (targets.length === 0) return undefined
  for (const target of targets) {
    if (!target.startsWith('./')) {
      return `${dependencyName}: export target '${target}' for '${specifier}' is invalid`
    }
    if (target.includes('*')) {
      return `${dependencyName}: unresolved wildcard export target '${target}' for '${specifier}'`
    }
    if (!existingFileWithin(dependency.directory, resolve(dependency.directory, target))) {
      return `${dependencyName}: export target '${target}' for '${specifier}' is missing from artifact`
    }
  }
  return undefined
}

export function assertArtifactDependencyClosure(staged) {
  const errors = []
  for (const [name, pkg] of staged) {
    const dependencies = declaredDependencies(pkg.manifest)
    const files = listFiles(pkg.directory).filter((file) => /\.(?:js|d\.ts)$/.test(file))
    for (const file of files) {
      for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
        const location = `${name}:${relative(pkg.directory, file)}`
        if (specifier.startsWith('.')) {
          try {
            if (!resolveRelativeFile(pkg.directory, file, specifier, file.endsWith('.d.ts'))) {
              errors.push(`${location} missing relative import '${specifier}'`)
            }
          } catch (error) {
            errors.push(`${location} invalid relative import '${specifier}': ${error.message}`)
          }
          continue
        }
        if (specifier.startsWith('/') || specifier.startsWith('@/') || specifier.startsWith('@shared/')) {
          errors.push(`${location} forbidden import '${specifier}'`)
          continue
        }
        if (specifier === 'electron' || specifier.startsWith('electron/') || /better-sqlite3|node-pty/.test(specifier)) {
          errors.push(`${location} forbidden native import '${specifier}'`)
          continue
        }
        const dependencyName = packageNameFromSpecifier(specifier)
        const builtin = builtinModules.some(
          (moduleName) => dependencyName === moduleName || dependencyName.startsWith(`${moduleName}/`)
        )
        const selfImport = dependencyName === name
        if (!specifier.startsWith('node:') && !builtin && !selfImport && !dependencies.has(dependencyName)) {
          errors.push(`${location} undeclared import '${specifier}'`)
          continue
        }
        const dependency = selfImport ? pkg : staged.get(dependencyName)
        if (dependency) {
          const error = assertExportedImport(specifier, dependency)
          if (error) errors.push(`${location} ${error}`)
        }
      }
    }
  }
  if (errors.length > 0) throw new Error(`artifact dependency closure failed:\n${errors.join('\n')}`)
}
