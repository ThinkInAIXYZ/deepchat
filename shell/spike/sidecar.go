package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

// sidecarProcess is a Node process that answers renderer routes. The real shell
// will run the existing main-process services here; this prototype only proves
// the transport and the request shape.
type sidecarProcess struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	mu      sync.Mutex
	nextID  int
	pending map[int]chan sidecarReply

	// onEvent forwards an unsolicited event line to the pages.
	onEvent func(name string, payload json.RawMessage)
}

type sidecarEvent struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

type sidecarReply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

func startSidecar(script string) (process *sidecarProcess, err error) {
	cmd := exec.Command("node", script)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	// Keep the sidecar's diagnostics visible: a silent crash is otherwise
	// indistinguishable from a route that has no handler.
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	process = &sidecarProcess{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  bufio.NewReader(stdout),
		pending: map[int]chan sidecarReply{},
	}
	go process.readLoop()
	return process, nil
}

func (s *sidecarProcess) readLoop() {
	for {
		line, err := s.stdout.ReadBytes('\n')
		if err != nil {
			s.failAll(err)
			return
		}

		var probe struct {
			Event string `json:"event"`
		}
		if err := json.Unmarshal(line, &probe); err != nil {
			continue
		}
		if probe.Event != "" {
			var event sidecarEvent
			if err := json.Unmarshal(line, &event); err == nil && s.onEvent != nil {
				s.onEvent(event.Event, event.Payload)
			}
			continue
		}

		var reply sidecarReply
		if err := json.Unmarshal(line, &reply); err != nil {
			continue
		}

		s.mu.Lock()
		waiting, ok := s.pending[reply.ID]
		if ok {
			delete(s.pending, reply.ID)
		}
		s.mu.Unlock()
		if ok {
			waiting <- reply
		}
	}
}

func (s *sidecarProcess) failAll(err error) {
	s.mu.Lock()
	pending := s.pending
	s.pending = map[int]chan sidecarReply{}
	s.mu.Unlock()
	for _, waiting := range pending {
		waiting <- sidecarReply{Error: fmt.Sprintf("sidecar stopped: %v", err)}
	}
}

func (s *sidecarProcess) call(route string, inputJSON string) (string, error) {
	var input json.RawMessage
	if inputJSON == "" {
		input = json.RawMessage("null")
	} else if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return "", fmt.Errorf("decode input: %w", err)
	}

	s.mu.Lock()
	s.nextID++
	id := s.nextID
	waiting := make(chan sidecarReply, 1)
	s.pending[id] = waiting
	s.mu.Unlock()

	request, err := json.Marshal(map[string]any{
		"id":    id,
		"route": route,
		"input": input,
	})
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	_, writeErr := s.stdin.Write(append(request, '\n'))
	s.mu.Unlock()
	if writeErr != nil {
		return "", writeErr
	}

	reply := <-waiting
	if reply.Error != "" {
		return "", errors.New(reply.Error)
	}
	if len(reply.Result) == 0 {
		return "{}", nil
	}
	return string(reply.Result), nil
}

// deepchatBridgeSidecar is the preload used when a sidecar is present: every
// renderer route goes through mygo's binding to the Node process.
//
// The bridge itself is the app's own `createBridge`, bundled to IIFE by
// `pnpm run preload:build` and injected at the marker, so the renderer keeps the same
// contract validation it has under Electron.
const deepchatBridgeSidecar = `
(() => {
  const listeners = new Set()
  window.mygo.on('deepchat.event', (envelope) => {
    for (const listener of listeners) listener({}, envelope)
  })

  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      if (channel !== 'deepchat:route:invoke') {
        throw new Error('Unsupported channel: ' + channel)
      }
      const [route, input] = args
      const raw = await window.mygo.call('Bridge.Invoke', route, JSON.stringify(input ?? {}))
      return JSON.parse(raw)
    },
    on: (channel, listener) => {
      if (channel === 'deepchat:event') listeners.add(listener)
    },
    removeListener: (channel, listener) => {
      if (channel === 'deepchat:event') listeners.delete(listener)
    }
  }

  window.__step = 'start'
  try {
    /*__DEEPCHAT_BRIDGE__*/
    window.__step = 'bundled'
    window.deepchat = DeepchatBridge.createBridge(ipcRenderer)
    window.__step = 'created'
  } catch (error) {
    // Surface the failure instead of leaving the page without a bridge.
    window.__deepchatPreloadError = String((error && error.stack) || error)
    window.deepchat = undefined
  }
  if (!window.deepchat) return
  window.api = {
    invoke: (route, input) => window.deepchat.invoke(route, input),
    on: (name, fn) => window.deepchat.on(name, fn),
    removeListener: () => {},
    openExternal: async (url) => {
      await window.mygo.call('Bridge.OpenExternal', url)
    },
    copyText: (text) => window.mygo.call('Bridge.CopyText', text),
    copyImage: (dataUrl) => window.mygo.call('Bridge.CopyImage', dataUrl),
    readClipboardText: async () => '',
    getPathForFile: () => '',
    getPlatform: () => 'darwin',
    getArch: () => 'arm64',
    toRelativePath: (filePath) => filePath
  }
})()
`
