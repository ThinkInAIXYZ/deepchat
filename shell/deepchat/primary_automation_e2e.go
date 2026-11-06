//go:build e2e

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"image/png"
	"net"
	"os"
	"sync"

	"github.com/egoist/mygo"
)

const primaryAutomationSocketEnv = "DEEPCHAT_AUTOMATION_EVAL"

var (
	primaryAutomationOnce sync.Once
	primaryAutomationErr  error
)

// configurePrimaryAutomation is the Content-host equivalent of mygo's page-only
// automation. It is compiled only into e2e builds and never exposes a renderer route.
func configurePrimaryAutomation(provider func() *mygo.Page) error {
	path := os.Getenv(primaryAutomationSocketEnv)
	if path == "" {
		return nil
	}
	primaryAutomationOnce.Do(func() {
		primaryAutomationErr = listenPrimaryAutomation(path, provider)
	})
	return primaryAutomationErr
}

func listenPrimaryAutomation(path string, provider func() *mygo.Page) error {
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = listener.Close()
		_ = os.Remove(path)
		return err
	}
	mygo.App.OnQuit(func() {
		_ = listener.Close()
		_ = os.Remove(path)
	})
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go servePrimaryAutomation(connection, provider)
		}
	}()
	return nil
}

type primaryAutomationRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params struct {
		Window int    `json:"window"`
		Script string `json:"script"`
	} `json:"params"`
}

type primaryAutomationError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type primaryAutomationResponse struct {
	ID     json.RawMessage         `json:"id"`
	Result any                     `json:"result,omitempty"`
	Error  *primaryAutomationError `json:"error,omitempty"`
}

func servePrimaryAutomation(connection net.Conn, provider func() *mygo.Page) {
	defer connection.Close()
	scanner := bufio.NewScanner(connection)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	encoder := json.NewEncoder(connection)
	encoder.SetEscapeHTML(false)
	for scanner.Scan() {
		var request primaryAutomationRequest
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			_ = encoder.Encode(primaryAutomationResponse{
				Error: &primaryAutomationError{Code: "parse_error", Message: err.Error()},
			})
			continue
		}
		if request.Method != "eval" && request.Method != "capture" {
			_ = encoder.Encode(primaryAutomationResponse{
				ID: request.ID,
				Error: &primaryAutomationError{
					Code: "invalid_request", Message: "only eval and capture are supported for the primary page",
				},
			})
			continue
		}
		page := provider()
		if page == nil {
			_ = encoder.Encode(primaryAutomationResponse{
				ID: request.ID, Error: &primaryAutomationError{Code: "no_window", Message: "primary page unavailable"},
			})
			continue
		}
		if request.Params.Window != 0 && request.Params.Window != page.Window().ID() {
			_ = encoder.Encode(primaryAutomationResponse{
				ID: request.ID, Error: &primaryAutomationError{Code: "no_window", Message: "window is not the primary host"},
			})
			continue
		}
		if request.Method == "capture" {
			view := page.WebView()
			if view == nil {
				_ = encoder.Encode(primaryAutomationResponse{
					ID: request.ID,
					Error: &primaryAutomationError{
						Code: "unsupported", Message: "primary page is not a Content WebView",
					},
				})
				continue
			}
			data, err := view.CapturePage()
			if err != nil {
				_ = encoder.Encode(primaryAutomationResponse{
					ID: request.ID, Error: &primaryAutomationError{Code: "failed", Message: err.Error()},
				})
				continue
			}
			dimensions, err := png.DecodeConfig(bytes.NewReader(data))
			if err != nil {
				_ = encoder.Encode(primaryAutomationResponse{
					ID: request.ID, Error: &primaryAutomationError{Code: "failed", Message: err.Error()},
				})
				continue
			}
			_ = encoder.Encode(primaryAutomationResponse{
				ID: request.ID,
				Result: map[string]any{
					"png": data, "width": dimensions.Width, "height": dimensions.Height,
				},
			})
			continue
		}
		value, err := page.Eval(request.Params.Script)
		if err != nil {
			_ = encoder.Encode(primaryAutomationResponse{
				ID: request.ID, Error: &primaryAutomationError{Code: "failed", Message: err.Error()},
			})
			continue
		}
		_ = encoder.Encode(primaryAutomationResponse{
			ID: request.ID, Result: map[string]any{"value": value},
		})
	}
}
