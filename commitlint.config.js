const commitTypes = [
  'feat',
  'fix',
  'docs',
  'dx',
  'style',
  'refactor',
  'perf',
  'test',
  'workflow',
  'build',
  'ci',
  'chore',
  'types',
  'wip',
  'release',
  'revert'
]

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'type-enum': [2, 'always', commitTypes]
  }
}
