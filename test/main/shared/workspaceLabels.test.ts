import { describe, expect, it } from 'vitest'
import { disambiguateWorkspaceLabels } from '@shared/utils/workspaceLabels'

describe('disambiguateWorkspaceLabels', () => {
  it('keeps unique labels untouched', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: '/work/app', label: 'app' },
      { id: '/work/design', label: 'design' }
    ])

    expect(overrides.size).toBe(0)
  })

  it('appends the immediate parent for duplicate labels only', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: '/work/team-a/app', label: 'app' },
      { id: '/work/archive/app', label: 'app' },
      { id: '/work/design', label: 'design' }
    ])

    expect(overrides.get('/work/team-a/app')).toBe('app · team-a')
    expect(overrides.get('/work/archive/app')).toBe('app · archive')
    expect(overrides.has('/work/design')).toBe(false)
  })

  it('walks up shared parent segments until every label is unique', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: '/team-a/x/app', label: 'app' },
      { id: '/team-b/x/app', label: 'app' },
      { id: '/c/app', label: 'app' }
    ])

    expect(overrides.get('/team-a/x/app')).toBe('app · team-a/x')
    expect(overrides.get('/team-b/x/app')).toBe('app · team-b/x')
    expect(overrides.get('/c/app')).toBe('app · c')
  })

  it('resolves each workspace at its own shortest unique suffix', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: '/root/team/shared/app', label: 'app' },
      { id: '/root/archive/shared/app', label: 'app' },
      { id: '/root/client/unique/app', label: 'app' }
    ])

    expect(overrides.get('/root/team/shared/app')).toBe('app · team/shared')
    expect(overrides.get('/root/archive/shared/app')).toBe('app · archive/shared')
    expect(overrides.get('/root/client/unique/app')).toBe('app · unique')
  })

  it('treats Windows and POSIX separators consistently', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: 'C:\\work\\app', label: 'app' },
      { id: '/work/app', label: 'app' }
    ])

    expect(overrides.get('C:\\work\\app')).toBe('app · C:/work')
    expect(overrides.get('/work/app')).toBe('app · work')
  })

  it('keeps a parentless duplicate on its compact label', () => {
    const overrides = disambiguateWorkspaceLabels([
      { id: '/app', label: 'app' },
      { id: '/work/app', label: 'app' }
    ])

    expect(overrides.has('/app')).toBe(false)
    expect(overrides.get('/work/app')).toBe('app · work')
  })

  it('drops overrides once a removed environment ends the collision', () => {
    const before = disambiguateWorkspaceLabels([
      { id: '/work/team-a/app', label: 'app' },
      { id: '/work/archive/app', label: 'app' }
    ])
    expect(before.size).toBe(2)

    const after = disambiguateWorkspaceLabels([{ id: '/work/team-a/app', label: 'app' }])
    expect(after.size).toBe(0)
  })
})
