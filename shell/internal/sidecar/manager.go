package sidecar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

const (
	defaultMaxRestarts  = 3
	defaultBackoff      = 750 * time.Millisecond
	defaultStartupLimit = 60 * time.Second
	defaultCommandLimit = 10 * time.Second
	maxBackoff          = 4 * time.Second
)

var ErrRecoveryUnavailable = errors.New("sidecar recovery is unavailable")

// ManagerOptions controls bounded replacement of an unexpectedly stopped
// Process. A caller's request belongs to exactly one generation and is never
// replayed on the next one.
type ManagerOptions struct {
	Process          Options
	MaxRestarts      int
	Backoff          time.Duration
	StartupTimeout   time.Duration
	CommandTimeout   time.Duration
	OnUnexpectedExit func(error)
	OnEvent          func(Event)
	OnCommand        NativeWindowCommandHandler
	OnReady          func()
	OnExhausted      func(error)
}

// Manager coordinates native lifecycle and renderer recovery without tying
// renderer IPC to a stale process. Its Close path never schedules a restart.
type Manager struct {
	options ManagerOptions

	mu          sync.Mutex
	process     *Process
	generation  int
	restarts    int
	stopping    bool
	failed      bool
	ready       bool
	lastErr     error
	startupErr  error
	onEvent     func(Event)
	stop        chan struct{}
	stopOnce    sync.Once
	startFailed bool
	runCtx      context.Context
	cancel      context.CancelFunc
	commands    chan managedCommand
}

type managedCommand struct {
	generation int
	command    NativeWindowCommand
	ctx        context.Context
	cancel     context.CancelFunc
}

func StartManager(options ManagerOptions) (*Manager, error) {
	if options.MaxRestarts == 0 {
		options.MaxRestarts = defaultMaxRestarts
	}
	if options.MaxRestarts < 0 {
		return nil, errors.New("sidecar max restarts cannot be negative")
	}
	if options.Backoff <= 0 {
		options.Backoff = defaultBackoff
	}
	if options.StartupTimeout == 0 {
		options.StartupTimeout = defaultStartupLimit
	}
	if options.StartupTimeout < 0 {
		return nil, errors.New("sidecar startup timeout cannot be negative")
	}
	if options.CommandTimeout == 0 {
		options.CommandTimeout = defaultCommandLimit
	}
	if options.CommandTimeout < 0 {
		return nil, errors.New("sidecar command timeout cannot be negative")
	}
	runCtx, cancel := context.WithCancel(context.Background())
	manager := &Manager{
		options:  options,
		onEvent:  options.OnEvent,
		stop:     make(chan struct{}),
		runCtx:   runCtx,
		cancel:   cancel,
		commands: make(chan managedCommand, 32),
	}
	go manager.commandLoop()
	if err := manager.start(); err != nil {
		manager.stopOnce.Do(func() { close(manager.stop) })
		manager.cancel()
		return nil, err
	}
	return manager, nil
}

func (m *Manager) SetEventHandler(handler func(Event)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onEvent = handler
}

func generationDelay(attempt int, base time.Duration) time.Duration {
	delay := base
	for range max(attempt-1, 0) {
		if delay >= maxBackoff/2 {
			return maxBackoff
		}
		delay *= 2
	}
	return min(delay, maxBackoff)
}

// start creates one generation. Callers serialize it so an old process is
// waited out before another one can open the same profile.
func (m *Manager) start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		return ErrClosed
	}

	m.generation++
	generation := m.generation
	m.ready = false
	m.startupErr = nil
	options := m.options.Process
	options.OnExit = func(err error) {
		m.unexpectedExit(generation, err)
	}
	options.OnEvent = func(event Event) { m.handleEvent(generation, event) }
	options.OnCommand = func(command NativeWindowCommand) { m.handleCommand(generation, command) }
	process, err := Start(options)
	if err != nil {
		m.lastErr = err
		m.startFailed = true
		return err
	}
	m.process = process
	m.startFailed = false
	m.watchStartup(generation)
	return nil
}

func (m *Manager) watchStartup(generation int) {
	time.AfterFunc(m.options.StartupTimeout, func() {
		m.mu.Lock()
		if m.stopping || m.ready || generation != m.generation || m.process == nil {
			m.mu.Unlock()
			return
		}
		process := m.process
		m.startupErr = fmt.Errorf(
			"sidecar did not become ready within %s: %w",
			m.options.StartupTimeout, context.DeadlineExceeded,
		)
		m.mu.Unlock()

		if err := process.Kill(); err != nil {
			m.mu.Lock()
			if !m.stopping && generation == m.generation {
				m.failed = true
				m.lastErr = fmt.Errorf("stop unready sidecar: %w", err)
			}
			m.mu.Unlock()
			if m.options.OnExhausted != nil {
				m.options.OnExhausted(fmt.Errorf("stop unready sidecar: %w", err))
			}
		}
	})
}

func (m *Manager) unexpectedExit(generation int, exitErr error) {
	m.mu.Lock()
	if m.stopping || generation != m.generation {
		m.mu.Unlock()
		return
	}
	m.process = nil
	if m.startupErr != nil {
		exitErr = m.startupErr
		m.startupErr = nil
	}
	cleanupFailed := errors.Is(exitErr, errProcessCleanup)
	if cleanupFailed {
		m.failed = true
	}
	m.lastErr = exitErr
	m.mu.Unlock()

	if m.options.OnUnexpectedExit != nil {
		m.options.OnUnexpectedExit(exitErr)
	}
	if cleanupFailed {
		if m.options.OnExhausted != nil {
			m.options.OnExhausted(exitErr)
		}
		return
	}
	m.scheduleRestart(generation)
}

func (m *Manager) scheduleRestart(failedGeneration int) {
	m.mu.Lock()
	if m.stopping || failedGeneration != m.generation || m.failed {
		m.mu.Unlock()
		return
	}
	m.restarts++
	attempt := m.restarts
	if attempt > m.options.MaxRestarts {
		m.failed = true
		err := m.lastErr
		if err == nil {
			err = errors.New("sidecar exited before becoming ready")
		}
		m.lastErr = fmt.Errorf("sidecar recovery exhausted after %d restarts: %w", m.options.MaxRestarts, err)
		m.mu.Unlock()
		if m.options.OnExhausted != nil {
			m.options.OnExhausted(err)
		}
		return
	}
	delay := generationDelay(attempt, m.options.Backoff)
	m.mu.Unlock()

	time.AfterFunc(delay, func() {
		m.mu.Lock()
		if m.stopping || failedGeneration != m.generation {
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()
		select {
		case <-m.stop:
			return
		default:
		}
		if err := m.start(); err != nil {
			m.mu.Lock()
			failedStartGeneration := m.generation
			m.mu.Unlock()
			m.scheduleRestart(failedStartGeneration)
		}
	})
}

func (m *Manager) handleCommand(generation int, command NativeWindowCommand) {
	m.mu.Lock()
	current := m.process != nil && generation == m.generation && !m.stopping
	m.mu.Unlock()
	if !current {
		return
	}
	ctx, cancel := context.WithTimeout(m.runCtx, m.options.CommandTimeout)
	select {
	case m.commands <- managedCommand{generation: generation, command: command, ctx: ctx, cancel: cancel}:
	case <-ctx.Done():
		cancel()
	default:
		if err := m.replyCommand(ctx, generation, command.ID, nil, errors.New("native window command queue is full")); err != nil && !errors.Is(err, ErrClosed) && !errors.Is(err, context.Canceled) {
			log.Printf("native window command response failed: %v", err)
		}
		cancel()
	}
}

func (m *Manager) commandLoop() {
	for {
		select {
		case <-m.runCtx.Done():
			return
		case job := <-m.commands:
			m.executeCommand(job)
		}
	}
}

func (m *Manager) executeCommand(job managedCommand) {
	ctx, cancel := job.ctx, job.cancel
	defer cancel()
	generation, command := job.generation, job.command
	m.mu.Lock()
	current := m.process != nil && generation == m.generation && !m.stopping
	m.mu.Unlock()
	if !current {
		return
	}
	var result any
	var err error
	if err = ctx.Err(); err != nil {
		// A queued deadline is an execution barrier, not just a reply deadline.
		// Already-started synchronous native calls cannot be hard-cancelled.
		m.replyExpiredCommand(generation, command.ID, err)
		return
	}
	if m.options.OnCommand == nil {
		err = errors.New("native window commands are unavailable")
	} else {
		result, err = m.options.OnCommand(ctx, command)
	}
	m.replyExpiredCommand(generation, command.ID, err, result)
}

func (m *Manager) replyExpiredCommand(generation int, id int, resultErr error, result ...any) {
	ctx, cancel := context.WithTimeout(m.runCtx, m.options.CommandTimeout)
	defer cancel()
	var value any
	if len(result) > 0 {
		value = result[0]
	}
	if replyErr := m.replyCommand(ctx, generation, id, value, resultErr); replyErr != nil && !errors.Is(replyErr, ErrClosed) && !errors.Is(replyErr, context.Canceled) {
		log.Printf("native window command response failed: %v", replyErr)
	}
}

func (m *Manager) replyCommand(
	ctx context.Context,
	generation int,
	id int,
	result any,
	resultErr error,
) error {
	m.mu.Lock()
	if m.stopping || m.process == nil || generation != m.generation {
		m.mu.Unlock()
		return ErrClosed
	}
	process := m.process
	m.mu.Unlock()
	answer := reply{}
	if resultErr != nil {
		answer.Error = resultErr.Error()
	} else {
		encoded, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode native command result: %w", err)
		}
		answer.Result = encoded
	}
	return process.writeCommandReply(ctx, id, answer)
}

func (m *Manager) EmitEvent(ctx context.Context, event Event) error {
	if !json.Valid(event.Payload) {
		return errors.New("sidecar event payload is not valid JSON")
	}
	ctx, cancel := context.WithTimeout(ctx, m.options.CommandTimeout)
	defer cancel()
	m.mu.Lock()
	if m.stopping || m.process == nil {
		m.mu.Unlock()
		return ErrClosed
	}
	process := m.process
	m.mu.Unlock()
	var source *RequestSource
	if event.Source != nil {
		source = &RequestSource{WindowID: event.Source.WindowID}
	}
	_, err := process.writeEnvelope(ctx, nil, false, func(id int) (any, error) {
		// A one-way envelope only shares the ordered write ticket. It has no
		// response waiter and never adds an entry to the discarded-ID map.
		return map[string]any{
			"id": id, "event": event.Name, "payload": event.Payload, "source": source,
		}, nil
	})
	return err
}

func (m *Manager) handleEvent(generation int, event Event) {
	m.mu.Lock()
	current := m.process != nil && generation == m.generation && !m.stopping
	if current && event.Name == "sidecar.app.started" {
		// Only the real dispatcher-ready signal proves that replacement worked.
		m.restarts = 0
		m.ready = true
		m.failed = false
		m.startFailed = false
		m.startupErr = nil
	}
	handler := m.onEvent
	m.mu.Unlock()
	if !current {
		return
	}
	if event.Name == "sidecar.app.started" && m.options.OnReady != nil {
		m.options.OnReady()
	}
	if handler != nil {
		handler(event)
	}
}

func (m *Manager) Call(
	ctx context.Context, route string, inputJSON string, source ...RequestSource,
) (string, error) {
	m.mu.Lock()
	process := m.process
	failed := m.failed
	startFailed := m.startFailed
	m.mu.Unlock()
	if process == nil {
		if failed {
			return "", ErrRecoveryUnavailable
		}
		if startFailed {
			return "", errors.New("sidecar could not start")
		}
		return "", ErrClosed
	}
	return process.Call(ctx, route, inputJSON, source...)
}

func (m *Manager) Close(ctx context.Context) error {
	m.mu.Lock()
	if m.stopping {
		process := m.process
		m.mu.Unlock()
		if process != nil {
			return process.Close(ctx)
		}
		return nil
	}
	m.stopping = true
	m.stopOnce.Do(func() { close(m.stop) })
	if m.cancel != nil {
		m.cancel()
	}
	process := m.process
	m.process = nil
	m.mu.Unlock()
	if process != nil {
		return process.Close(ctx)
	}
	return nil
}
