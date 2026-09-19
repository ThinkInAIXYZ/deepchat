import desktop from './packages/desktop/vitest.config'
import kernel from './packages/agent-kernel/test/vitest.config'
import shared from './packages/shared/vitest.config'

export default {
  ...desktop,
  test: {
    ...desktop.test,
    projects: [...desktop.test.projects, kernel, shared]
  }
}
