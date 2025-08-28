
# App Lifecycle Management

The application's lifecycle is managed by the `LifecycleManager` class, which implements the `ILifecycleManager` interface. It provides a structured and extensible way to control the application's startup, shutdown, and other lifecycle events.

## Overview

The `LifecycleManager` orchestrates the application's lifecycle through a series of phases. For each phase, it executes a set of registered hooks. This allows for a modular and decoupled architecture, where different parts of the application can hook into the lifecycle to perform their own initialization and cleanup tasks.

## Lifecycle Phases

The application lifecycle is divided into the following phases:

- **`INIT`**: This is the first phase of the application lifecycle. It is used for initializing essential services and configurations that are required before the application starts.
- **`BEFORE_START`**: This phase is executed before the main application window is created. It is used for tasks that need to be performed before the UI is displayed.
- **`READY`**: This phase is executed after the main application window is created and the application is ready to receive user input. It is used for tasks that require the UI to be present. **Presenter will be init first in this phase.**
- **`AFTER_START`**: This phase is executed after the application has fully started and is visible to the user. It is used for tasks that can be performed in the background, such as checking for new messages or syncing data.
- **`BEFORE_QUIT`**: This phase is executed when the application is about to quit. It can be used to perform cleanup tasks or to prevent the application from quitting (e.g., by showing a confirmation dialog).

## Lifecycle Hooks

A lifecycle hook is a function that is executed at a specific lifecycle phase. Hooks are registered with the `LifecycleManager` and are executed in order of their priority.

Each hook is defined as an object with the following properties:

- **`name`**: A unique name for the hook.
- **`phase`**: The lifecycle phase at which the hook should be executed.
- **`priority`**: A number that determines the order in which the hooks are executed. Lower numbers are executed first.
- **`critical`**: A boolean that indicates whether the hook is critical. If a critical hook fails during startup, the application will quit. During shutdown, a critical hook failure will be logged, but the shutdown process will continue.
- **`execute`**: A function that contains the logic of the hook. It receives a `LifecycleContext` object as its only argument.

### Creating a Hook

To create a new lifecycle hook, create a new file in the `src/main/presenter/lifecyclePresenter/hooks` directory and export a `LifecycleHook` object.

For example, the following hook initializes the configuration service in the `INIT` phase:

```typescript
// src/main/presenter/lifecyclePresenter/hooks/configInitHook.ts
import { LifecycleHook, LifecyclePhase } from '@shared/lifecycle';

export const configInitHook: LifecycleHook = {
  name: 'config-init',
  phase: LifecyclePhase.INIT,
  priority: 10,
  critical: true,
  execute: async (context) => {
    // Initialize the configuration service
    // ...
  },
};
```

### Registering a Hook

To register a hook, add it to the `src/main/presenter/lifecyclePresenter/hooks/index.ts` file. The hooks are then registered with the `LifecycleManager` via the `registerCoreHooks()` function during application startup.

## LifecycleManager

The `LifecycleManager` is the central class that manages the application's lifecycle. It is responsible for:

- Registering and unregistering lifecycle hooks.
- Executing the lifecycle phases in the correct order.
- Executing the registered hooks for each phase.
- Managing the splash screen.
- Handling application shutdown.

The `LifecycleManager` is initialized in the `src/main/index.ts` file.

## Splash Screen

The `LifecycleManager` displays a splash screen during the startup phases to provide feedback to the user. The splash screen shows the current lifecycle phase and the progress of the startup process.

The splash screen is implemented in the `src/renderer/splash` directory.

## Shutdown

The `LifecycleManager` intercepts the `before-quit` event from Electron to allow registered hooks to perform cleanup or even prevent the application from quitting.

To initiate a graceful shutdown, call `app.quit()`. The `LifecycleManager` will then execute all hooks registered for the `BEFORE_QUIT` phase. If any of these hooks return `false`, the shutdown process will be aborted.

If the shutdown is not aborted, the application terminates.

Forceful termination of the application (e.g., via task manager or system shutdown) is not controlled by the lifecycle manager and may prevent cleanup hooks from running.

## Lifecycle Events

The `LifecycleManager` emits a series of events to the `eventBus` that allow other parts of the application to monitor the lifecycle progress. These events are sent to both the main and renderer processes.

- `LIFECYCLE_EVENTS.PHASE_STARTED`: Dispatched when a new lifecycle phase begins.
- `LIFECYCLE_EVENTS.PHASE_COMPLETED`: Dispatched when a lifecycle phase completes.
- `LIFECYCLE_EVENTS.HOOK_EXECUTED`: Dispatched when a hook begins execution.
- `LIFECYCLE_EVENTS.HOOK_COMPLETED`: Dispatched when a hook successfully completes.
- `LIFECYCLE_EVENTS.HOOK_FAILED`: Dispatched when a hook fails.
- `LIFECYCLE_EVENTS.ERROR_OCCURRED`: Dispatched when a critical error occurs.
- `LIFECYCLE_EVENTS.PROGRESS_UPDATED`: Dispatched to update the progress on the splash screen.
