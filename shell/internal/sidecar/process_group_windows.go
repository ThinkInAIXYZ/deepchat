//go:build windows

package sidecar

import (
	"os/exec"
	"strconv"
)

func configureProcessGroup(cmd *exec.Cmd) {}

func killProcessGroup(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	if err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run(); err != nil {
		// Process.Kill also covers an already exited or partially started tree,
		// including hosts for which taskkill is unavailable.
		return cmd.Process.Kill()
	}
	return nil
}
