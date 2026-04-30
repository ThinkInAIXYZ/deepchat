import fs from 'node:fs/promises'
import path from 'node:path'

const LINUX_APP_NAME = 'deepchat'

function isLinux(targets) {
  const re = /AppImage|snap|deb|rpm|freebsd|pacman/i
  return !!targets.find((target) => re.test(target.name))
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

  if (isLinux(targets)) {
    await afterPackLinux({ appOutDir })
  }
}

export default afterPack
