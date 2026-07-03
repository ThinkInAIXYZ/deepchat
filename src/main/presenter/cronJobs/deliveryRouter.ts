import type {
  CronJob,
  CronJobDeliveryReceipt,
  CronJobDeliveryTarget,
  CronJobRun
} from '@shared/cronJobs'
import { CronJobsRepository } from './repository'

export interface CronJobNotificationPort {
  showNotification(options: {
    id: string
    title: string
    body: string
    silent?: boolean
  }): Promise<unknown> | unknown
}

export interface CronJobDeliveryRouterDeps {
  notificationPresenter?: CronJobNotificationPort
}

export class CronJobDeliveryRouter {
  constructor(
    private readonly repository: CronJobsRepository,
    private readonly deps: CronJobDeliveryRouterDeps = {}
  ) {}

  async deliver(input: { job: CronJob; run: CronJobRun }): Promise<CronJobDeliveryReceipt[]> {
    const targets = this.getTargets(input.job, input.run)
    return await Promise.all(targets.map((target) => this.deliverTarget(input, target)))
  }

  private getTargets(job: CronJob, run: CronJobRun): CronJobDeliveryTarget[] {
    if (run.status === 'completed') {
      return job.delivery.targets.filter(
        (target) =>
          target.type !== 'desktop_notification' || !job.delivery.suppressSuccessNotification
      )
    }

    if ((run.status === 'failed' || run.status === 'cancelled') && job.delivery.notifyOnFailure) {
      return job.delivery.targets
    }

    return []
  }

  private async deliverTarget(
    input: { job: CronJob; run: CronJobRun },
    target: CronJobDeliveryTarget
  ): Promise<CronJobDeliveryReceipt> {
    try {
      const remoteMessageId = await this.dispatch(input, target)
      return this.repository.recordDelivery({
        jobId: input.job.id,
        runId: input.run.id,
        target,
        status: 'success',
        remoteMessageId
      })
    } catch (error) {
      return this.repository.recordDelivery({
        jobId: input.job.id,
        runId: input.run.id,
        target,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async dispatch(
    input: { job: CronJob; run: CronJobRun },
    target: CronJobDeliveryTarget
  ): Promise<string | null> {
    switch (target.type) {
      case 'desktop_notification':
        if (!this.deps.notificationPresenter) {
          throw new Error('Desktop notification delivery is not available.')
        }
        await this.deps.notificationPresenter.showNotification({
          id: `cron-job:${input.run.id}`,
          title: input.job.name,
          body: this.buildNotificationBody(input.run),
          silent: input.run.status === 'completed' && input.job.delivery.suppressSuccessNotification
        })
        return null
      case 'deepchat_inbox':
      case 'origin_session':
      case 'remote':
        throw new Error(`Delivery target is not implemented: ${target.type}`)
    }
  }

  private buildNotificationBody(run: CronJobRun): string {
    return (run.error || run.outputPreview || `Cron job ${run.status}.`).slice(0, 200)
  }
}
