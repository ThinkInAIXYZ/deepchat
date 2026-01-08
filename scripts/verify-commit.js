// @ts-check
import pico from 'picocolors'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const findGitPath = (startDir) => {
  let current = startDir
  while (true) {
    const candidate = path.join(current, '.git')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const resolveGitDir = (gitPath) => {
  try {
    const stat = statSync(gitPath)
    if (stat.isDirectory()) {
      return gitPath
    }
    const content = readFileSync(gitPath, 'utf-8').trim()
    if (content.startsWith('gitdir:')) {
      const gitDir = content.replace('gitdir:', '').trim()
      return path.resolve(path.dirname(gitPath), gitDir)
    }
  } catch {
    // ignore and fall through
  }
  return null
}

const resolveMsgPath = () => {
  const argPath = process.argv[2]
  if (argPath && existsSync(argPath)) {
    return argPath
  }

  const envGitDir = process.env.GIT_DIR
  if (envGitDir && existsSync(envGitDir)) {
    const resolved = resolveGitDir(envGitDir)
    if (resolved) {
      return path.resolve(resolved, 'COMMIT_EDITMSG')
    }
  }

  const gitPath = findGitPath(process.cwd())
  if (gitPath) {
    const resolved = resolveGitDir(gitPath)
    if (resolved) {
      return path.resolve(resolved, 'COMMIT_EDITMSG')
    }
  }

  return path.resolve('.git/COMMIT_EDITMSG')
}

const msgPath = resolveMsgPath()
const msg = readFileSync(msgPath, 'utf-8').trim()

const commitRE =
  /^(revert: )?(feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release)(\(.+\))?: .{1,50}/

if (!commitRE.test(msg)) {
  console.log()
  console.error(
    `  ${pico.white(pico.bgRed(' ERROR '))} ${pico.red(
      `invalid commit message format.`,
    )}\n\n` +
      pico.red(
        `  Proper commit message format is required for automated changelog generation. Examples:\n\n`,
      ) +
      `    ${pico.green(`feat(compiler): add 'comments' option`)}\n` +
      `    ${pico.green(
        `fix(v-model): handle events on blur (close #28)`,
      )}\n\n` +
      pico.red(`  See .github/commit-convention.md for more details.\n`),
  )
  process.exit(1)
}
