
# App Lifecycle Management

The application's lifecycle is managed by the `LifecycleManager` class, which provides a structured and extensible way to control the application's startup, shutdown, and other lifecycle events.

## Overview

The `LifecycleManager` orchestrates the application's lifecycle through a series of phases. For each phase, it executes a set of registered hooks. This allows for a modular and decoupled architecture, where different parts of the application can hook into the lifecycle to perform their own initialization and cleanup tasks.

## Lifecycle Phases

The application lifecycle is divided into the following phases:

- **`INIT`**: This is the first phase of the application lifecycle. It is used for initializing essential services and configurations that are required before the application starts.
- **`BEFORE_START`**: This phase is executed before the main application window is created. It is used for tasks that need to be performed before the UI is displayed, such as database migrations or checking for updates.
- **`READY`**: This phase is executed after the main application window is created and the application is ready to receive user input. It is used for tasks that require the UI to be present, such as setting up event listeners or restoring the previous session.
- **`AFTER_START`**: This phase is executed after the application has fully started and is visible to the user. It is used for tasks that can be performed in the background, such as checking for new messages or syncing data.
- **`BEFORE_QUIT`**: This phase is executed when the application is about to quit. It can be used to perform cleanup tasks or to prevent the application from quitting (e.g., by showing a confirmation dialog).
- **`WILL_QUIT`**: This phase is executed just before the application quits. It is used for final cleanup tasks, such as saving data or closing database connections.

## Lifecycle Hooks

A lifecycle hook is a function that is executed at a specific lifecycle phase. Hooks are registered with the `LifecycleManager` and are executed in order of their priority.

Each hook is defined as an object with the following properties:

- **`name`**: A unique name for the hook.
- **`phase`**: The lifecycle phase at which the hook should be executed.
- **`priority`**: A number that determines the order in which the hooks are executed. Lower numbers are executed first.
- **`critical`**: A boolean that indicates whether the hook is critical. If a critical hook fails, the application will quit.
- **`execute`**: A function that contains the logic of the hook. It receives a `LifecycleContext` object as its only argument.

### Creating a Hook

To create a new lifecycle hook, create a new file in the `src/main/lib/lifecycle/hooks` directory and export a `LifecycleHook` object.

For example, the following hook initializes the configuration service in the `INIT` phase:

```typescript
// src/main/lib/lifecycle/hooks/configInitHook.ts
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

To register a hook, add it to the `src/main/lib/lifecycle/hooks/index.ts` file. The hooks are then registered with the `LifecycleManager` via the `registerCoreHooks()` function during application startup.

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

The `LifecycleManager` intercepts the `before-quit` event to allow hooks to prevent the application from quitting. If a `BEFORE_QUIT` hook returns `false`, the shutdown process will be aborted.

To request a shutdown, use the `requestShutdown()` method of the `LifecycleManager`. To force a shutdown, use the `forceShutdown()` method.
