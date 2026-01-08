// @ts-check
import pico from 'picocolors'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const resolveMsgPath = () => {
  const argPath = process.argv[2]
  if (argPath && existsSync(argPath)) {
    return argPath
  }

  const gitPath = path.resolve('.git')
  if (existsSync(gitPath)) {
    try {
      const stat = readFileSync(gitPath, 'utf-8').trim()
      if (stat.startsWith('gitdir:')) {
        const gitDir = stat.replace('gitdir:', '').trim()
        return path.resolve(gitDir, 'COMMIT_EDITMSG')
      }
    } catch {
      // ignore and fall through
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
