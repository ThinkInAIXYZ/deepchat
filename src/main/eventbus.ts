import EventEmitter from 'events'

export class EventBus extends EventEmitter {
  sendToMain(eventName: string, ...args: unknown[]): void {
    super.emit(eventName, ...args)
  }
}

export const eventBus = new EventBus()
