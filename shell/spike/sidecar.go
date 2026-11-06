package main

import (
	"encoding/json"
	"log"
	"os"
	"os/exec"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
)

// Keep the spike's historical helpers thin: lifecycle and transport fixes must
// also reach the product shell, so both use internal/sidecar.
type sidecarProcess = sidecar.Process

func startSidecar(script string) (*sidecarProcess, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return nil, err
	}
	return sidecar.Start(sidecar.Options{
		NodePath:   nodePath,
		ScriptPath: script,
		Stderr:     os.Stderr,
		OnExit: func(err error) {
			if err != nil {
				log.Printf("sidecar exited: %v", err)
			}
		},
	})
}

func setSidecarEventHandler(
	process *sidecarProcess,
	handler func(string, json.RawMessage),
) {
	process.SetEventHandler(func(event sidecar.Event) {
		handler(event.Name, event.Payload)
	})
}

func sidecarPreload(bundle string) string {
	return sidecar.PreloadScript(bundle)
}
