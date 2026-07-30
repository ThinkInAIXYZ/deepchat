export type RemoteChannelSaveCommitContext<Draft> = Readonly<{
  draft: Draft
  isLatest: boolean
}>

export type RemoteChannelSaveSucceededContext = Readonly<{
  isCurrentDraftPersisted: boolean
}>

export type RemoteChannelSaveCoordinatorOptions<Draft, Persisted = Draft> = Readonly<{
  readDraft: () => Draft | null
  persist: (draft: Draft) => Promise<Persisted>
  commit: (persisted: Persisted, context: RemoteChannelSaveCommitContext<Draft>) => boolean
  onStarted: () => void
  onSucceeded: (context: RemoteChannelSaveSucceededContext) => void
  onFailed: (error: unknown) => void
}>

export class RemoteChannelSaveCoordinator<Draft, Persisted = Draft> {
  private requestedRevision = 0
  private activeTask?: Promise<boolean>

  constructor(private readonly options: RemoteChannelSaveCoordinatorOptions<Draft, Persisted>) {}

  request(): Promise<boolean> {
    this.requestedRevision += 1
    if (this.activeTask) return this.activeTask

    const task = Promise.resolve().then(() => this.run())
    const trackedTask = task.finally(() => {
      if (this.activeTask === trackedTask) {
        this.activeTask = undefined
      }
    })
    this.activeTask = trackedTask
    return trackedTask
  }

  private async run(): Promise<boolean> {
    this.options.onStarted()

    while (true) {
      const revision = this.requestedRevision
      const draft = this.options.readDraft()
      if (!draft) {
        this.options.onFailed(new Error('Remote channel settings are unavailable'))
        return false
      }

      let persisted: Persisted
      try {
        persisted = await this.options.persist(draft)
      } catch (error) {
        if (revision !== this.requestedRevision) continue
        this.options.onFailed(error)
        return false
      }

      const isLatest = revision === this.requestedRevision
      const isCurrentDraftPersisted = this.options.commit(persisted, { draft, isLatest })
      if (!isLatest) continue

      this.options.onSucceeded({ isCurrentDraftPersisted })
      return true
    }
  }
}
