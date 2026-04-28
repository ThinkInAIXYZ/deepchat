import fs from 'node:fs/promises'
import path from 'node:path'

const LINUX_APP_NAME = 'deepchat'
const COMPUTER_USE_SKILL_NAME = 'cua-driver'

function isLinux(targets) {
  const re = /AppImage|snap|deb|rpm|freebsd|pacman/i
  return !!targets.find((target) => re.test(target.name))
}

async function removeLegacyComputerUseRuntime(appOutDir) {
  const runtimePath = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'runtime',
    'computer-use'
  )
  await fs.rm(runtimePath, { recursive: true, force: true })
}

async function removeLegacyComputerUseSkill(appOutDir) {
  const skillPath = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'resources',
    'skills',
    COMPUTER_USE_SKILL_NAME
  )
  await fs.rm(skillPath, { recursive: true, force: true })
}

async function afterPackLinux({ appOutDir }) {
  const scriptPath = path.join(appOutDir, LINUX_APP_NAME)
  const script = `#!/bin/bash\n"\${BASH_SOURCE%/*}"/${LINUX_APP_NAME}.bin --no-sandbox "$@"`
  await fs.rename(scriptPath, `${scriptPath}.bin`)
  await fs.writeFile(scriptPath, script)
  await fs.chmod(scriptPath, 0o755)
}

async function afterPack(context) {
  const { targets, appOutDir } = context
  await removeLegacyComputerUseRuntime(appOutDir)
  await removeLegacyComputerUseSkill(appOutDir)

  if (isLinux(targets)) {
    await afterPackLinux({ appOutDir })
  }
}

export default afterPack
