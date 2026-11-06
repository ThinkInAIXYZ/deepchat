package sidecar

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	defaultMaxRestarts  = 3
	defaultBackoff      = 750 * time.Millisecond
	defaultStartupLimit = 60 * time.Second
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
	OnUnexpectedExit func(error)
	OnEvent          func(Event)
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
	manager := &Manager{options: options, onEvent: options.OnEvent, stop: make(chan struct{})}
	if err := manager.start(); err != nil {
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
	process := m.process
	m.process = nil
	m.mu.Unlock()
	if process != nil {
		return process.Close(ctx)
	}
	return nil
}
